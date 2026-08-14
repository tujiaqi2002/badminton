-- Generic, append-only audit events. The table intentionally lives outside the
-- exposed public schema: clients can only read or revert events through the
-- manager-only RPCs defined below.
create table private.app_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default statement_timestamp(),
  transaction_id bigint not null default txid_current(),
  operation_id text not null default txid_current()::text,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_kind text not null default 'system',
  source text not null default 'database',
  before_state jsonb,
  after_state jsonb,
  changed_fields text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  reverts_operation_id text,
  constraint app_audit_events_event_type_check
    check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint app_audit_events_entity_type_check
    check (entity_type ~ '^[a-z][a-z0-9_]*$'),
  constraint app_audit_events_actor_kind_check
    check (actor_kind in ('manager', 'user', 'system')),
  constraint app_audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index app_audit_events_occurred_idx
  on private.app_audit_events (occurred_at desc, id desc);
create index app_audit_events_operation_idx
  on private.app_audit_events (operation_id, id);
create index app_audit_events_entity_idx
  on private.app_audit_events (entity_type, entity_id, id desc)
  where entity_id is not null;
create index app_audit_events_reverts_idx
  on private.app_audit_events (reverts_operation_id)
  where reverts_operation_id is not null;

alter table private.app_audit_events enable row level security;
alter table private.app_audit_events force row level security;
revoke all on private.app_audit_events from public, anon, authenticated;
revoke all on sequence private.app_audit_events_id_seq from public, anon, authenticated;

create or replace function private.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.audit_suppress', true) = 'true' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Multi-court moves temporarily park rows as cancelled to avoid colliding
  -- with their own exclusion constraints. That internal state is not an app
  -- operation and must not appear in the manager's history.
  if tg_op = 'UPDATE'
     and old.status in ('held', 'confirmed')
     and new.status = 'cancelled'
     and new.cancelled_at is not distinct from old.cancelled_at then
    return new;
  end if;

  raise exception 'Audit events are append-only';
end;
$$;

create trigger app_audit_events_immutable
before update or delete on private.app_audit_events
for each row execute function private.reject_audit_event_mutation();

create or replace function private.capture_booking_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_actor_kind text := 'system';
  v_before jsonb;
  v_after jsonb;
  v_event_type text;
  v_operation_id text;
  v_source text;
  v_reverts_operation_id text;
  v_changed_fields text[] := '{}'::text[];
  v_entity_id text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_entity_id := new.id::text;
  elsif tg_op = 'UPDATE' then
    if old is not distinct from new then return new; end if;
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_entity_id := new.id::text;
  else
    v_before := to_jsonb(old);
    v_entity_id := old.id::text;
  end if;

  if v_actor_id is not null then
    select users.email into v_actor_email
    from auth.users as users
    where users.id = v_actor_id;

    if exists (
      select 1 from public.staff_members as staff
      where staff.user_id = v_actor_id and staff.role = 'admin'
    ) then
      v_actor_kind := 'manager';
    else
      v_actor_kind := 'user';
    end if;
  end if;

  if v_before is not null and v_after is not null then
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields
    from (
      select coalesce(before_fields.key, after_fields.key) as key
      from jsonb_each(v_before) as before_fields
      full join jsonb_each(v_after) as after_fields using (key)
      where before_fields.value is distinct from after_fields.value
    ) as fields;
  elsif v_after is not null then
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields
    from jsonb_each(v_after) as fields;
  else
    select coalesce(array_agg(fields.key order by fields.key), '{}'::text[])
      into v_changed_fields
    from jsonb_each(v_before) as fields;
  end if;

  v_event_type := nullif(current_setting('app.audit_event_type', true), '');
  if v_event_type is null then
    if tg_op = 'INSERT' then
      v_event_type := 'booking.created';
    elsif tg_op = 'DELETE' then
      v_event_type := 'booking.deleted';
    elsif old.status is distinct from new.status and new.status = 'cancelled' then
      v_event_type := 'booking.cancelled';
    elsif old.court_id is distinct from new.court_id
       or old.start_at is distinct from new.start_at
       or old.end_at is distinct from new.end_at then
      v_event_type := 'booking.rescheduled';
    else
      v_event_type := 'booking.details_updated';
    end if;
  end if;

  v_operation_id := coalesce(
    nullif(current_setting('app.audit_operation_id', true), ''),
    txid_current()::text
  );
  v_source := coalesce(
    nullif(current_setting('app.audit_source', true), ''),
    case when v_actor_kind = 'manager' then 'manager_ui'
         when v_actor_kind = 'user' then 'customer_ui'
         else 'database' end
  );
  v_reverts_operation_id := nullif(current_setting('app.audit_reverts_operation_id', true), '');

  insert into private.app_audit_events (
    transaction_id, operation_id, event_type, entity_type, entity_id,
    actor_id, actor_email, actor_kind, source, before_state, after_state,
    changed_fields, metadata, reverts_operation_id
  ) values (
    txid_current(), v_operation_id, v_event_type, 'booking', v_entity_id,
    v_actor_id, v_actor_email, v_actor_kind, v_source, v_before, v_after,
    v_changed_fields, jsonb_build_object('schema_version', 1), v_reverts_operation_id
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger bookings_capture_audit_event
after insert or update or delete on public.bookings
for each row execute function private.capture_booking_audit_event();

create or replace function private.audit_operation_undo_reason(p_operation_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event private.app_audit_events;
  v_booking public.bookings;
  v_count integer := 0;
begin
  if exists (
    select 1 from private.app_audit_events as reverted
    where reverted.reverts_operation_id = p_operation_id
  ) then return 'already_reverted'; end if;

  for v_event in
    select *
    from private.app_audit_events as event
    where event.operation_id = p_operation_id
      and event.entity_type = 'booking'
    order by event.entity_id, event.id
  loop
    v_count := v_count + 1;
    if v_event.event_type not in (
      'booking.created', 'booking.cancelled',
      'booking.rescheduled', 'booking.details_updated'
    ) then return 'unsupported'; end if;

    select * into v_booking
    from public.bookings
    where id = v_event.entity_id::uuid;
    if v_booking.id is null then return 'booking_missing'; end if;

    if v_event.event_type = 'booking.created' then
      if to_jsonb(v_booking.status) is distinct from v_event.after_state -> 'status' then
        return 'changed_afterwards';
      end if;
    elsif v_event.event_type = 'booking.cancelled' then
      if to_jsonb(v_booking.status) is distinct from v_event.after_state -> 'status' then
        return 'changed_afterwards';
      end if;
    elsif v_event.event_type = 'booking.rescheduled' then
      if to_jsonb(v_booking.status) is distinct from v_event.after_state -> 'status'
         or to_jsonb(v_booking.court_id) is distinct from v_event.after_state -> 'court_id'
         or to_jsonb(v_booking.start_at) is distinct from v_event.after_state -> 'start_at'
         or to_jsonb(v_booking.end_at) is distinct from v_event.after_state -> 'end_at' then
        return 'changed_afterwards';
      end if;
    else
      if to_jsonb(v_booking.customer_name) is distinct from v_event.after_state -> 'customer_name'
         or to_jsonb(v_booking.customer_email) is distinct from v_event.after_state -> 'customer_email'
         or to_jsonb(v_booking.customer_phone) is distinct from v_event.after_state -> 'customer_phone'
         or to_jsonb(v_booking.customer_notes) is distinct from v_event.after_state -> 'customer_notes'
         or to_jsonb(v_booking.payment_status) is distinct from v_event.after_state -> 'payment_status' then
        return 'changed_afterwards';
      end if;
    end if;
  end loop;

  if v_count = 0 then return 'not_found'; end if;
  return 'available';
end;
$$;

create or replace function public.admin_list_recent_audit_operations(p_limit integer default 10)
returns table (
  operation_id text,
  event_type text,
  occurred_at timestamptz,
  actor_email text,
  item_count integer,
  can_undo boolean,
  undo_reason text,
  before_items jsonb,
  after_items jsonb,
  changed_fields text[],
  reverted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  return query
  with operations as (
    select
      event.operation_id,
      min(event.event_type) as event_type,
      max(event.occurred_at) as occurred_at,
      max(event.actor_email) as actor_email,
      count(*)::integer as item_count,
      jsonb_agg(event.before_state order by event.id) as before_items,
      jsonb_agg(event.after_state order by event.id) as after_items,
      array(
        select distinct field
        from private.app_audit_events as nested_event,
             unnest(nested_event.changed_fields) as field
        where nested_event.operation_id = event.operation_id
        order by field
      ) as changed_fields
    from private.app_audit_events as event
    where event.actor_kind = 'manager'
      and event.entity_type = 'booking'
      and event.reverts_operation_id is null
    group by event.operation_id
    order by max(event.occurred_at) desc, max(event.id) desc
    limit greatest(1, least(coalesce(p_limit, 10), 10))
  )
  select
    operations.operation_id,
    operations.event_type,
    operations.occurred_at,
    operations.actor_email,
    operations.item_count,
    reason.value = 'available' as can_undo,
    reason.value as undo_reason,
    operations.before_items,
    operations.after_items,
    operations.changed_fields,
    reverted.occurred_at as reverted_at
  from operations
  cross join lateral (
    select private.audit_operation_undo_reason(operations.operation_id) as value
  ) as reason
  left join lateral (
    select max(event.occurred_at) as occurred_at
    from private.app_audit_events as event
    where event.reverts_operation_id = operations.operation_id
  ) as reverted on true
  order by operations.occurred_at desc;
end;
$$;

create or replace function public.admin_revert_audit_operation(p_operation_id text)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_reason text;
  v_event private.app_audit_events;
  v_booking public.bookings;
  v_revert_operation_id text := gen_random_uuid()::text;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  if not exists (
    select 1
    from (
      select event.operation_id
      from private.app_audit_events as event
      where event.actor_kind = 'manager'
        and event.entity_type = 'booking'
        and event.reverts_operation_id is null
      group by event.operation_id
      order by max(event.occurred_at) desc, max(event.id) desc
      limit 10
    ) as recent
    where recent.operation_id = p_operation_id
  ) then raise exception 'Only the 10 most recent operations can be reverted'; end if;

  v_reason := private.audit_operation_undo_reason(p_operation_id);
  if v_reason <> 'available' then
    raise exception 'Operation cannot be reverted: %', v_reason;
  end if;

  perform set_config('app.audit_operation_id', v_revert_operation_id, true);
  perform set_config('app.audit_event_type', 'booking.reverted', true);
  perform set_config('app.audit_reverts_operation_id', p_operation_id, true);
  perform set_config('app.audit_source', 'manager_ui', true);

  -- Release a moved group from the overlap constraint before restoring all of
  -- its courts in deterministic order. The parking update is deliberately
  -- suppressed; only the final restored state is audited.
  if exists (
    select 1 from private.app_audit_events as event
    where event.operation_id = p_operation_id
      and event.event_type = 'booking.rescheduled'
  ) then
    perform set_config('app.audit_suppress', 'true', true);
    update public.bookings as booking
       set status = 'cancelled'
     where booking.id in (
       select event.entity_id::uuid
       from private.app_audit_events as event
       where event.operation_id = p_operation_id
         and event.event_type = 'booking.rescheduled'
     );
    perform set_config('app.audit_suppress', 'false', true);
  end if;

  for v_event in
    select event.*
    from private.app_audit_events as event
    where event.operation_id = p_operation_id
      and event.entity_type = 'booking'
    order by event.entity_id, event.id
    for share
  loop
    if v_event.event_type = 'booking.created' then
      update public.bookings
         set status = 'cancelled', cancelled_at = now()
       where id = v_event.entity_id::uuid
       returning * into v_booking;
    elsif v_event.event_type = 'booking.cancelled' then
      update public.bookings
         set status = (v_event.before_state ->> 'status')::public.booking_status,
             cancelled_at = case
               when v_event.before_state ->> 'cancelled_at' is null then null
               else (v_event.before_state ->> 'cancelled_at')::timestamptz
             end
       where id = v_event.entity_id::uuid
       returning * into v_booking;
    elsif v_event.event_type = 'booking.rescheduled' then
      update public.bookings
         set status = (v_event.before_state ->> 'status')::public.booking_status,
             court_id = (v_event.before_state ->> 'court_id')::uuid,
             start_at = (v_event.before_state ->> 'start_at')::timestamp,
             end_at = (v_event.before_state ->> 'end_at')::timestamp,
             total_amount = (v_event.before_state ->> 'total_amount')::numeric
       where id = v_event.entity_id::uuid
       returning * into v_booking;
    elsif v_event.event_type = 'booking.details_updated' then
      update public.bookings
         set customer_name = v_event.before_state ->> 'customer_name',
             customer_email = v_event.before_state ->> 'customer_email',
             customer_phone = v_event.before_state ->> 'customer_phone',
             customer_notes = v_event.before_state ->> 'customer_notes',
             payment_status = (v_event.before_state ->> 'payment_status')::public.payment_status
       where id = v_event.entity_id::uuid
       returning * into v_booking;
    end if;
    return next v_booking;
  end loop;
exception when exclusion_violation then
  raise exception 'The original court or time is no longer available';
end;
$$;

-- Ctrl+Z remains a thin compatibility wrapper over the same auditable revert
-- path, so every recovery is itself recorded instead of rewriting history.
create or replace function public.admin_undo_last_booking_action()
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_operation_id text;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  select candidate.operation_id into v_operation_id
  from (
    select event.operation_id, max(event.occurred_at) as occurred_at, max(event.id) as max_id
    from private.app_audit_events as event
    where event.actor_kind = 'manager'
      and event.entity_type = 'booking'
      and event.reverts_operation_id is null
    group by event.operation_id
    order by max(event.occurred_at) desc, max(event.id) desc
    limit 5
  ) as candidate
  where private.audit_operation_undo_reason(candidate.operation_id) = 'available'
  order by candidate.occurred_at desc, candidate.max_id desc
  limit 1;

  if v_operation_id is null then raise exception 'No booking action available to undo'; end if;
  return query select * from public.admin_revert_audit_operation(v_operation_id);
end;
$$;

revoke execute on function public.admin_list_recent_audit_operations(integer)
  from public, anon, authenticated;
revoke execute on function public.admin_revert_audit_operation(text)
  from public, anon, authenticated;
revoke execute on function public.admin_undo_last_booking_action()
  from public, anon, authenticated;
grant execute on function public.admin_list_recent_audit_operations(integer)
  to authenticated;
grant execute on function public.admin_revert_audit_operation(text)
  to authenticated;
grant execute on function public.admin_undo_last_booking_action()
  to authenticated;

notify pgrst, 'reload schema';
