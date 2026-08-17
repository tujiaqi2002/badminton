-- Database-backed manager invitations and access control.
--
-- The allowlist lives in the private schema and is never exposed through
-- PostgREST. Managers can only read or mutate it through the RPCs below.

create table private.manager_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  activated_at timestamptz,
  constraint manager_accounts_email_normalized_check
    check (
      email = lower(btrim(email))
      and length(email) between 3 and 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
);

create unique index manager_accounts_email_unique_idx
  on private.manager_accounts (lower(email));
create index manager_accounts_status_idx
  on private.manager_accounts (status, created_at desc);

alter table private.manager_accounts enable row level security;
alter table private.manager_accounts force row level security;
revoke all on private.manager_accounts from public, anon, authenticated;

-- Preserve every currently-authorized manager while moving away from the
-- historical two-email allowlist.
insert into private.manager_accounts (
  email, user_id, status, created_at, updated_at, activated_at
)
select
  lower(btrim(users.email)), users.id, 'active',
  least(staff.created_at, users.created_at), statement_timestamp(),
  coalesce(users.last_sign_in_at, staff.created_at)
from public.staff_members staff
join auth.users users on users.id = staff.user_id
where staff.role = 'admin' and users.email is not null
on conflict (lower(email)) do update
set user_id = excluded.user_id,
    status = 'active',
    updated_at = statement_timestamp(),
    activated_at = coalesce(private.manager_accounts.activated_at, excluded.activated_at);

create or replace function private.normalize_manager_account()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.updated_at := statement_timestamp();
  if tg_op = 'UPDATE' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  if new.status = 'active' and new.user_id is null then
    new.status := 'invited';
  end if;
  return new;
end;
$$;

create trigger manager_accounts_normalize
before insert or update on private.manager_accounts
for each row execute function private.normalize_manager_account();

create or replace function private.capture_manager_account_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_before jsonb;
  v_after jsonb;
  v_event_type text;
  v_changed_fields text[] := '{}'::text[];
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_event_type := case when new.status = 'active'
      then 'manager.enabled' else 'manager.invited' end;
  elsif tg_op = 'UPDATE' then
    if old is not distinct from new then return new; end if;
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_event_type := case
      when old.status is distinct from new.status and new.status = 'disabled' then 'manager.disabled'
      when old.status is distinct from new.status and new.status = 'active' and old.user_id is null then 'manager.activated'
      when old.status is distinct from new.status and new.status = 'active' then 'manager.enabled'
      when old.status is distinct from new.status and new.status = 'invited' then 'manager.invited'
      else 'manager.updated'
    end;
  else
    v_before := to_jsonb(old);
    v_event_type := 'manager.removed';
  end if;

  if v_before is not null and v_after is not null then
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields
    from (
      select coalesce(before_fields.key, after_fields.key) as key
      from jsonb_each(v_before) before_fields
      full join jsonb_each(v_after) after_fields using (key)
      where before_fields.value is distinct from after_fields.value
    ) fields;
  elsif v_after is not null then
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields from jsonb_each(v_after) fields;
  else
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields from jsonb_each(v_before) fields;
  end if;

  if v_actor_id is not null then
    select users.email into v_actor_email
    from auth.users users where users.id = v_actor_id;
  end if;

  insert into private.app_audit_events (
    operation_id, event_type, entity_type, entity_id, actor_id, actor_email,
    actor_kind, source, before_state, after_state, changed_fields, metadata
  ) values (
    coalesce(nullif(current_setting('app.audit_operation_id', true), ''), txid_current()::text),
    v_event_type, 'manager_account', coalesce(new.id, old.id)::text,
    v_actor_id, v_actor_email,
    case when v_actor_id is null then 'system' else 'manager' end,
    'operations_center', v_before, v_after, v_changed_fields,
    jsonb_build_object('schema_version', 1)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger manager_accounts_capture_audit
after insert or update or delete on private.manager_accounts
for each row execute function private.capture_manager_account_audit_event();

-- Supabase Auth calls this function before creating a user. It intentionally
-- returns no manager data; it only answers whether the normalized email is on
-- the private active/invited list.
create or replace function public.hook_allow_manager_accounts(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if v_email is not null and exists (
    select 1
    from private.manager_accounts account
    where account.email = v_email
      and account.status in ('invited', 'active')
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This email has not been invited as a Tiger manager.',
      'http_code', 403
    )
  );
end;
$$;

-- Convert an accepted invitation into active manager authorization at the
-- same moment the Auth user is created.
create or replace function private.activate_invited_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if new.email is null then return new; end if;

  update private.manager_accounts account
  set user_id = new.id,
      status = 'active',
      activated_at = coalesce(account.activated_at, statement_timestamp()),
      updated_at = statement_timestamp()
  where account.email = lower(btrim(new.email))
    and account.status in ('invited', 'active')
  returning account.id into v_account_id;

  if v_account_id is not null then
    insert into public.staff_members (user_id, role)
    values (new.id, 'admin')
    on conflict (user_id) do update set role = excluded.role;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_manager_created on auth.users;
create trigger on_auth_manager_created
after insert on auth.users
for each row execute function private.activate_invited_manager();

create or replace function public.admin_list_manager_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_result jsonb;
begin
  select jsonb_build_object(
    'version', 1,
    'total', count(*),
    'active_count', count(*) filter (where account.status = 'active'),
    'invited_count', count(*) filter (where account.status = 'invited'),
    'disabled_count', count(*) filter (where account.status = 'disabled'),
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', account.id,
        'email', account.email,
        'user_id', account.user_id,
        'status', account.status,
        'display_name', coalesce(
          nullif(profile.display_name, ''),
          nullif(users.raw_user_meta_data ->> 'full_name', ''),
          split_part(account.email, '@', 1)
        ),
        'avatar_url', coalesce(profile.avatar_url, users.raw_user_meta_data ->> 'avatar_url'),
        'created_at', account.created_at,
        'activated_at', account.activated_at,
        'last_sign_in_at', users.last_sign_in_at,
        'is_current', account.user_id = v_actor_id
      ) order by
        case account.status when 'active' then 0 when 'invited' then 1 else 2 end,
        account.created_at desc,
        account.email
    ), '[]'::jsonb)
  ) into v_result
  from private.manager_accounts account
  left join auth.users users on users.id = account.user_id
  left join public.profiles profile on profile.id = account.user_id;

  return v_result;
end;
$$;

create or replace function public.admin_invite_manager(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id uuid;
begin
  if length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  perform pg_advisory_xact_lock(hashtext('private.manager_accounts'));
  if not exists (select 1 from private.manager_accounts where email = v_email)
     and (select count(*) from private.manager_accounts where status <> 'disabled') >= 25 then
    raise exception 'Manager limit reached';
  end if;

  select users.id into v_user_id
  from auth.users users
  where lower(users.email) = v_email
  order by users.created_at
  limit 1;

  insert into private.manager_accounts (
    email, user_id, status, created_by, updated_by, activated_at
  ) values (
    v_email, v_user_id, case when v_user_id is null then 'invited' else 'active' end,
    v_actor_id, v_actor_id, case when v_user_id is null then null else statement_timestamp() end
  )
  on conflict (lower(email)) do update
  set user_id = coalesce(excluded.user_id, private.manager_accounts.user_id),
      status = case when coalesce(excluded.user_id, private.manager_accounts.user_id) is null
        then 'invited' else 'active' end,
      updated_by = v_actor_id,
      activated_at = case
        when coalesce(excluded.user_id, private.manager_accounts.user_id) is null then private.manager_accounts.activated_at
        else coalesce(private.manager_accounts.activated_at, statement_timestamp())
      end;

  if v_user_id is not null then
    insert into public.staff_members (user_id, role)
    values (v_user_id, 'admin')
    on conflict (user_id) do update set role = excluded.role;
  end if;

  return public.admin_list_manager_accounts();
end;
$$;

create or replace function public.admin_set_manager_status(
  p_manager_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_account private.manager_accounts;
begin
  if p_manager_id is null or p_enabled is null then
    raise exception 'Manager and status are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('private.manager_accounts'));
  select * into v_account
  from private.manager_accounts account
  where account.id = p_manager_id
  for update;
  if v_account.id is null then raise exception 'Manager not found'; end if;

  if not p_enabled then
    if v_account.user_id = v_actor_id then
      raise exception 'You cannot disable your own manager access';
    end if;
    if v_account.status = 'active' and (
      select count(*) from private.manager_accounts account
      where account.status = 'active' and account.user_id is not null
    ) <= 1 then
      raise exception 'At least one active manager is required';
    end if;

    update private.manager_accounts
    set status = 'disabled', updated_by = v_actor_id
    where id = v_account.id;
    if v_account.user_id is not null then
      delete from public.staff_members
      where user_id = v_account.user_id and role = 'admin';
    end if;
  else
    update private.manager_accounts
    set status = case when user_id is null then 'invited' else 'active' end,
        updated_by = v_actor_id,
        activated_at = case when user_id is null then activated_at
          else coalesce(activated_at, statement_timestamp()) end
    where id = v_account.id;
    if v_account.user_id is not null then
      insert into public.staff_members (user_id, role)
      values (v_account.user_id, 'admin')
      on conflict (user_id) do update set role = excluded.role;
    end if;
  end if;

  return public.admin_list_manager_accounts();
end;
$$;

revoke all on function private.normalize_manager_account() from public, anon, authenticated;
revoke all on function private.capture_manager_account_audit_event() from public, anon, authenticated;
revoke all on function private.activate_invited_manager() from public, anon, authenticated;

revoke execute on function public.hook_allow_manager_accounts(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_allow_manager_accounts(jsonb)
  to supabase_auth_admin;

revoke execute on function public.admin_list_manager_accounts()
  from public, anon, authenticated;
revoke execute on function public.admin_invite_manager(text)
  from public, anon, authenticated;
revoke execute on function public.admin_set_manager_status(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_list_manager_accounts() to authenticated;
grant execute on function public.admin_invite_manager(text) to authenticated;
grant execute on function public.admin_set_manager_status(uuid, boolean) to authenticated;

comment on table private.manager_accounts is
  'Private manager invitation and authorization source used by Supabase Auth and manager-only RPCs.';
comment on function public.admin_list_manager_accounts() is
  'Returns the safe manager directory to an authorized manager without exposing auth internals.';

notify pgrst, 'reload schema';
