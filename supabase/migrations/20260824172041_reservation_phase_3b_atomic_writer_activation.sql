-- Reservation Phase 3B.2: atomically activate every legacy booking writer on
-- the Phase 3B transaction kernel. The migration keeps the public signatures
-- stable, moves the reviewed legacy implementations behind a private boundary,
-- and fails closed if the writer catalog or security contract drifted.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $migration_history$
declare
  v_version_count integer;
  v_latest_version text;
  v_version_fingerprint text;
begin
  select
    count(*)::integer,
    max(version),
    md5(string_agg(version, ',' order by version))
    into v_version_count, v_latest_version, v_version_fingerprint
  from supabase_migrations.schema_migrations;

  if v_version_count <> 44
     or v_latest_version <> '20260824164530'
     or v_version_fingerprint <> 'a6f4cd3758ac93cc4deca461931511ae' then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Phase 3B.2 requires the exact reviewed 44-migration baseline ending at 20260824164530; found count=%s latest=%s fingerprint=%s',
        v_version_count,
        coalesce(v_latest_version, '<none>'),
        coalesce(v_version_fingerprint, '<none>')
      );
  end if;
end;
$migration_history$;

select private.assert_reservation_phase3b_kernel_inactive();
select private.assert_reservation_phase3b_writer_inventory();
select private.assert_reservation_shadow_clean();

do $security_boundary$
declare
  v_rls_table_count integer;
  v_realtime_tables text[];
begin
  select count(*)::integer into v_rls_table_count
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as schema on schema.oid = relation.relnamespace
  where schema.nspname = 'public'
    and relation.relname = any(array[
      'reservation_transitions',
      'reservation_transition_sources',
      'reservation_transition_targets',
      'reservation_transition_allocations',
      'reservation_transition_parties',
      'reservation_allocation_memberships'
    ]::text[])
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  select coalesce(
    array_agg(
      publication.schemaname || '.' || publication.tablename
      order by publication.schemaname, publication.tablename
    ),
    '{}'::text[]
  ) into v_realtime_tables
  from pg_catalog.pg_publication_tables as publication
  where publication.pubname = 'supabase_realtime';

  if v_rls_table_count <> 6
     or v_realtime_tables is distinct from array['public.court_slots']::text[]
     or exists (
       select 1
       from unnest(array['anon', 'authenticated', 'service_role']::text[])
         as role_name
       cross join unnest(array[
         'public.reservation_transitions',
         'public.reservation_transition_sources',
         'public.reservation_transition_targets',
         'public.reservation_transition_allocations',
         'public.reservation_transition_parties',
         'public.reservation_allocation_memberships'
       ]::text[]) as table_name
       where pg_catalog.has_table_privilege(
         role_name,
         table_name,
         'INSERT,UPDATE,DELETE'
       )
     )
     or exists (
       select 1
       from pg_catalog.pg_proc as routine
       join pg_catalog.pg_namespace as schema on schema.oid = routine.pronamespace
       where schema.nspname = 'private'
         and routine.proname like 'reservation_phase3b%'
         and (
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute')
           or pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
           or pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
         )
     ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.2 RLS, grants, private EXECUTE, or Realtime preflight drift';
  end if;
end;
$security_boundary$;

-- Phase 3B.1 deliberately knew only its private primitive names. Activation
-- adds stable public-operation and composed-helper names, so keep the journal
-- closed to a strict identifier grammar without making every future writer
-- require a destructive enum-style constraint replacement.
alter table private.reservation_phase3b_operations
  drop constraint reservation_phase3b_operations_type_check;
alter table private.reservation_phase3b_operations
  add constraint reservation_phase3b_operations_type_check
  check (operation_type ~ '^[a-z][a-z0-9_.]{0,99}$');

create or replace function private.reservation_phase3_uuid(
  p_entity text,
  p_source_key text
)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_namespace_url text;
  v_namespace_id uuid;
begin
  v_namespace_url := case p_entity
    when 'recurrence_series' then
      'https://tiger-badminton.example/reservation-migration/recurrence-series/v1'
    when 'reservation' then
      'https://tiger-badminton.example/reservation-migration/reservation/v1'
    when 'party' then
      'https://tiger-badminton.example/reservation-migration/party/v1'
    when 'session' then
      'https://tiger-badminton.example/reservation-migration/session/v1'
    when 'session_assignment' then
      'https://tiger-badminton.example/reservation-migration/session-assignment/v1'
    when 'payment' then
      'https://tiger-badminton.example/reservation-migration/payment/v1'
    else null
  end;
  if v_namespace_url is null then
    raise exception using
      errcode = '22023',
      message = pg_catalog.format(
        'Unsupported Reservation UUID entity: %s',
        p_entity
      );
  end if;

  v_namespace_id := extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    v_namespace_url
  );
  return extensions.uuid_generate_v5(v_namespace_id, p_source_key);
end;
$function$;

create table private.reservation_phase3b_writer_baseline (
  signature text collate pg_catalog."C" primary key,
  normalized_source_md5 text not null,
  accepted_source_md5 text[] not null,
  original_definition text not null,
  captured_at timestamptz not null default statement_timestamp(),
  constraint reservation_phase3b_writer_baseline_hash_check
    check (normalized_source_md5 ~ '^[0-9a-f]{32}$'),
  constraint reservation_phase3b_writer_baseline_accepted_check
    check (cardinality(accepted_source_md5) >= 1)
);

revoke all on table private.reservation_phase3b_writer_baseline
from public, anon, authenticated, service_role;

insert into private.reservation_phase3b_writer_baseline (
  signature,
  normalized_source_md5,
  accepted_source_md5,
  original_definition
)
select
  expected.signature,
  md5(pg_catalog.regexp_replace(
    pg_catalog.replace(routine.prosrc, chr(13), ''),
    '[[:space:]]+',
    ' ',
    'g'
  )),
  expected.accepted_source_md5,
  pg_catalog.pg_get_functiondef(routine.oid)
from (
  values
    ('public.admin_cancel_booking(uuid)', array[
      '4fefd06ac8c258854bbecc06268c365f',
      '7f2a64510b58d409137255aa69991984'
    ]::text[]),
    ('public.admin_create_multi_booking(uuid[],timestamp without time zone,timestamp without time zone,text,text,smallint,text,text)', array['b43751039e43bd14754c2144c0e10a5e']::text[]),
    ('public.admin_create_multi_booking_with_price(uuid[],timestamp without time zone,timestamp without time zone,text,text,smallint,text,text,numeric)', array['926d77aae940c0e87a3ca0fc7aef2c12']::text[]),
    ('public.admin_create_weekly_booking(uuid[],timestamp without time zone,timestamp without time zone,smallint,text,text,smallint,text,text)', array[
      '55c73a53ca76b62beda24acfa1520065',
      '88971834cd1111b6216a29358020a74c'
    ]::text[]),
    ('public.admin_create_weekly_booking_with_price(uuid[],timestamp without time zone,timestamp without time zone,smallint,text,text,smallint,text,text,numeric)', array['60cc70b2cbff10edd754b106971f9f5a']::text[]),
    ('public.admin_link_booking_groups(uuid,uuid)', array['c2f6148879b6db92e367b5843481d9cd']::text[]),
    ('public.admin_mark_booking_paid(uuid,text)', array['a4a2926592df1f253c986ae3cbcfdb29']::text[]),
    ('public.admin_move_booking_group(uuid,uuid,timestamp without time zone,timestamp without time zone)', array['80d864e3b6ec9ebef5e09baaf1dd3f05']::text[]),
    ('public.admin_reschedule_booking(uuid,uuid,timestamp without time zone,timestamp without time zone)', array['f8981a55152e31cb9bcee40b491542b7']::text[]),
    ('public.admin_reschedule_booking_group(uuid,timestamp without time zone,timestamp without time zone)', array['f6306a3f0a2fee2c68c77360f2c4af9c']::text[]),
    ('public.admin_revert_audit_operation(text)', array['0075c1f040d42d09a9433ffb10ece2bd']::text[]),
    ('public.admin_swap_booking_schedule(uuid,uuid,timestamp without time zone)', array['57558b8d24bc0d02b476532b3308e96e']::text[]),
    ('public.admin_undo_booking_change(uuid)', array['8e5d0f22e1e10414960c501bfee24ff6']::text[]),
    ('public.admin_unlink_booking_group(uuid)', array['daba7faaa18ea30967240f1614053950']::text[]),
    ('public.admin_update_booking_details(uuid,text,text,text,text,public.payment_status)', array['bd995361c77fe1761e803b53dc8c3254']::text[]),
    ('public.cancel_booking(uuid)', array['1e1dbb43a86285fdb890d9db58a60e9a']::text[]),
    ('public.create_multi_booking(uuid[],timestamp without time zone,timestamp without time zone,text,text,smallint,public.payment_method)', array['bcfc3f8dd3563d653af92c5622bb2722']::text[])
) as expected(signature, accepted_source_md5)
join pg_catalog.pg_proc as routine
  on routine.oid = pg_catalog.to_regprocedure(expected.signature);

do $preflight$
declare
  v_invalid text[];
begin
  select array_agg(baseline.signature order by baseline.signature)
    into v_invalid
  from private.reservation_phase3b_writer_baseline as baseline
  where not (baseline.normalized_source_md5 = any(baseline.accepted_source_md5));

  if (select count(*) from private.reservation_phase3b_writer_baseline) <> 17
     or coalesce(cardinality(v_invalid), 0) <> 0 then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Phase 3B.2 writer source drift: %s',
        coalesce(array_to_string(v_invalid, ', '), '<inventory incomplete>')
      );
  end if;
end;
$preflight$;

create table private.reservation_phase3b_activation_state (
  singleton boolean primary key default true,
  status text not null,
  activated_at timestamptz not null,
  rolled_back_at timestamptz,
  migration_version text not null,
  writer_count integer not null,
  baseline_fingerprint text not null,
  constraint reservation_phase3b_activation_singleton_check check (singleton),
  constraint reservation_phase3b_activation_status_check
    check (status in ('activated', 'legacy_writer_rollback')),
  constraint reservation_phase3b_activation_writer_count_check
    check (writer_count = 17),
  constraint reservation_phase3b_activation_rollback_shape_check
    check (
      (status = 'activated' and rolled_back_at is null)
      or
      (status = 'legacy_writer_rollback' and rolled_back_at is not null)
    )
);

revoke all on table private.reservation_phase3b_activation_state
from public, anon, authenticated, service_role;

create table public.reservation_session_assignments (
  id uuid primary key,
  operation_id text not null,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  origin_reservation_id uuid not null references public.reservations(id) on delete restrict,
  effective_reservation_id uuid not null references public.reservations(id) on delete restrict,
  from_projection_session_id uuid not null,
  to_projection_session_id uuid not null,
  from_effective_session_id uuid not null,
  to_effective_session_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_session_assignments_operation_booking_key
    unique (operation_id, booking_id),
  constraint reservation_session_assignments_projection_from_fkey
    foreign key (from_projection_session_id, origin_reservation_id)
    references public.reservation_sessions(id, reservation_id) on delete restrict,
  constraint reservation_session_assignments_projection_to_fkey
    foreign key (to_projection_session_id, origin_reservation_id)
    references public.reservation_sessions(id, reservation_id) on delete restrict,
  constraint reservation_session_assignments_effective_from_fkey
    foreign key (from_effective_session_id, effective_reservation_id)
    references public.reservation_sessions(id, reservation_id) on delete restrict,
  constraint reservation_session_assignments_effective_to_fkey
    foreign key (to_effective_session_id, effective_reservation_id)
    references public.reservation_sessions(id, reservation_id) on delete restrict,
  constraint reservation_session_assignments_changed_check
    check (
      from_projection_session_id <> to_projection_session_id
      or from_effective_session_id <> to_effective_session_id
    )
);

comment on table public.reservation_session_assignments is
  'Append-only lineage for moving a Court allocation between Sessions without changing its immutable Reservation origin.';

create index reservation_session_assignments_booking_created_idx
  on public.reservation_session_assignments (booking_id, created_at desc, id);
create index reservation_session_assignments_origin_idx
  on public.reservation_session_assignments (origin_reservation_id, id);
create index reservation_session_assignments_effective_idx
  on public.reservation_session_assignments (effective_reservation_id, id);
create index reservation_session_assignments_actor_idx
  on public.reservation_session_assignments (actor_id)
  where actor_id is not null;

alter table public.reservation_session_assignments enable row level security;
alter table public.reservation_session_assignments force row level security;

create policy "managers read reservation session assignments"
on public.reservation_session_assignments for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));

revoke all on table public.reservation_session_assignments
from public, anon, authenticated, service_role;
grant select on table public.reservation_session_assignments to authenticated;

create trigger reservation_session_assignments_immutable
before update or delete on public.reservation_session_assignments
for each row execute function private.reject_reservation_history_mutation();

alter table public.reservation_allocation_memberships
  add column last_session_assignment_id uuid
    references public.reservation_session_assignments(id) on delete restrict;

alter table public.reservation_allocation_memberships
  drop constraint reservation_allocation_memberships_transition_shape_check;
alter table public.reservation_allocation_memberships
  add constraint reservation_allocation_memberships_transition_shape_check
  check (
    (
      version = 0
      and last_transition_id is null
      and last_session_assignment_id is null
      and origin_reservation_id = effective_reservation_id
    )
    or
    (
      version > 0
      and (
        last_transition_id is not null
        or last_session_assignment_id is not null
      )
    )
  );

create index reservation_allocation_memberships_session_assignment_idx
  on public.reservation_allocation_memberships (last_session_assignment_id)
  where last_session_assignment_id is not null;

create or replace function private.enforce_reservation_allocation_membership_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_is_reservation_transition boolean := false;
  v_is_session_assignment boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.version <> 0
       or new.last_transition_id is not null
       or new.last_session_assignment_id is not null
       or not exists (
         select 1
         from public.bookings as booking
         where booking.id = new.booking_id
           and booking.reservation_id = new.origin_reservation_id
           and booking.reservation_id = new.effective_reservation_id
           and booking.session_id = new.effective_session_id
       ) then
      raise exception using
        errcode = '55000',
        message = 'Initial membership must match physical booking ownership';
    end if;

    new.updated_at := statement_timestamp();
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Reservation allocation membership rows cannot be deleted';
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.origin_reservation_id is distinct from old.origin_reservation_id
     or new.created_at is distinct from old.created_at
     or new.version <> old.version + 1 then
    raise exception using
      errcode = '55000',
      message = 'Reservation allocation origin is immutable and versions advance by one';
  end if;

  v_is_reservation_transition :=
    new.last_transition_id is not null
    and new.last_transition_id is distinct from old.last_transition_id
    and new.last_session_assignment_id is not distinct from old.last_session_assignment_id
    and new.effective_reservation_id is distinct from old.effective_reservation_id
    and exists (
      select 1
      from public.reservation_transitions as next_transition
      where next_transition.id = new.last_transition_id
        and (
          old.last_transition_id is null
          or next_transition.sequence > (
            select previous_transition.sequence
            from public.reservation_transitions as previous_transition
            where previous_transition.id = old.last_transition_id
          )
        )
    )
    and exists (
      select 1
      from public.reservation_transition_allocations as allocation
      where allocation.transition_id = new.last_transition_id
        and allocation.booking_id = new.booking_id
        and allocation.from_reservation_id = old.effective_reservation_id
        and allocation.from_session_id = old.effective_session_id
        and allocation.to_reservation_id = new.effective_reservation_id
        and allocation.to_session_id = new.effective_session_id
    );

  v_is_session_assignment :=
    new.last_transition_id is not distinct from old.last_transition_id
    and new.last_session_assignment_id is not null
    and new.last_session_assignment_id is distinct from old.last_session_assignment_id
    and new.effective_reservation_id is not distinct from old.effective_reservation_id
    and new.effective_session_id is distinct from old.effective_session_id
    and exists (
      select 1
      from public.reservation_session_assignments as assignment
      where assignment.id = new.last_session_assignment_id
        and assignment.booking_id = new.booking_id
        and assignment.origin_reservation_id = old.origin_reservation_id
        and assignment.effective_reservation_id = old.effective_reservation_id
        and assignment.from_effective_session_id = old.effective_session_id
        and assignment.to_effective_session_id = new.effective_session_id
    );

  if v_is_reservation_transition = v_is_session_assignment then
    raise exception using
      errcode = '55000',
      message = 'Membership updates require exactly one immutable Reservation transition or Session assignment';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$function$;

create or replace function private.enforce_booking_session_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text := 'America/Toronto';
  v_activation_context text := current_setting(
    'app.reservation_phase3b_activation_operation',
    true
  );
begin
  if new.session_id is null and new.reservation_id is null then
    return new;
  end if;

  if current_user = 'postgres'
     and nullif(v_activation_context, '') is not null then
    return new;
  end if;

  select session.starts_at, session.ends_at
    into v_starts_at, v_ends_at
  from public.reservation_sessions as session
  where session.id = new.session_id
    and session.reservation_id = new.reservation_id;

  if not found then
    raise exception using
      errcode = '23503',
      constraint = 'bookings_session_reservation_fkey',
      message = 'Booking Session must belong to the same Reservation';
  end if;

  select coalesce(nullif(trim(settings.timezone), ''), v_timezone)
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;

  if new.start_at is distinct from pg_catalog.timezone(v_timezone, v_starts_at)
     or new.end_at is distinct from pg_catalog.timezone(v_timezone, v_ends_at) then
    raise exception using
      errcode = '23514',
      constraint = 'bookings_session_time_projection_check',
      message = 'Booking allocation time must match its Session in the venue timezone';
  end if;

  return new;
end;
$function$;

create function private.assert_booking_session_projection_at_commit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_invalid boolean;
begin
  select exists (
    select 1
    from public.bookings as booking
    cross join public.venue_settings as settings
    left join public.reservation_sessions as session
      on session.id = booking.session_id
     and session.reservation_id = booking.reservation_id
    where booking.id = new.id
      and booking.reservation_id is not null
      and (
        session.id is null
        or booking.start_at is distinct from
          pg_catalog.timezone(settings.timezone, session.starts_at)
        or booking.end_at is distinct from
          pg_catalog.timezone(settings.timezone, session.ends_at)
      )
  ) into v_invalid;

  if v_invalid then
    raise exception using
      errcode = '23514',
      constraint = 'bookings_phase3b_projection_commit_check',
      message = 'Phase 3B writer left a Booking/Session projection mismatch';
  end if;
  return null;
end;
$function$;

create constraint trigger bookings_phase3b_projection_commit_check
after insert or update of reservation_id, session_id, start_at, end_at
on public.bookings
deferrable initially deferred
for each row execute function private.assert_booking_session_projection_at_commit();

create function private.reservation_phase3b_public_operation_id(
  p_operation_type text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_headers jsonb;
  v_idempotency_key text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  v_idempotency_key := nullif(trim(v_headers ->> 'x-idempotency-key'), '');
  if v_idempotency_key is not null then
    if v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$' then
      raise exception using
        errcode = '22023',
        message = 'x-idempotency-key must be 1 to 120 opaque characters';
    end if;
    return 'rpc:' || v_idempotency_key;
  end if;

  return 'rpc:' || p_operation_type || ':' || gen_random_uuid()::text;
end;
$function$;

create function private.reservation_phase3b_enter_activation_context(
  p_operation_id text
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'Phase 3B activation context requires a trusted writer';
  end if;
  perform pg_catalog.set_config(
    'app.reservation_phase3b_activation_operation',
    p_operation_id,
    true
  );
end;
$function$;

create or replace function private.reservation_phase3b_audit(
  p_operation_id text,
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  insert into private.app_audit_events (
    operation_id,
    event_type,
    entity_type,
    entity_id,
    actor_id,
    actor_kind,
    source,
    changed_fields,
    metadata
  ) values (
    p_operation_id,
    p_event_type,
    p_entity_type,
    p_entity_id,
    p_actor_id,
    case
      when p_actor_id is null then 'system'
      when exists (
        select 1 from public.staff_members as staff
        where staff.user_id = p_actor_id and staff.role = 'admin'
      ) then 'manager'
      else 'customer'
    end,
    'reservation_phase3b_kernel',
    '{}'::text[],
    jsonb_build_object('schema_version', 2, 'inactive_kernel', false)
      || coalesce(p_metadata, '{}'::jsonb)
  )
$function$;

create function private.reservation_phase3b_sync_legacy_schedule(
  p_booking_ids uuid[],
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_booking_ids uuid[];
  v_claim record;
  v_request jsonb;
  v_booking public.bookings%rowtype;
  v_membership public.reservation_allocation_memberships%rowtype;
  v_projection_session public.reservation_sessions%rowtype;
  v_effective_session public.reservation_sessions%rowtype;
  v_projection_session_id uuid;
  v_effective_session_id uuid;
  v_assignment_id uuid;
  v_booking_id uuid;
  v_timezone text;
  v_changed integer := 0;
begin
  select array_agg(distinct booking_id order by booking_id)
    into v_booking_ids
  from unnest(p_booking_ids) as booking_id;

  if coalesce(cardinality(v_booking_ids), 0) = 0
     or v_booking_ids is distinct from p_booking_ids
     or array_position(v_booking_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Schedule synchronization requires a sorted, distinct booking scope';
  end if;

  v_request := jsonb_build_object('booking_ids', v_booking_ids);
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'sync_legacy_schedule',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'changed_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(v_booking_ids);
  select coalesce(nullif(trim(settings.timezone), ''), 'America/Toronto')
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;

  foreach v_booking_id in array v_booking_ids loop
    select booking.* into v_booking
    from public.bookings as booking
    where booking.id = v_booking_id;

    select membership.* into v_membership
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = v_booking_id;

    select session.* into v_projection_session
    from public.reservation_sessions as session
    where session.id = v_booking.session_id
      and session.reservation_id = v_booking.reservation_id;

    select session.* into v_effective_session
    from public.reservation_sessions as session
    where session.id = v_membership.effective_session_id
      and session.reservation_id = v_membership.effective_reservation_id;

    if pg_catalog.timezone(v_timezone, v_projection_session.starts_at)
         is not distinct from v_booking.start_at
       and pg_catalog.timezone(v_timezone, v_projection_session.ends_at)
         is not distinct from v_booking.end_at
       and pg_catalog.timezone(v_timezone, v_effective_session.starts_at)
         is not distinct from v_booking.start_at
       and pg_catalog.timezone(v_timezone, v_effective_session.ends_at)
         is not distinct from v_booking.end_at then
      continue;
    end if;

    v_projection_session_id := private.reservation_phase3_uuid(
      'session',
      'phase3b-schedule:' || p_operation_id
        || ':projection:' || v_booking.reservation_id::text
        || ':group:' || v_booking.booking_group_id::text
        || ':start:' || v_booking.start_at::text
        || ':end:' || v_booking.end_at::text
    );

    insert into public.reservation_sessions (
      id, reservation_id, starts_at, ends_at, party_size, notes, source, created_by
    ) values (
      v_projection_session_id,
      v_booking.reservation_id,
      pg_catalog.timezone(v_timezone, v_booking.start_at),
      pg_catalog.timezone(v_timezone, v_booking.end_at),
      v_booking.party_size,
      v_booking.customer_notes,
      'system',
      p_actor_id
    ) on conflict (id) do nothing;

    if v_membership.effective_reservation_id = v_booking.reservation_id then
      v_effective_session_id := v_projection_session_id;
    else
      v_effective_session_id := private.reservation_phase3_uuid(
        'session',
        'phase3b-schedule:' || p_operation_id
          || ':effective:' || v_membership.effective_reservation_id::text
          || ':group:' || v_booking.booking_group_id::text
          || ':start:' || v_booking.start_at::text
          || ':end:' || v_booking.end_at::text
      );
      insert into public.reservation_sessions (
        id, reservation_id, starts_at, ends_at, party_size, notes, source, created_by
      ) values (
        v_effective_session_id,
        v_membership.effective_reservation_id,
        pg_catalog.timezone(v_timezone, v_booking.start_at),
        pg_catalog.timezone(v_timezone, v_booking.end_at),
        v_booking.party_size,
        v_booking.customer_notes,
        'system',
        p_actor_id
      ) on conflict (id) do nothing;
    end if;

    v_assignment_id := private.reservation_phase3_uuid(
      'session_assignment',
      'phase3b-operation:' || p_operation_id || ':booking:' || v_booking.id::text
    );

    insert into public.reservation_session_assignments (
      id,
      operation_id,
      booking_id,
      origin_reservation_id,
      effective_reservation_id,
      from_projection_session_id,
      to_projection_session_id,
      from_effective_session_id,
      to_effective_session_id,
      actor_id
    ) values (
      v_assignment_id,
      p_operation_id,
      v_booking.id,
      v_membership.origin_reservation_id,
      v_membership.effective_reservation_id,
      v_booking.session_id,
      v_projection_session_id,
      v_membership.effective_session_id,
      v_effective_session_id,
      p_actor_id
    );

    update public.reservation_allocation_memberships
       set effective_session_id = v_effective_session_id,
           last_session_assignment_id = v_assignment_id,
           version = version + 1
     where booking_id = v_booking.id;

    update public.bookings
       set session_id = v_projection_session_id
     where id = v_booking.id;

    v_changed := v_changed + 1;
  end loop;

  if exists (
    select 1
    from public.bookings as booking
    cross join public.venue_settings as settings
    left join public.reservation_sessions as projection
      on projection.id = booking.session_id
     and projection.reservation_id = booking.reservation_id
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = booking.id
    left join public.reservation_sessions as effective
      on effective.id = membership.effective_session_id
     and effective.reservation_id = membership.effective_reservation_id
    where booking.id = any(v_booking_ids)
      and (
        projection.id is null
        or effective.id is null
        or booking.start_at is distinct from
          pg_catalog.timezone(settings.timezone, projection.starts_at)
        or booking.end_at is distinct from
          pg_catalog.timezone(settings.timezone, projection.ends_at)
        or booking.start_at is distinct from
          pg_catalog.timezone(settings.timezone, effective.starts_at)
        or booking.end_at is distinct from
          pg_catalog.timezone(settings.timezone, effective.ends_at)
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phase 3B schedule synchronization left a projection mismatch';
  end if;

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.schedule_synchronized',
    'reservation_session_assignment',
    null,
    p_actor_id,
    jsonb_build_object(
      'booking_count', cardinality(v_booking_ids),
      'changed_count', v_changed
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    null,
    jsonb_build_object('changed_count', v_changed)
  );
  return v_changed;
end;
$function$;

create or replace function private.reservation_phase3b_update_booking_details(
  p_booking_ids uuid[],
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_notes text,
  p_party_size smallint,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
  v_effective_session_ids uuid[];
  v_projection_session_ids uuid[];
  v_effective_reservation_ids uuid[];
  v_group_ids uuid[];
begin
  if nullif(trim(p_customer_name), '') is null
     or length(p_customer_name) > 200
     or length(coalesce(p_customer_email, '')) > 320
     or length(coalesce(p_customer_phone, '')) > 40
     or length(coalesce(p_customer_notes, '')) > 2000
     or p_party_size not between 1 and 8 then
    raise exception using
      errcode = '22023',
      message = 'Customer details or party size are invalid';
  end if;

  v_request := jsonb_build_object(
    'booking_ids', p_booking_ids,
    'customer_name_hash', md5(p_customer_name),
    'customer_email_hash', md5(coalesce(p_customer_email, '')),
    'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
    'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
    'party_size', p_party_size
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'update_booking_details',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'booking_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(p_booking_ids);

  select
    array_agg(distinct membership.effective_session_id
      order by membership.effective_session_id),
    array_agg(distinct booking.session_id order by booking.session_id),
    array_agg(distinct membership.effective_reservation_id
      order by membership.effective_reservation_id),
    array_agg(distinct booking.booking_group_id
      order by booking.booking_group_id)
    into
      v_effective_session_ids,
      v_projection_session_ids,
      v_effective_reservation_ids,
      v_group_ids
  from public.reservation_allocation_memberships as membership
  join public.bookings as booking on booking.id = membership.booking_id
  where membership.booking_id = any(p_booking_ids);

  if exists (
    select 1
    from public.reservation_allocation_memberships as membership
    where membership.effective_session_id = any(v_effective_session_ids)
      and not (membership.booking_id = any(p_booking_ids))
  ) then
    raise exception using
      errcode = '22023',
      message = 'Booking detail scope must include every allocation in each affected Session';
  end if;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config('app.audit_event_type', 'booking.details_updated', true);
  perform pg_catalog.set_config('app.audit_source', 'reservation_phase3b_kernel', true);

  update public.reservations as reservation
     set notes = p_customer_notes
   where reservation.id = any(v_effective_reservation_ids);

  update public.reservation_sessions as session
     set party_size = p_party_size,
         notes = p_customer_notes
   where session.id = any(v_effective_session_ids)
      or session.id = any(v_projection_session_ids);

  update public.bookings as booking
     set customer_name = trim(p_customer_name),
         customer_email = lower(nullif(trim(p_customer_email), '')),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_notes = nullif(trim(p_customer_notes), ''),
         party_size = p_party_size
   where booking.id = any(p_booking_ids);

  with recursive affected_parties as (
    select party.id
    from public.reservation_parties as party
    where party.legacy_booking_group_id = any(v_group_ids)

    union

    select lineage.target_party_id
    from affected_parties as affected
    join public.reservation_transition_parties as lineage
      on lineage.source_party_id = affected.id
  )
  update public.reservation_parties as party
     set display_name = trim(p_customer_name),
         email = lower(nullif(trim(p_customer_email), '')),
         phone = nullif(trim(p_customer_phone), '')
   where party.id in (select affected.id from affected_parties as affected)
     and (
       party.legacy_booking_group_id = any(v_group_ids)
       or party.reservation_id = any(v_effective_reservation_ids)
     );

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.details_updated',
    'reservation',
    case when cardinality(v_effective_reservation_ids) = 1
      then v_effective_reservation_ids[1]::text
      else null
    end,
    p_actor_id,
    jsonb_build_object('booking_count', cardinality(p_booking_ids))
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    case when cardinality(v_effective_reservation_ids) = 1
      then v_effective_reservation_ids[1]
      else null
    end,
    jsonb_build_object('booking_count', cardinality(p_booking_ids))
  );
  return cardinality(p_booking_ids);
end;
$function$;

create function private.reservation_phase3b_mark_scope_paid(
  p_booking_ids uuid[],
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_booking_ids uuid[];
  v_reservation_id uuid;
  v_reservation_booking_ids uuid[];
  v_amounts numeric[];
  v_claim record;
  v_request jsonb;
  v_updated integer := 0;
begin
  select array_agg(distinct booking_id order by booking_id)
    into v_booking_ids
  from unnest(p_booking_ids) as booking_id;
  if coalesce(cardinality(v_booking_ids), 0) = 0
     or v_booking_ids is distinct from p_booking_ids then
    raise exception using
      errcode = '22023',
      message = 'Payment scope must be a sorted, distinct booking array';
  end if;

  v_request := jsonb_build_object('booking_ids', v_booking_ids);
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'mark_scope_paid',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'updated_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(v_booking_ids);

  for v_reservation_id in
    select distinct membership.effective_reservation_id
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_booking_ids)
    order by membership.effective_reservation_id
  loop
    select
      array_agg(scope.booking_id order by scope.booking_id),
      array_agg(scope.remaining_amount order by scope.booking_id)
      into v_reservation_booking_ids, v_amounts
    from (
      select
        booking.id as booking_id,
        round(booking.total_amount - coalesce(sum(entry.amount) filter (
          where payment.status = 'succeeded'
        ), 0), 2) as remaining_amount
      from public.bookings as booking
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = booking.id
      left join public.payment_allocation_entries as entry
        on entry.booking_id = booking.id
      left join public.payments as payment on payment.id = entry.payment_id
      where booking.id = any(v_booking_ids)
        and membership.effective_reservation_id = v_reservation_id
        and booking.status in ('held', 'confirmed')
      group by booking.id, booking.total_amount
      having round(booking.total_amount - coalesce(sum(entry.amount) filter (
        where payment.status = 'succeeded'
      ), 0), 2) > 0
      order by booking.id
    ) as scope;

    if coalesce(cardinality(v_reservation_booking_ids), 0) <> 0 then
      perform private.reservation_phase3b_record_payment(
        v_reservation_id,
        v_reservation_booking_ids,
        v_amounts,
        'venue',
        p_operation_id || ':reservation:' || v_reservation_id::text,
        statement_timestamp(),
        null,
        p_actor_id
      );
      v_updated := v_updated + cardinality(v_reservation_booking_ids);
    end if;
  end loop;

  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    null,
    jsonb_build_object('updated_count', v_updated)
  );
  return v_updated;
end;
$function$;

create function private.reservation_phase3b_refund_scope(
  p_booking_ids uuid[],
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_booking_ids uuid[];
  v_payment_id uuid;
  v_entry_ids bigint[];
  v_amounts numeric[];
  v_claim record;
  v_request jsonb;
  v_refunded integer := 0;
begin
  select array_agg(distinct booking_id order by booking_id)
    into v_booking_ids
  from unnest(p_booking_ids) as booking_id;
  if coalesce(cardinality(v_booking_ids), 0) = 0
     or v_booking_ids is distinct from p_booking_ids then
    raise exception using
      errcode = '22023',
      message = 'Refund scope must be a sorted, distinct booking array';
  end if;

  v_request := jsonb_build_object('booking_ids', v_booking_ids);
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'refund_scope',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'refunded_booking_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(v_booking_ids);

  for v_payment_id in
    select distinct original.payment_id
    from public.payment_allocation_entries as original
    join public.payments as payment on payment.id = original.payment_id
    where original.booking_id = any(v_booking_ids)
      and original.amount > 0
      and payment.kind = 'payment'
      and payment.status = 'succeeded'
    order by original.payment_id
  loop
    select
      array_agg(balance.entry_id order by balance.entry_id),
      array_agg(balance.remaining_amount order by balance.entry_id)
      into v_entry_ids, v_amounts
    from (
      select
        original.id as entry_id,
        round(original.amount + coalesce(sum(reversal.amount) filter (
          where refund.status = 'succeeded'
        ), 0), 2) as remaining_amount
      from public.payment_allocation_entries as original
      left join public.payment_allocation_entries as reversal
        on reversal.reverses_entry_id = original.id
      left join public.payments as refund on refund.id = reversal.payment_id
      where original.payment_id = v_payment_id
        and original.booking_id = any(v_booking_ids)
        and original.amount > 0
      group by original.id, original.amount
      having round(original.amount + coalesce(sum(reversal.amount) filter (
        where refund.status = 'succeeded'
      ), 0), 2) > 0
      order by original.id
    ) as balance;

    if coalesce(cardinality(v_entry_ids), 0) <> 0 then
      perform private.reservation_phase3b_refund_payment(
        v_payment_id,
        v_entry_ids,
        v_amounts,
        p_operation_id || ':payment:' || v_payment_id::text,
        statement_timestamp(),
        p_actor_id
      );
      v_refunded := v_refunded + cardinality(v_entry_ids);
    end if;
  end loop;

  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    null,
    jsonb_build_object('refunded_booking_count', v_refunded)
  );
  return v_refunded;
end;
$function$;

create function private.reservation_phase3b_prepare_target(
  p_target_reservation_id uuid,
  p_source_party_ids uuid[],
  p_primary_source_party_id uuid,
  p_payment_plan text,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source_party_ids uuid[];
  v_target_party_ids uuid[] := '{}'::uuid[];
  v_source_party_id uuid;
  v_target_party_id uuid;
  v_source_reservation_ids uuid[];
  v_currency character(3);
  v_primary_target_party_id uuid;
begin
  select array_agg(distinct party_id order by party_id)
    into v_source_party_ids
  from unnest(p_source_party_ids) as party_id;
  if coalesce(cardinality(v_source_party_ids), 0) = 0
     or v_source_party_ids is distinct from p_source_party_ids
     or not (p_primary_source_party_id = any(v_source_party_ids))
     or p_payment_plan not in (
       'single_payer', 'split_equal', 'split_custom', 'legacy_unspecified'
     ) then
    raise exception using
      errcode = '22023',
      message = 'Transition target Party scope, primary contact, or payment plan is invalid';
  end if;

  select
    array_agg(distinct party.reservation_id order by party.reservation_id),
    min(reservation.currency)
    into v_source_reservation_ids, v_currency
  from public.reservation_parties as party
  join public.reservations as reservation on reservation.id = party.reservation_id
  where party.id = any(v_source_party_ids);

  if (
    select count(*) from public.reservation_parties as party
    where party.id = any(v_source_party_ids)
  ) <> cardinality(v_source_party_ids)
     or (
       select count(distinct reservation.currency)
       from public.reservations as reservation
       where reservation.id = any(v_source_reservation_ids)
     ) <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Transition target Parties must exist in one currency scope';
  end if;

  insert into public.reservations (
    id, currency, payment_plan, source, created_by
  ) values (
    p_target_reservation_id,
    v_currency,
    p_payment_plan,
    'system',
    p_actor_id
  );

  foreach v_source_party_id in array v_source_party_ids loop
    v_target_party_id := private.reservation_phase3_uuid(
      'party',
      'phase3b-operation:' || p_operation_id
        || ':target:' || p_target_reservation_id::text
        || ':source-party:' || v_source_party_id::text
    );
    v_target_party_ids := array_append(v_target_party_ids, v_target_party_id);

    insert into public.reservation_parties (
      id, reservation_id, party_type, display_name, email, phone,
      auth_user_id, source, created_by
    )
    select
      v_target_party_id,
      p_target_reservation_id,
      party.party_type,
      party.display_name,
      party.email,
      party.phone,
      party.auth_user_id,
      'system',
      p_actor_id
    from public.reservation_parties as party
    where party.id = v_source_party_id;

    insert into public.reservation_party_roles (
      reservation_id, party_id, role, created_by
    )
    select
      p_target_reservation_id,
      v_target_party_id,
      role.role,
      p_actor_id
    from public.reservation_party_roles as role
    where role.party_id = v_source_party_id
      and role.role <> 'primary_contact'
    on conflict do nothing;

    if v_source_party_id = p_primary_source_party_id then
      v_primary_target_party_id := v_target_party_id;
    end if;
  end loop;

  insert into public.reservation_party_roles (
    reservation_id, party_id, role, created_by
  ) values (
    p_target_reservation_id,
    v_primary_target_party_id,
    'primary_contact',
    p_actor_id
  );

  return jsonb_build_object(
    'source_party_ids', to_jsonb(v_source_party_ids),
    'target_party_ids', to_jsonb(v_target_party_ids),
    'primary_target_party_id', v_primary_target_party_id
  );
end;
$function$;

create function private.reservation_phase3b_merge_bookings(
  p_source_booking_id uuid,
  p_target_booking_id uuid,
  p_primary_source_party_id uuid,
  p_payment_plan text,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source_reservation_ids uuid[];
  v_booking_ids uuid[];
  v_source_party_ids uuid[];
  v_target_party_ids uuid[];
  v_booking_target_ids uuid[];
  v_primary_source_party_id uuid := p_primary_source_party_id;
  v_primary_target_party_id uuid;
  v_target_reservation_id uuid;
  v_transition_id uuid;
  v_claim record;
  v_request jsonb;
  v_target jsonb;
  v_linked_group_count integer;
begin
  if p_source_booking_id = p_target_booking_id then
    raise exception using errcode = '22023', message = 'Choose a different booking to link';
  end if;
  if p_payment_plan not in ('single_payer', 'split_equal', 'split_custom') then
    raise exception using
      errcode = '22023',
      message = 'Merge payment plan must be single_payer, split_equal, or split_custom';
  end if;

  select array_agg(distinct membership.effective_reservation_id
      order by membership.effective_reservation_id)
    into v_source_reservation_ids
  from public.reservation_allocation_memberships as membership
  where membership.booking_id in (p_source_booking_id, p_target_booking_id);

  if cardinality(v_source_reservation_ids) <> 2 then
    raise exception using
      errcode = '23514',
      message = 'Link requires two bookings in different effective Reservations';
  end if;

  v_request := jsonb_build_object(
    'source_booking_id', p_source_booking_id,
    'target_booking_id', p_target_booking_id,
    'primary_source_party_id', p_primary_source_party_id,
    'payment_plan', p_payment_plan
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'merge_booking_reservations',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return v_claim.result_payload;
  end if;

  select array_agg(booking.id order by booking.id)
    into v_booking_ids
  from public.bookings as booking
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where membership.effective_reservation_id = any(v_source_reservation_ids);

  select array_agg(party.id order by party.id)
    into v_source_party_ids
  from public.reservation_parties as party
  where party.reservation_id = any(v_source_reservation_ids);

  if v_primary_source_party_id is null then
    select (array_agg(party.id order by party.id))[1]
      into v_primary_source_party_id
    from public.reservation_parties as party
    join public.reservation_party_roles as role
      on role.party_id = party.id
     and role.reservation_id = party.reservation_id
     and role.role = 'primary_contact'
    where party.reservation_id = any(v_source_reservation_ids)
      and party.auth_user_id is not null
    having count(*) = cardinality(v_source_reservation_ids)
       and count(distinct party.auth_user_id) = 1;

    if v_primary_source_party_id is null then
      raise exception using
        errcode = '22023',
        message = 'Different or unauthenticated contacts require explicit primary_source_party_id';
    end if;
  elsif not exists (
    select 1 from public.reservation_parties as party
    where party.id = v_primary_source_party_id
      and party.reservation_id = any(v_source_reservation_ids)
  ) then
    raise exception using
      errcode = '23503',
      message = 'Explicit primary Party must belong to one source Reservation';
  end if;

  v_target_reservation_id := private.reservation_phase3_uuid(
    'reservation',
    'phase3b-operation:' || p_operation_id || ':merge-target'
  );
  v_target := private.reservation_phase3b_prepare_target(
    v_target_reservation_id,
    v_source_party_ids,
    v_primary_source_party_id,
    p_payment_plan,
    p_operation_id,
    p_actor_id
  );

  select array_agg(value::uuid order by position)
    into v_target_party_ids
  from jsonb_array_elements_text(v_target -> 'target_party_ids')
    with ordinality as requested(value, position);
  v_primary_target_party_id := (v_target ->> 'primary_target_party_id')::uuid;
  select array_agg(v_target_reservation_id order by booking_id)
    into v_booking_target_ids
  from unnest(v_booking_ids) as booking_id;

  v_transition_id := private.reservation_phase3b_apply_transition(
    'merge',
    v_source_reservation_ids,
    array[v_target_reservation_id]::uuid[],
    array[v_primary_target_party_id]::uuid[],
    v_booking_ids,
    v_booking_target_ids,
    v_source_party_ids,
    v_target_party_ids,
    p_operation_id || ':transition',
    p_actor_id
  );

  select count(distinct booking.booking_group_id)::integer
    into v_linked_group_count
  from public.bookings as booking
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where membership.effective_reservation_id = v_target_reservation_id;

  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    v_transition_id,
    jsonb_build_object(
      'booking_link_id', v_target_reservation_id,
      'linked_booking_count', cardinality(v_booking_ids),
      'linked_group_count', v_linked_group_count,
      'transition_id', v_transition_id
    )
  );
  return jsonb_build_object(
    'booking_link_id', v_target_reservation_id,
    'linked_booking_count', cardinality(v_booking_ids),
    'linked_group_count', v_linked_group_count,
    'transition_id', v_transition_id
  );
end;
$function$;

create function private.reservation_phase3b_party_origin_groups(
  p_party_id uuid
)
returns uuid[]
language sql
stable
security invoker
set search_path = ''
as $function$
  with recursive ancestors(party_id) as (
    select p_party_id
    union
    select lineage.source_party_id
    from ancestors as current_party
    join public.reservation_transition_parties as lineage
      on lineage.target_party_id = current_party.party_id
  )
  select coalesce(
    array_agg(distinct party.legacy_booking_group_id
      order by party.legacy_booking_group_id)
      filter (where party.legacy_booking_group_id is not null),
    '{}'::uuid[]
  )
  from ancestors
  join public.reservation_parties as party on party.id = ancestors.party_id
$function$;

create function private.reservation_phase3b_split_legacy_group(
  p_booking_id uuid,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source_reservation_id uuid;
  v_source_reservation_ids uuid[];
  v_selected_group_id uuid;
  v_previous_link_id uuid;
  v_group_ids uuid[];
  v_remaining_group_ids uuid[];
  v_booking_ids uuid[];
  v_booking_target_ids uuid[];
  v_selected_target_id uuid;
  v_remaining_target_id uuid;
  v_target_ids uuid[];
  v_selected_source_party_ids uuid[];
  v_remaining_source_party_ids uuid[];
  v_selected_target_party_ids uuid[];
  v_remaining_target_party_ids uuid[];
  v_source_party_ids uuid[];
  v_target_party_ids uuid[];
  v_primary_selected_source_id uuid;
  v_primary_remaining_source_id uuid;
  v_primary_selected_target_id uuid;
  v_primary_remaining_target_id uuid;
  v_target_primary_party_ids uuid[];
  v_payment_plan text;
  v_selected_target jsonb;
  v_remaining_target jsonb;
  v_transition_id uuid;
  v_claim record;
  v_request jsonb;
  v_remaining_group_count integer;
begin
  select
    membership.effective_reservation_id,
    booking.booking_group_id,
    booking.booking_link_id
    into v_source_reservation_id, v_selected_group_id, v_previous_link_id
  from public.bookings as booking
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where booking.id = p_booking_id;

  if v_source_reservation_id is null then
    raise exception using errcode = '23503', message = 'Booking not found';
  end if;
  if v_previous_link_id is null then
    raise exception using errcode = '22023', message = 'Booking is not linked';
  end if;

  select array_agg(distinct booking.booking_group_id order by booking.booking_group_id)
    into v_group_ids
  from public.bookings as booking
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where membership.effective_reservation_id = v_source_reservation_id;

  if cardinality(v_group_ids) < 2 then
    raise exception using
      errcode = '23514',
      message = 'Effective Reservation does not contain multiple legacy groups';
  end if;
  select array_agg(group_id order by group_id)
    into v_remaining_group_ids
  from unnest(v_group_ids) as group_id
  where group_id <> v_selected_group_id;

  v_request := jsonb_build_object(
    'booking_id', p_booking_id,
    'source_reservation_id', v_source_reservation_id,
    'selected_group_id', v_selected_group_id
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'split_legacy_group',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return v_claim.result_payload;
  end if;

  select reservation.payment_plan
    into v_payment_plan
  from public.reservations as reservation
  where reservation.id = v_source_reservation_id;

  select array_agg(booking.id order by booking.id)
    into v_booking_ids
  from public.bookings as booking
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where membership.effective_reservation_id = v_source_reservation_id;

  select array_agg(party.id order by party.id)
    into v_selected_source_party_ids
  from public.reservation_parties as party
  where party.reservation_id = v_source_reservation_id
    and v_selected_group_id = any(
      private.reservation_phase3b_party_origin_groups(party.id)
    );

  select array_agg(party.id order by party.id)
    into v_remaining_source_party_ids
  from public.reservation_parties as party
  where party.reservation_id = v_source_reservation_id
    and private.reservation_phase3b_party_origin_groups(party.id)
      && v_remaining_group_ids;

  if coalesce(cardinality(v_selected_source_party_ids), 0) = 0
     or coalesce(cardinality(v_remaining_source_party_ids), 0) = 0
     or exists (
       select party.id
       from public.reservation_parties as party
       where party.reservation_id = v_source_reservation_id
       except
       select party_id from unnest(
         v_selected_source_party_ids || v_remaining_source_party_ids
       ) as party_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'Split cannot map every current Party to an original legacy group';
  end if;

  select (array_agg(role.party_id order by role.party_id))[1]
    into v_primary_selected_source_id
  from public.reservation_party_roles as role
  where role.reservation_id = v_source_reservation_id
    and role.party_id = any(v_selected_source_party_ids)
    and role.role = 'primary_contact';
  v_primary_selected_source_id := coalesce(
    v_primary_selected_source_id,
    v_selected_source_party_ids[1]
  );

  select (array_agg(role.party_id order by role.party_id))[1]
    into v_primary_remaining_source_id
  from public.reservation_party_roles as role
  where role.reservation_id = v_source_reservation_id
    and role.party_id = any(v_remaining_source_party_ids)
    and role.role = 'primary_contact';
  v_primary_remaining_source_id := coalesce(
    v_primary_remaining_source_id,
    v_remaining_source_party_ids[1]
  );

  v_selected_target_id := private.reservation_phase3_uuid(
    'reservation',
    'phase3b-operation:' || p_operation_id || ':split-selected'
  );
  v_remaining_target_id := private.reservation_phase3_uuid(
    'reservation',
    'phase3b-operation:' || p_operation_id || ':split-remaining'
  );

  v_selected_target := private.reservation_phase3b_prepare_target(
    v_selected_target_id,
    v_selected_source_party_ids,
    v_primary_selected_source_id,
    v_payment_plan,
    p_operation_id || ':selected',
    p_actor_id
  );
  v_remaining_target := private.reservation_phase3b_prepare_target(
    v_remaining_target_id,
    v_remaining_source_party_ids,
    v_primary_remaining_source_id,
    v_payment_plan,
    p_operation_id || ':remaining',
    p_actor_id
  );

  select array_agg(value::uuid order by position)
    into v_selected_target_party_ids
  from jsonb_array_elements_text(v_selected_target -> 'target_party_ids')
    with ordinality as requested(value, position);
  select array_agg(value::uuid order by position)
    into v_remaining_target_party_ids
  from jsonb_array_elements_text(v_remaining_target -> 'target_party_ids')
    with ordinality as requested(value, position);

  v_primary_selected_target_id :=
    (v_selected_target ->> 'primary_target_party_id')::uuid;
  v_primary_remaining_target_id :=
    (v_remaining_target ->> 'primary_target_party_id')::uuid;

  v_source_party_ids :=
    v_selected_source_party_ids || v_remaining_source_party_ids;
  v_target_party_ids :=
    v_selected_target_party_ids || v_remaining_target_party_ids;

  select array_agg(
      case when booking.booking_group_id = v_selected_group_id
        then v_selected_target_id
        else v_remaining_target_id
      end
      order by booking.id
    )
    into v_booking_target_ids
  from public.bookings as booking
  where booking.id = any(v_booking_ids);

  if v_selected_target_id < v_remaining_target_id then
    v_target_ids := array[v_selected_target_id, v_remaining_target_id]::uuid[];
    v_target_primary_party_ids := array[
      v_primary_selected_target_id,
      v_primary_remaining_target_id
    ]::uuid[];
  else
    v_target_ids := array[v_remaining_target_id, v_selected_target_id]::uuid[];
    v_target_primary_party_ids := array[
      v_primary_remaining_target_id,
      v_primary_selected_target_id
    ]::uuid[];
  end if;

  v_source_reservation_ids := array[v_source_reservation_id]::uuid[];
  v_transition_id := private.reservation_phase3b_apply_transition(
    'split',
    v_source_reservation_ids,
    v_target_ids,
    v_target_primary_party_ids,
    v_booking_ids,
    v_booking_target_ids,
    v_source_party_ids,
    v_target_party_ids,
    p_operation_id || ':transition',
    p_actor_id
  );

  v_remaining_group_count := case
    when cardinality(v_remaining_group_ids) > 1
      then cardinality(v_remaining_group_ids)
    else 0
  end;

  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    v_transition_id,
    jsonb_build_object(
      'previous_booking_link_id', v_previous_link_id,
      'unlinked_group_id', v_selected_group_id,
      'affected_booking_count', cardinality(v_booking_ids),
      'remaining_group_count', v_remaining_group_count,
      'transition_id', v_transition_id
    )
  );
  return jsonb_build_object(
    'previous_booking_link_id', v_previous_link_id,
    'unlinked_group_id', v_selected_group_id,
    'affected_booking_count', cardinality(v_booking_ids),
    'remaining_group_count', v_remaining_group_count,
    'transition_id', v_transition_id
  );
end;
$function$;

create function private.reservation_phase3b_begin_public_operation(
  p_operation_type text,
  p_request jsonb,
  p_actor_id uuid
)
returns table (
  operation_id text,
  already_completed boolean,
  result_entity_id uuid,
  result_payload jsonb
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_operation_id text;
  v_claim record;
begin
  v_operation_id := private.reservation_phase3b_public_operation_id(
    p_operation_type
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    v_operation_id,
    p_operation_type,
    private.reservation_phase3b_request_fingerprint(p_request),
    p_actor_id
  );
  return query select
    v_operation_id,
    v_claim.already_completed,
    v_claim.result_entity_id,
    v_claim.result_payload;
end;
$function$;

-- Move the exact reviewed implementations behind the private boundary. The
-- public names are recreated below in the same transaction, so callers never
-- observe a partially activated catalog.
alter function public.admin_cancel_booking(uuid)
  rename to reservation_phase3b_legacy_admin_cancel_booking;
alter function public.reservation_phase3b_legacy_admin_cancel_booking(uuid)
  set schema private;

alter function public.admin_create_multi_booking(uuid[],timestamp,timestamp,text,text,smallint,text,text)
  rename to reservation_phase3b_legacy_admin_create_multi_booking;
alter function public.reservation_phase3b_legacy_admin_create_multi_booking(uuid[],timestamp,timestamp,text,text,smallint,text,text)
  set schema private;

alter function public.admin_create_multi_booking_with_price(uuid[],timestamp,timestamp,text,text,smallint,text,text,numeric)
  rename to reservation_phase3b_legacy_admin_create_multi_booking_with_price;
alter function public.reservation_phase3b_legacy_admin_create_multi_booking_with_price(uuid[],timestamp,timestamp,text,text,smallint,text,text,numeric)
  set schema private;

alter function public.admin_create_weekly_booking(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text)
  rename to reservation_phase3b_legacy_admin_create_weekly_booking;
alter function public.reservation_phase3b_legacy_admin_create_weekly_booking(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text)
  set schema private;

alter function public.admin_create_weekly_booking_with_price(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text,numeric)
  rename to reservation_phase3b_legacy_admin_create_weekly_booking_with_price;
alter function public.reservation_phase3b_legacy_admin_create_weekly_booking_with_price(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text,numeric)
  set schema private;

alter function public.admin_link_booking_groups(uuid,uuid)
  rename to reservation_phase3b_legacy_admin_link_booking_groups;
alter function public.reservation_phase3b_legacy_admin_link_booking_groups(uuid,uuid)
  set schema private;

alter function public.admin_mark_booking_paid(uuid,text)
  rename to reservation_phase3b_legacy_admin_mark_booking_paid;
alter function public.reservation_phase3b_legacy_admin_mark_booking_paid(uuid,text)
  set schema private;

alter function public.admin_move_booking_group(uuid,uuid,timestamp,timestamp)
  rename to reservation_phase3b_legacy_admin_move_booking_group;
alter function public.reservation_phase3b_legacy_admin_move_booking_group(uuid,uuid,timestamp,timestamp)
  set schema private;

alter function public.admin_reschedule_booking(uuid,uuid,timestamp,timestamp)
  rename to reservation_phase3b_legacy_admin_reschedule_booking;
alter function public.reservation_phase3b_legacy_admin_reschedule_booking(uuid,uuid,timestamp,timestamp)
  set schema private;

alter function public.admin_reschedule_booking_group(uuid,timestamp,timestamp)
  rename to reservation_phase3b_legacy_admin_reschedule_booking_group;
alter function public.reservation_phase3b_legacy_admin_reschedule_booking_group(uuid,timestamp,timestamp)
  set schema private;

alter function public.admin_revert_audit_operation(text)
  rename to reservation_phase3b_legacy_admin_revert_audit_operation;
alter function public.reservation_phase3b_legacy_admin_revert_audit_operation(text)
  set schema private;

alter function public.admin_swap_booking_schedule(uuid,uuid,timestamp)
  rename to reservation_phase3b_legacy_admin_swap_booking_schedule;
alter function public.reservation_phase3b_legacy_admin_swap_booking_schedule(uuid,uuid,timestamp)
  set schema private;

alter function public.admin_undo_booking_change(uuid)
  rename to reservation_phase3b_legacy_admin_undo_booking_change;
alter function public.reservation_phase3b_legacy_admin_undo_booking_change(uuid)
  set schema private;

alter function public.admin_unlink_booking_group(uuid)
  rename to reservation_phase3b_legacy_admin_unlink_booking_group;
alter function public.reservation_phase3b_legacy_admin_unlink_booking_group(uuid)
  set schema private;

alter function public.admin_update_booking_details(uuid,text,text,text,text,public.payment_status)
  rename to reservation_phase3b_legacy_admin_update_booking_details;
alter function public.reservation_phase3b_legacy_admin_update_booking_details(uuid,text,text,text,text,public.payment_status)
  set schema private;

alter function public.cancel_booking(uuid)
  rename to reservation_phase3b_legacy_cancel_booking;
alter function public.reservation_phase3b_legacy_cancel_booking(uuid)
  set schema private;

alter function public.create_multi_booking(uuid[],timestamp,timestamp,text,text,smallint,public.payment_method)
  rename to reservation_phase3b_legacy_create_multi_booking;
alter function public.reservation_phase3b_legacy_create_multi_booking(uuid[],timestamp,timestamp,text,text,smallint,public.payment_method)
  set schema private;

revoke all on function
  private.reservation_phase3b_legacy_admin_cancel_booking(uuid),
  private.reservation_phase3b_legacy_admin_create_multi_booking(uuid[],timestamp,timestamp,text,text,smallint,text,text),
  private.reservation_phase3b_legacy_admin_create_multi_booking_with_price(uuid[],timestamp,timestamp,text,text,smallint,text,text,numeric),
  private.reservation_phase3b_legacy_admin_create_weekly_booking(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text),
  private.reservation_phase3b_legacy_admin_create_weekly_booking_with_price(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text,numeric),
  private.reservation_phase3b_legacy_admin_link_booking_groups(uuid,uuid),
  private.reservation_phase3b_legacy_admin_mark_booking_paid(uuid,text),
  private.reservation_phase3b_legacy_admin_move_booking_group(uuid,uuid,timestamp,timestamp),
  private.reservation_phase3b_legacy_admin_reschedule_booking(uuid,uuid,timestamp,timestamp),
  private.reservation_phase3b_legacy_admin_reschedule_booking_group(uuid,timestamp,timestamp),
  private.reservation_phase3b_legacy_admin_revert_audit_operation(text),
  private.reservation_phase3b_legacy_admin_swap_booking_schedule(uuid,uuid,timestamp),
  private.reservation_phase3b_legacy_admin_undo_booking_change(uuid),
  private.reservation_phase3b_legacy_admin_unlink_booking_group(uuid),
  private.reservation_phase3b_legacy_admin_update_booking_details(uuid,text,text,text,text,public.payment_status),
  private.reservation_phase3b_legacy_cancel_booking(uuid),
  private.reservation_phase3b_legacy_create_multi_booking(uuid[],timestamp,timestamp,text,text,smallint,public.payment_method)
from public, anon, authenticated, service_role;

create function private.reservation_phase3b_payload_booking_ids(
  p_payload jsonb
)
returns uuid[]
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    array_agg(value::uuid order by position),
    '{}'::uuid[]
  )
  from jsonb_array_elements_text(coalesce(p_payload -> 'booking_ids', '[]'::jsonb))
    with ordinality as requested(value, position)
$function$;

create function public.create_multi_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_phone text,
  p_customer_notes text default null,
  p_party_size smallint default 2,
  p_payment_method public.payment_method default 'venue'
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_operation record;
  v_booking_ids uuid[];
  v_group_ids uuid[];
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.create_multi_booking',
    jsonb_build_object(
      'court_ids', p_court_ids,
      'start_at', p_start_at,
      'end_at', p_end_at,
      'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
      'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
      'party_size', p_party_size,
      'payment_method', p_payment_method
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query
    select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select
    array_agg(created.id order by created.id),
    array_agg(distinct created.booking_group_id order by created.booking_group_id)
    into v_booking_ids, v_group_ids
  from private.reservation_phase3b_legacy_create_multi_booking(
    p_court_ids,
    p_start_at,
    p_end_at,
    p_customer_phone,
    p_customer_notes,
    p_party_size,
    p_payment_method
  ) as created;

  perform private.reservation_phase3b_attach_legacy_groups(
    v_group_ids,
    v_operation.operation_id || ':attach',
    v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id,
    null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query
  select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_create_multi_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
  v_group_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_create_multi_booking',
    jsonb_build_object(
      'court_ids', p_court_ids,
      'start_at', p_start_at,
      'end_at', p_end_at,
      'customer_name_hash', md5(coalesce(p_customer_name, '')),
      'customer_email_hash', md5(coalesce(p_customer_email, '')),
      'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
      'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
      'party_size', p_party_size
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select
    array_agg(created.id order by created.id),
    array_agg(distinct created.booking_group_id order by created.booking_group_id)
    into v_booking_ids, v_group_ids
  from private.reservation_phase3b_legacy_admin_create_multi_booking(
    p_court_ids, p_start_at, p_end_at, p_customer_name, p_customer_email,
    p_party_size, p_customer_phone, p_customer_notes
  ) as created;
  perform private.reservation_phase3b_attach_legacy_groups(
    v_group_ids, v_operation.operation_id || ':attach', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_create_multi_booking_with_price(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_price_override_total numeric default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
  v_group_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_create_multi_booking_with_price',
    jsonb_build_object(
      'court_ids', p_court_ids, 'start_at', p_start_at, 'end_at', p_end_at,
      'customer_name_hash', md5(coalesce(p_customer_name, '')),
      'customer_email_hash', md5(coalesce(p_customer_email, '')),
      'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
      'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
      'party_size', p_party_size, 'price_override_total', p_price_override_total
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select
    array_agg(created.id order by created.id),
    array_agg(distinct created.booking_group_id order by created.booking_group_id)
    into v_booking_ids, v_group_ids
  from private.reservation_phase3b_legacy_admin_create_multi_booking_with_price(
    p_court_ids, p_start_at, p_end_at, p_customer_name, p_customer_email,
    p_party_size, p_customer_phone, p_customer_notes, p_price_override_total
  ) as created;
  perform private.reservation_phase3b_attach_legacy_groups(
    v_group_ids, v_operation.operation_id || ':attach', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_create_weekly_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_week_count smallint,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
  v_group_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_create_weekly_booking',
    jsonb_build_object(
      'court_ids', p_court_ids, 'start_at', p_start_at, 'end_at', p_end_at,
      'week_count', p_week_count,
      'customer_name_hash', md5(coalesce(p_customer_name, '')),
      'customer_email_hash', md5(coalesce(p_customer_email, '')),
      'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
      'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
      'party_size', p_party_size
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select
    array_agg(created.id order by created.id),
    array_agg(distinct created.booking_group_id order by created.booking_group_id)
    into v_booking_ids, v_group_ids
  from private.reservation_phase3b_legacy_admin_create_weekly_booking(
    p_court_ids, p_start_at, p_end_at, p_week_count, p_customer_name,
    p_customer_email, p_party_size, p_customer_phone, p_customer_notes
  ) as created;
  perform private.reservation_phase3b_attach_legacy_groups(
    v_group_ids, v_operation.operation_id || ':attach', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_create_weekly_booking_with_price(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_week_count smallint,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_price_override_total numeric default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
  v_group_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_create_weekly_booking_with_price',
    jsonb_build_object(
      'court_ids', p_court_ids, 'start_at', p_start_at, 'end_at', p_end_at,
      'week_count', p_week_count,
      'customer_name_hash', md5(coalesce(p_customer_name, '')),
      'customer_email_hash', md5(coalesce(p_customer_email, '')),
      'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
      'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
      'party_size', p_party_size, 'price_override_total', p_price_override_total
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select
    array_agg(created.id order by created.id),
    array_agg(distinct created.booking_group_id order by created.booking_group_id)
    into v_booking_ids, v_group_ids
  from private.reservation_phase3b_legacy_admin_create_weekly_booking_with_price(
    p_court_ids, p_start_at, p_end_at, p_week_count, p_customer_name,
    p_customer_email, p_party_size, p_customer_phone, p_customer_notes,
    p_price_override_total
  ) as created;
  perform private.reservation_phase3b_attach_legacy_groups(
    v_group_ids, v_operation.operation_id || ':attach', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_reschedule_booking(
  p_booking_id uuid,
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking public.bookings;
  v_booking_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_reschedule_booking',
    jsonb_build_object(
      'booking_id', p_booking_id, 'court_id', p_court_id,
      'start_at', p_start_at, 'end_at', p_end_at
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    select booking.* into v_booking
    from public.bookings as booking
    where booking.id = v_operation.result_entity_id;
    return v_booking;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select legacy.* into v_booking
  from private.reservation_phase3b_legacy_admin_reschedule_booking(
    p_booking_id, p_court_id, p_start_at, p_end_at
  ) as legacy;
  v_booking_ids := array[v_booking.id]::uuid[];
  perform private.reservation_phase3b_sync_legacy_schedule(
    v_booking_ids, v_operation.operation_id || ':schedule', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, v_booking.id,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  select booking.* into v_booking
  from public.bookings as booking where booking.id = p_booking_id;
  return v_booking;
end;
$function$;

create function public.admin_reschedule_booking_group(
  p_booking_id uuid,
  p_start_at timestamp,
  p_end_at timestamp
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_reschedule_booking_group',
    jsonb_build_object(
      'booking_id', p_booking_id, 'start_at', p_start_at, 'end_at', p_end_at
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select array_agg(legacy.id order by legacy.id)
    into v_booking_ids
  from private.reservation_phase3b_legacy_admin_reschedule_booking_group(
    p_booking_id, p_start_at, p_end_at
  ) as legacy;
  perform private.reservation_phase3b_sync_legacy_schedule(
    v_booking_ids, v_operation.operation_id || ':schedule', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_move_booking_group(
  p_booking_id uuid,
  p_anchor_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_move_booking_group',
    jsonb_build_object(
      'booking_id', p_booking_id, 'anchor_court_id', p_anchor_court_id,
      'start_at', p_start_at, 'end_at', p_end_at
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select array_agg(legacy.id order by legacy.id)
    into v_booking_ids
  from private.reservation_phase3b_legacy_admin_move_booking_group(
    p_booking_id, p_anchor_court_id, p_start_at, p_end_at
  ) as legacy;
  perform private.reservation_phase3b_sync_legacy_schedule(
    v_booking_ids, v_operation.operation_id || ':schedule', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_swap_booking_schedule(
  p_source_booking_id uuid,
  p_target_court_id uuid,
  p_target_start_at timestamp
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_swap_booking_schedule',
    jsonb_build_object(
      'source_booking_id', p_source_booking_id,
      'target_court_id', p_target_court_id,
      'target_start_at', p_target_start_at
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
    return query select booking.* from public.bookings as booking
    where booking.id = any(v_booking_ids)
    order by array_position(v_booking_ids, booking.id);
    return;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  select array_agg(legacy.id order by legacy.id)
    into v_booking_ids
  from private.reservation_phase3b_legacy_admin_swap_booking_schedule(
    p_source_booking_id, p_target_court_id, p_target_start_at
  ) as legacy;
  perform private.reservation_phase3b_sync_legacy_schedule(
    v_booking_ids, v_operation.operation_id || ':schedule', v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id, null,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  return query select booking.* from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_operation record;
  v_booking public.bookings%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not exists (
    select 1 from public.bookings as booking
    where booking.id = p_booking_id and booking.user_id = v_actor_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'Booking not found or it does not belong to you';
  end if;

  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.cancel_booking',
    jsonb_build_object('booking_id', p_booking_id),
    v_actor_id
  );
  if v_operation.already_completed then
    select booking.* into v_booking
    from public.bookings as booking where booking.id = p_booking_id;
    return v_booking;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  perform pg_catalog.set_config('app.audit_suppress', 'true', true);
  v_booking := private.reservation_phase3b_legacy_cancel_booking(p_booking_id);
  perform pg_catalog.set_config('app.audit_suppress', 'false', true);
  perform private.reservation_phase3b_set_booking_status(
    array[p_booking_id]::uuid[],
    'cancelled',
    v_operation.operation_id || ':status',
    v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id,
    p_booking_id,
    jsonb_build_object('booking_ids', jsonb_build_array(p_booking_id))
  );
  select booking.* into v_booking
  from public.bookings as booking where booking.id = p_booking_id;
  return v_booking;
end;
$function$;

create function public.admin_cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking public.bookings%rowtype;
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_cancel_booking',
    jsonb_build_object('booking_id', p_booking_id),
    v_actor_id
  );
  if v_operation.already_completed then
    select booking.* into v_booking
    from public.bookings as booking where booking.id = p_booking_id;
    return v_booking;
  end if;

  perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
  perform pg_catalog.set_config('app.audit_suppress', 'true', true);
  v_booking := private.reservation_phase3b_legacy_admin_cancel_booking(p_booking_id);
  perform pg_catalog.set_config('app.audit_suppress', 'false', true);
  perform private.reservation_phase3b_set_booking_status(
    array[p_booking_id]::uuid[],
    'cancelled',
    v_operation.operation_id || ':status',
    v_actor_id
  );
  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id,
    p_booking_id,
    jsonb_build_object('booking_ids', jsonb_build_array(p_booking_id))
  );
  select booking.* into v_booking
  from public.bookings as booking where booking.id = p_booking_id;
  return v_booking;
end;
$function$;

create function private.reservation_phase3b_set_unpaid_projection(
  p_booking_ids uuid[],
  p_payment_status public.payment_status,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_booking_ids uuid[];
  v_claim record;
  v_request jsonb;
begin
  select array_agg(distinct booking_id order by booking_id)
    into v_booking_ids
  from unnest(p_booking_ids) as booking_id;

  if coalesce(cardinality(v_booking_ids), 0) = 0
     or v_booking_ids is distinct from p_booking_ids
     or p_payment_status not in ('pending', 'pay_at_venue', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'Unpaid projection scope or status is invalid';
  end if;

  v_request := jsonb_build_object(
    'booking_ids', v_booking_ids,
    'payment_status', p_payment_status
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'set_unpaid_projection',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );
  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'booking_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(v_booking_ids);

  if exists (
    select 1
    from public.bookings as booking
    left join public.payment_allocation_entries as entry
      on entry.booking_id = booking.id
    left join public.payments as payment on payment.id = entry.payment_id
    where booking.id = any(v_booking_ids)
    group by booking.id, booking.payment_method
    having coalesce(sum(entry.amount) filter (
      where payment.status = 'succeeded'
    ), 0) <> 0
       or (p_payment_status = 'pending' and booking.payment_method <> 'stripe')
       or (p_payment_status = 'pay_at_venue' and booking.payment_method <> 'venue')
       or (p_payment_status = 'failed' and booking.payment_method <> 'stripe')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Unpaid projection conflicts with Payment history or payment method';
  end if;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config('app.audit_event_type', 'booking.payment_updated', true);
  perform pg_catalog.set_config('app.audit_source', 'reservation_phase3b_kernel', true);
  update public.bookings as booking
     set payment_status = p_payment_status
   where booking.id = any(v_booking_ids);

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.unpaid_projection_updated',
    'reservation',
    null,
    p_actor_id,
    jsonb_build_object(
      'booking_count', cardinality(v_booking_ids),
      'payment_status', p_payment_status
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    null,
    jsonb_build_object('booking_count', cardinality(v_booking_ids))
  );
  return cardinality(v_booking_ids);
end;
$function$;

create function public.admin_update_booking_details(
  p_booking_id uuid,
  p_customer_name text,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_payment_status public.payment_status default 'pay_at_venue'
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking public.bookings%rowtype;
  v_booking_ids uuid[];
  v_group_id uuid;
  v_party_size smallint;
  v_has_positive_balance boolean;
begin
  select booking.*
    into v_booking
  from public.bookings as booking
  where booking.id = p_booking_id;
  if not found then
    raise exception using errcode = '23503', message = 'Booking not found';
  end if;
  v_group_id := v_booking.booking_group_id;
  v_party_size := v_booking.party_size;

  select array_agg(booking.id order by booking.id)
    into v_booking_ids
  from public.bookings as booking
  where booking.booking_group_id = v_group_id
     or (v_group_id is null and booking.id = p_booking_id);

  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_update_booking_details',
    jsonb_build_object(
      'booking_id', p_booking_id,
      'customer_name_hash', md5(coalesce(p_customer_name, '')),
      'customer_email_hash', md5(coalesce(p_customer_email, '')),
      'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
      'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
      'payment_status', p_payment_status
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    select booking.* into v_booking
    from public.bookings as booking where booking.id = p_booking_id;
    return v_booking;
  end if;

  perform private.reservation_phase3b_update_booking_details(
    v_booking_ids,
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    p_customer_notes,
    v_party_size,
    v_operation.operation_id || ':details',
    v_actor_id
  );

  select exists (
    select 1
    from public.payment_allocation_entries as entry
    join public.payments as payment on payment.id = entry.payment_id
    where entry.booking_id = any(v_booking_ids)
      and payment.status = 'succeeded'
    group by entry.booking_id
    having sum(entry.amount) > 0
  ) into v_has_positive_balance;

  if p_payment_status = 'paid' then
    perform private.reservation_phase3b_mark_scope_paid(
      v_booking_ids,
      v_operation.operation_id || ':payment',
      v_actor_id
    );
  elsif coalesce(v_has_positive_balance, false) then
    perform private.reservation_phase3b_refund_scope(
      v_booking_ids,
      v_operation.operation_id || ':refund',
      v_actor_id
    );
  elsif p_payment_status = 'refunded' then
    raise exception using
      errcode = '23514',
      message = 'Refunded status requires a succeeded Payment to refund';
  else
    perform private.reservation_phase3b_set_unpaid_projection(
      v_booking_ids,
      p_payment_status,
      v_operation.operation_id || ':unpaid',
      v_actor_id
    );
  end if;

  perform private.reservation_phase3b_complete_operation(
    v_operation.operation_id,
    p_booking_id,
    jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
  );
  select booking.* into v_booking
  from public.bookings as booking where booking.id = p_booking_id;
  return v_booking;
end;
$function$;

create function public.admin_mark_booking_paid(
  p_booking_id uuid,
  p_scope text default 'linked'
)
returns table (
  booking_link_id uuid,
  updated_booking_count integer,
  updated_group_count integer,
  linked_total numeric
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_group_id uuid;
  v_link_id uuid;
  v_booking_ids uuid[];
  v_updated integer;
  v_group_count integer;
  v_total numeric;
begin
  if p_scope not in ('linked', 'group') then
    raise exception using errcode = '22023', message = 'Invalid payment scope';
  end if;

  select booking.booking_group_id, booking.booking_link_id
    into v_group_id, v_link_id
  from public.bookings as booking
  where booking.id = p_booking_id;
  if not found then
    raise exception using errcode = '23503', message = 'Booking not found';
  end if;
  if p_scope = 'linked' and v_link_id is null then
    raise exception using errcode = '22023', message = 'Booking is not linked';
  end if;

  select
    array_agg(booking.id order by booking.id),
    count(distinct booking.booking_group_id)::integer,
    coalesce(round(sum(booking.total_amount), 2), 0)
    into v_booking_ids, v_group_count, v_total
  from public.bookings as booking
  where booking.status in ('held', 'confirmed')
    and (
      (p_scope = 'linked' and booking.booking_link_id = v_link_id)
      or (p_scope = 'group' and booking.booking_group_id = v_group_id)
    );
  if coalesce(cardinality(v_booking_ids), 0) = 0 then
    raise exception using errcode = '23514', message = 'Payment scope has no active bookings';
  end if;

  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_mark_booking_paid',
    jsonb_build_object('booking_id', p_booking_id, 'scope', p_scope),
    v_actor_id
  );
  if v_operation.already_completed then
    v_updated := coalesce(
      (v_operation.result_payload ->> 'updated_booking_count')::integer,
      0
    );
  else
    select count(*)::integer into v_updated
    from public.bookings as booking
    where booking.id = any(v_booking_ids) and booking.payment_status <> 'paid';

    perform private.reservation_phase3b_mark_scope_paid(
      v_booking_ids,
      v_operation.operation_id || ':payment',
      v_actor_id
    );
    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      null,
      jsonb_build_object(
        'booking_link_id', v_link_id,
        'updated_booking_count', v_updated,
        'updated_group_count', v_group_count,
        'linked_total', v_total,
        'booking_ids', to_jsonb(v_booking_ids)
      )
    );
  end if;

  return query select v_link_id, v_updated, v_group_count, v_total;
end;
$function$;

create function public.admin_link_booking_groups(
  p_source_booking_id uuid,
  p_target_booking_id uuid
)
returns table (
  booking_link_id uuid,
  linked_booking_count integer,
  linked_group_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_result jsonb;
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_link_booking_groups',
    jsonb_build_object(
      'source_booking_id', p_source_booking_id,
      'target_booking_id', p_target_booking_id,
      'payment_plan', 'single_payer'
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_result := v_operation.result_payload;
  else
    v_result := private.reservation_phase3b_merge_bookings(
      p_source_booking_id,
      p_target_booking_id,
      null,
      'single_payer',
      v_operation.operation_id || ':merge',
      v_actor_id
    );
    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      (v_result ->> 'transition_id')::uuid,
      v_result
    );
  end if;

  return query select
    (v_result ->> 'booking_link_id')::uuid,
    (v_result ->> 'linked_booking_count')::integer,
    (v_result ->> 'linked_group_count')::integer;
end;
$function$;

create function public.admin_link_booking_groups_with_primary(
  p_source_booking_id uuid,
  p_target_booking_id uuid,
  p_primary_source_party_id uuid,
  p_payment_plan text default 'single_payer'
)
returns table (
  booking_link_id uuid,
  linked_booking_count integer,
  linked_group_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_result jsonb;
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_link_booking_groups_with_primary',
    jsonb_build_object(
      'source_booking_id', p_source_booking_id,
      'target_booking_id', p_target_booking_id,
      'primary_source_party_id', p_primary_source_party_id,
      'payment_plan', p_payment_plan
    ),
    v_actor_id
  );
  if v_operation.already_completed then
    v_result := v_operation.result_payload;
  else
    v_result := private.reservation_phase3b_merge_bookings(
      p_source_booking_id,
      p_target_booking_id,
      p_primary_source_party_id,
      p_payment_plan,
      v_operation.operation_id || ':merge',
      v_actor_id
    );
    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      (v_result ->> 'transition_id')::uuid,
      v_result
    );
  end if;

  return query select
    (v_result ->> 'booking_link_id')::uuid,
    (v_result ->> 'linked_booking_count')::integer,
    (v_result ->> 'linked_group_count')::integer;
end;
$function$;

create function public.admin_unlink_booking_group(p_booking_id uuid)
returns table (
  previous_booking_link_id uuid,
  unlinked_group_id uuid,
  affected_booking_count integer,
  remaining_group_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_result jsonb;
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_unlink_booking_group',
    jsonb_build_object('booking_id', p_booking_id),
    v_actor_id
  );
  if v_operation.already_completed then
    v_result := v_operation.result_payload;
  else
    v_result := private.reservation_phase3b_split_legacy_group(
      p_booking_id,
      v_operation.operation_id || ':split',
      v_actor_id
    );
    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      (v_result ->> 'transition_id')::uuid,
      v_result
    );
  end if;

  return query select
    (v_result ->> 'previous_booking_link_id')::uuid,
    (v_result ->> 'unlinked_group_id')::uuid,
    (v_result ->> 'affected_booking_count')::integer,
    (v_result ->> 'remaining_group_count')::integer;
end;
$function$;

create or replace function private.audit_operation_undo_reason(p_operation_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_event private.app_audit_events;
  v_booking public.bookings;
  v_transition_id uuid;
  v_count integer := 0;
begin
  select transition.id into v_transition_id
  from public.reservation_transitions as transition
  where transition.operation_id = p_operation_id;

  if v_transition_id is not null then
    if exists (
      select 1 from public.reservation_transitions as reversal
      where reversal.reverses_transition_id = v_transition_id
    ) then
      return 'already_reverted';
    end if;
    if exists (
      select 1
      from public.reservation_transition_allocations as allocation
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = allocation.booking_id
      join public.bookings as booking on booking.id = allocation.booking_id
      where allocation.transition_id = v_transition_id
        and (
          membership.effective_reservation_id <> allocation.to_reservation_id
          or booking.booking_link_id is distinct from allocation.legacy_link_after
        )
    ) then
      return 'changed_afterwards';
    end if;
    return 'available';
  end if;

  if exists (
    select 1 from private.app_audit_events as reverted
    where reverted.reverts_operation_id = p_operation_id
  ) then
    return 'already_reverted';
  end if;

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
    ) then
      return 'unsupported';
    end if;

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
$function$;

create function public.admin_undo_booking_change(p_booking_id uuid)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_booking_ids uuid[];
begin
  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_undo_booking_change',
    jsonb_build_object('booking_id', p_booking_id),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
  else
    perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
    perform pg_catalog.set_config('app.audit_suppress', 'true', true);
    select array_agg(legacy.id order by legacy.id)
      into v_booking_ids
    from private.reservation_phase3b_legacy_admin_undo_booking_change(
      p_booking_id
    ) as legacy;
    perform pg_catalog.set_config('app.audit_suppress', 'false', true);
    perform private.reservation_phase3b_sync_legacy_schedule(
      v_booking_ids,
      v_operation.operation_id || ':schedule',
      v_actor_id
    );
    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      null,
      jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
    );
  end if;

  return query select booking.*
  from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

create function public.admin_revert_audit_operation(p_operation_id text)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_manager();
  v_operation record;
  v_transition_id uuid;
  v_booking_ids uuid[];
  v_group record;
  v_status record;
  v_has_positive_balance boolean;
begin
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
  ) then
    raise exception using
      errcode = '22023',
      message = 'Only the 10 most recent operations can be reverted';
  end if;
  if private.audit_operation_undo_reason(p_operation_id) <> 'available' then
    raise exception 'Operation cannot be reverted: %',
      private.audit_operation_undo_reason(p_operation_id);
  end if;

  select transition.id into v_transition_id
  from public.reservation_transitions as transition
  where transition.operation_id = p_operation_id;

  select * into v_operation
  from private.reservation_phase3b_begin_public_operation(
    'public.admin_revert_audit_operation',
    jsonb_build_object('reverts_operation_id', p_operation_id),
    v_actor_id
  );
  if v_operation.already_completed then
    v_booking_ids := private.reservation_phase3b_payload_booking_ids(
      v_operation.result_payload
    );
  elsif v_transition_id is not null then
    select array_agg(allocation.booking_id order by allocation.booking_id)
      into v_booking_ids
    from public.reservation_transition_allocations as allocation
    where allocation.transition_id = v_transition_id;

    perform pg_catalog.set_config(
      'app.audit_reverts_operation_id',
      p_operation_id,
      true
    );
    perform private.reservation_phase3b_reverse_transition(
      v_transition_id,
      v_operation.operation_id || ':reverse',
      v_actor_id
    );
    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      v_transition_id,
      jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
    );
  else
    perform private.reservation_phase3b_enter_activation_context(v_operation.operation_id);
    select array_agg(legacy.id order by legacy.id)
      into v_booking_ids
    from private.reservation_phase3b_legacy_admin_revert_audit_operation(
      p_operation_id
    ) as legacy;

    perform private.reservation_phase3b_sync_legacy_schedule(
      v_booking_ids,
      v_operation.operation_id || ':schedule',
      v_actor_id
    );

    for v_status in
      select
        booking.status,
        array_agg(booking.id order by booking.id) as booking_ids
      from public.bookings as booking
      where booking.id = any(v_booking_ids)
        and booking.status in ('confirmed', 'cancelled', 'no_show')
      group by booking.status
      order by booking.status
    loop
      perform private.reservation_phase3b_set_booking_status(
        v_status.booking_ids,
        v_status.status,
        v_operation.operation_id || ':status:' || v_status.status::text,
        v_actor_id
      );
    end loop;

    for v_group in
      select
        booking.booking_group_id,
        array_agg(booking.id order by booking.id) as booking_ids,
        min(booking.customer_name) as customer_name,
        min(booking.customer_email) as customer_email,
        min(booking.customer_phone) as customer_phone,
        min(booking.customer_notes) as customer_notes,
        min(booking.party_size)::smallint as party_size
      from public.bookings as booking
      where booking.id = any(v_booking_ids)
      group by booking.booking_group_id
      order by booking.booking_group_id
    loop
      perform private.reservation_phase3b_update_booking_details(
        v_group.booking_ids,
        v_group.customer_name,
        v_group.customer_email,
        v_group.customer_phone,
        v_group.customer_notes,
        v_group.party_size,
        v_operation.operation_id || ':details:' || v_group.booking_group_id::text,
        v_actor_id
      );
    end loop;

    for v_status in
      select
        booking.payment_status,
        array_agg(booking.id order by booking.id) as booking_ids
      from public.bookings as booking
      where booking.id = any(v_booking_ids)
      group by booking.payment_status
      order by booking.payment_status
    loop
      if v_status.payment_status = 'paid' then
        perform private.reservation_phase3b_mark_scope_paid(
          v_status.booking_ids,
          v_operation.operation_id || ':paid:' || v_status.payment_status::text,
          v_actor_id
        );
      else
        select exists (
          select 1
          from public.payment_allocation_entries as entry
          join public.payments as payment on payment.id = entry.payment_id
          where entry.booking_id = any(v_status.booking_ids)
            and payment.status = 'succeeded'
          group by entry.booking_id
          having sum(entry.amount) > 0
        ) into v_has_positive_balance;

        if coalesce(v_has_positive_balance, false) then
          perform private.reservation_phase3b_refund_scope(
            v_status.booking_ids,
            v_operation.operation_id || ':refund:' || v_status.payment_status::text,
            v_actor_id
          );
        elsif v_status.payment_status in ('pending', 'pay_at_venue', 'failed') then
          perform private.reservation_phase3b_set_unpaid_projection(
            v_status.booking_ids,
            v_status.payment_status,
            v_operation.operation_id || ':unpaid:' || v_status.payment_status::text,
            v_actor_id
          );
        end if;
      end if;
    end loop;

    perform private.reservation_phase3b_complete_operation(
      v_operation.operation_id,
      null,
      jsonb_build_object('booking_ids', to_jsonb(v_booking_ids))
    );
  end if;

  return query select booking.*
  from public.bookings as booking
  where booking.id = any(v_booking_ids)
  order by array_position(v_booking_ids, booking.id);
end;
$function$;

-- Existing Phase 3A projections become the initial effective ownership state.
-- The inactive-kernel preflight guarantees that this table was empty, so the
-- insert is an all-or-nothing activation backfill rather than a repair merge.
insert into public.reservation_allocation_memberships (
  booking_id,
  origin_reservation_id,
  effective_reservation_id,
  effective_session_id,
  version
)
select
  booking.id,
  booking.reservation_id,
  booking.reservation_id,
  booking.session_id,
  0
from public.bookings as booking
order by booking.id;

insert into private.reservation_phase3b_activation_state (
  singleton,
  status,
  activated_at,
  migration_version,
  writer_count,
  baseline_fingerprint
)
select
  true,
  'activated',
  statement_timestamp(),
  '20260824172041',
  count(*)::integer,
  md5(string_agg(
    baseline.signature || ':' || baseline.normalized_source_md5,
    '' order by baseline.signature
  ))
from private.reservation_phase3b_writer_baseline as baseline;

create or replace function private.assert_reservation_phase3b_writer_inventory()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_status text;
  v_expected_entries integer;
  v_public_direct_count integer;
  v_legacy_count integer;
  v_wrapper_count integer;
  v_entry_fingerprint text;
  v_wrapper_fingerprint text;
begin
  select state.status into v_status
  from private.reservation_phase3b_activation_state as state
  where state.singleton;
  if v_status not in ('activated', 'legacy_writer_rollback') then
    raise exception using errcode = '55000', message = 'Phase 3B activation state is missing';
  end if;

  select count(*)::integer into v_expected_entries
  from private.reservation_phase3b_writer_inventory as inventory
  where inventory.writer_kind = 'direct';
  if v_expected_entries <> 17 then
    raise exception using errcode = '55000', message = 'Phase 3B direct writer inventory is not 17';
  end if;

  if exists (
    select 1
    from private.reservation_phase3b_writer_inventory as inventory
    left join pg_catalog.pg_proc as routine
      on routine.oid = pg_catalog.to_regprocedure(inventory.signature)
    where inventory.writer_kind in ('direct', 'wrapper')
      and (
        routine.oid is null
        or not routine.prosecdef
        or routine.proconfig is null
        or not (
          'search_path=' = any(routine.proconfig)
          or 'search_path=""' = any(routine.proconfig)
        )
        or pg_catalog.has_function_privilege('anon', routine.oid, 'execute')
        or not pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
        or not pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B public writer signature, security, or grant drift';
  end if;

  select count(*)::integer into v_public_direct_count
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as schema on schema.oid = routine.pronamespace
  where schema.nspname = 'public'
    and routine.prokind = 'f'
    and routine.prosrc ~* '(insert[[:space:]]+into|update([[:space:]]+only)?|delete[[:space:]]+from([[:space:]]+only)?)[[:space:]]+((public|"public")[.])?(bookings|"bookings")';

  if (v_status = 'activated' and v_public_direct_count <> 0)
     or (v_status = 'legacy_writer_rollback' and v_public_direct_count <> 17) then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Phase 3B public direct writer count drift for %s: %s',
        v_status,
        v_public_direct_count
      );
  end if;

  if v_status = 'activated' and exists (
    select 1
    from private.reservation_phase3b_writer_inventory as inventory
    join pg_catalog.pg_proc as routine
      on routine.oid = pg_catalog.to_regprocedure(inventory.signature)
    where inventory.writer_kind = 'direct'
      and routine.prosrc !~ 'private[.]reservation_phase3b'
  ) then
    raise exception using
      errcode = '55000',
      message = 'An activated public entry does not delegate through Phase 3B';
  end if;

  select count(*)::integer into v_legacy_count
  from private.reservation_phase3b_writer_inventory as inventory
  join pg_catalog.pg_proc as routine
    on routine.oid = pg_catalog.to_regprocedure(
      pg_catalog.regexp_replace(
        inventory.signature,
        '^public[.]',
        'private.reservation_phase3b_legacy_'
      )
    )
  where inventory.writer_kind = 'direct'
    and routine.prosecdef
    and routine.proconfig is not null
    and (
      'search_path=' = any(routine.proconfig)
      or 'search_path=""' = any(routine.proconfig)
    )
    and not pg_catalog.has_function_privilege('anon', routine.oid, 'execute')
    and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
    and not pg_catalog.has_function_privilege('service_role', routine.oid, 'execute');
  if v_legacy_count <> 17 then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B private legacy boundary or grants drifted';
  end if;

  select count(*)::integer into v_wrapper_count
  from private.reservation_phase3b_writer_inventory as inventory
  join pg_catalog.pg_proc as routine
    on routine.oid = pg_catalog.to_regprocedure(inventory.signature)
  where inventory.writer_kind = 'wrapper'
    and routine.prosrc !~* '(insert[[:space:]]+into|update([[:space:]]+only)?|delete[[:space:]]+from([[:space:]]+only)?)[[:space:]]+((public|"public")[.])?(bookings|"bookings")';
  if v_wrapper_count <> 3 then
    raise exception using errcode = '55000', message = 'Phase 3B wrapper inventory drifted';
  end if;

  select md5(string_agg(
    pg_catalog.pg_get_functiondef(routine.oid),
    '' order by inventory.signature
  )) into v_entry_fingerprint
  from private.reservation_phase3b_writer_inventory as inventory
  join pg_catalog.pg_proc as routine
    on routine.oid = pg_catalog.to_regprocedure(inventory.signature)
  where inventory.writer_kind = 'direct';

  select md5(string_agg(
    pg_catalog.pg_get_functiondef(routine.oid),
    '' order by inventory.signature
  )) into v_wrapper_fingerprint
  from private.reservation_phase3b_writer_inventory as inventory
  join pg_catalog.pg_proc as routine
    on routine.oid = pg_catalog.to_regprocedure(inventory.signature)
  where inventory.writer_kind = 'wrapper';

  return jsonb_build_object(
    'status', v_status,
    'public_entry_count', v_expected_entries,
    'public_direct_booking_writer_count', v_public_direct_count,
    'private_legacy_writer_count', v_legacy_count,
    'wrapper_count', v_wrapper_count,
    'undeployed_edge_path_count', (
      select count(*)
      from private.reservation_phase3b_writer_inventory as inventory
      where inventory.writer_kind = 'undeployed_edge'
    ),
    'public_entry_fingerprint', v_entry_fingerprint,
    'wrapper_fingerprint', v_wrapper_fingerprint
  );
end;
$function$;

create function private.assert_reservation_phase3b_activation()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_booking_count bigint;
  v_membership_count bigint;
  v_shadow_mismatch_count bigint;
  v_projection_mismatch_count bigint;
  v_payment_mismatch_count bigint;
  v_incomplete_operation_count bigint;
  v_rls_table_count integer;
  v_realtime_tables text[];
  v_inventory jsonb;
begin
  v_inventory := private.assert_reservation_phase3b_writer_inventory();

  select count(*) into v_booking_count from public.bookings;
  select count(*) into v_membership_count
  from public.reservation_allocation_memberships;

  -- Phase 3A's shadow view intentionally treats one legacy link spanning
  -- multiple immutable physical Reservations as drift. Under Phase 3B that is
  -- valid only when every linked allocation resolves either through the old
  -- Phase 2 legacy-source mapping or through one explicit effective
  -- Reservation membership. All non-relationship Phase 3A mismatch codes stay
  -- fail-closed.
  select count(*) into v_shadow_mismatch_count
  from public.reservation_shadow_mismatches as mismatch
  where mismatch.mismatch_code not in (
      'link_scope_mismatch',
      'link_source_missing',
      'link_source_mismatch',
      'reservation_relationship_scope_mismatch'
    )
     or exists (
       select 1
       from public.bookings as booking
       left join public.reservation_allocation_memberships as membership
         on membership.booking_id = booking.id
       left join public.reservation_legacy_sources as source
         on source.source_type = 'booking_link'
        and source.source_id = booking.booking_link_id
       where booking.booking_link_id is not null
         and not (
           membership.effective_reservation_id = booking.booking_link_id
           or (
             source.reservation_id = booking.reservation_id
             and membership.effective_reservation_id = booking.reservation_id
           )
         )
     );

  select count(*) into v_projection_mismatch_count
  from public.bookings as booking
  cross join public.venue_settings as settings
  left join public.reservation_sessions as projection
    on projection.id = booking.session_id
   and projection.reservation_id = booking.reservation_id
  left join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  left join public.reservation_sessions as effective
    on effective.id = membership.effective_session_id
   and effective.reservation_id = membership.effective_reservation_id
  where membership.booking_id is null
     or projection.id is null
     or effective.id is null
     or booking.start_at is distinct from
       pg_catalog.timezone(settings.timezone, projection.starts_at)
     or booking.end_at is distinct from
       pg_catalog.timezone(settings.timezone, projection.ends_at)
     or booking.start_at is distinct from
       pg_catalog.timezone(settings.timezone, effective.starts_at)
     or booking.end_at is distinct from
       pg_catalog.timezone(settings.timezone, effective.ends_at);

  select count(*) into v_payment_mismatch_count
  from (
    select
      booking.id,
      booking.payment_status,
      booking.total_amount,
      coalesce(sum(entry.amount) filter (
        where payment.status = 'succeeded'
      ), 0)::numeric as allocated_amount,
      coalesce(bool_or(entry.entry_kind = 'refund'
        and payment.status = 'succeeded'), false) as has_refund
    from public.bookings as booking
    left join public.payment_allocation_entries as entry
      on entry.booking_id = booking.id
    left join public.payments as payment on payment.id = entry.payment_id
    group by booking.id, booking.payment_status, booking.total_amount
  ) as balance
  where (balance.allocated_amount >= balance.total_amount
      and balance.payment_status <> 'paid')
     or (balance.allocated_amount > 0
      and balance.allocated_amount < balance.total_amount
      and balance.payment_status <> 'pay_at_venue')
     or (balance.allocated_amount <= 0
      and balance.has_refund
      and balance.payment_status <> 'refunded');

  select count(*) into v_incomplete_operation_count
  from private.reservation_phase3b_operations as operation
  where operation.status = 'started';

  select count(*)::integer into v_rls_table_count
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as schema on schema.oid = relation.relnamespace
  where schema.nspname = 'public'
    and relation.relname = any(array[
      'reservation_transitions',
      'reservation_transition_sources',
      'reservation_transition_targets',
      'reservation_transition_allocations',
      'reservation_transition_parties',
      'reservation_allocation_memberships',
      'reservation_session_assignments'
    ]::text[])
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']::text[]) as role_name
    cross join unnest(array[
      'public.reservation_transitions',
      'public.reservation_transition_sources',
      'public.reservation_transition_targets',
      'public.reservation_transition_allocations',
      'public.reservation_transition_parties',
      'public.reservation_allocation_memberships',
      'public.reservation_session_assignments'
    ]::text[]) as table_name
    where pg_catalog.has_table_privilege(
      role_name,
      table_name,
      'INSERT,UPDATE,DELETE'
    )
  ) then
    raise exception using errcode = '55000', message = 'Client Phase 3B table DML grant detected';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as schema on schema.oid = routine.pronamespace
    where schema.nspname = 'private'
      and routine.proname like 'reservation_phase3b%'
      and (
        pg_catalog.has_function_privilege('anon', routine.oid, 'execute')
        or pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
        or pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')
      )
  ) then
    raise exception using errcode = '55000', message = 'Client private Phase 3B EXECUTE grant detected';
  end if;

  select coalesce(
    array_agg(
      publication.schemaname || '.' || publication.tablename
      order by publication.schemaname, publication.tablename
    ),
    '{}'::text[]
  ) into v_realtime_tables
  from pg_catalog.pg_publication_tables as publication
  where publication.pubname = 'supabase_realtime';

  if v_booking_count <> v_membership_count
     or v_shadow_mismatch_count <> 0
     or v_projection_mismatch_count <> 0
     or v_payment_mismatch_count <> 0
     or v_incomplete_operation_count <> 0
     or v_rls_table_count <> 7
     or v_realtime_tables is distinct from array['public.court_slots']::text[] then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Phase 3B activation drift: bookings=%s memberships=%s shadow=%s projection=%s payment=%s incomplete=%s rls=%s realtime=%s',
        v_booking_count,
        v_membership_count,
        v_shadow_mismatch_count,
        v_projection_mismatch_count,
        v_payment_mismatch_count,
        v_incomplete_operation_count,
        v_rls_table_count,
        array_to_string(v_realtime_tables, ',')
      );
  end if;

  return jsonb_build_object(
    'status', 'clean',
    'booking_count', v_booking_count,
    'membership_count', v_membership_count,
    'shadow_mismatch_count', v_shadow_mismatch_count,
    'projection_mismatch_count', v_projection_mismatch_count,
    'payment_mismatch_count', v_payment_mismatch_count,
    'incomplete_operation_count', v_incomplete_operation_count,
    'rls_force_table_count', v_rls_table_count,
    'realtime_tables', to_jsonb(v_realtime_tables),
    'writer_inventory', v_inventory
  );
end;
$function$;

-- Fail closed on every newly created private function. Public entry points are
-- granted explicitly below; table DML remains owner-only behind RLS.
do $private_grants$
declare
  v_routine record;
begin
  for v_routine in
    select routine.oid::regprocedure as signature
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as schema on schema.oid = routine.pronamespace
    where schema.nspname = 'private'
      and (
        routine.proname like 'reservation_phase3b%'
        or routine.proname in (
          'assert_booking_session_projection_at_commit',
          'assert_reservation_phase3b_writer_inventory',
          'assert_reservation_phase3b_activation',
          'audit_operation_undo_reason',
          'enforce_reservation_allocation_membership_update',
          'enforce_booking_session_projection'
        )
      )
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_routine.signature
    );
  end loop;
end;
$private_grants$;

do $public_grants$
declare
  v_routine record;
begin
  for v_routine in
    select routine.oid::regprocedure as signature
    from private.reservation_phase3b_writer_inventory as inventory
    join pg_catalog.pg_proc as routine
      on routine.oid = pg_catalog.to_regprocedure(inventory.signature)
    where inventory.writer_kind = 'direct'
    union all
    select 'public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)'::regprocedure
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_routine.signature
    );
    execute pg_catalog.format(
      'grant execute on function %s to authenticated, service_role',
      v_routine.signature
    );
  end loop;
end;
$public_grants$;

select private.assert_reservation_phase3b_activation();

comment on function public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text) is
  'Manager-only explicit-primary Reservation merge contract for different-customer bookings; no UI cutover in Phase 3B.2.';
comment on function private.assert_reservation_phase3b_activation() is
  'PII-free Phase 3B.2 writer, membership, schedule, payment, RLS, grant, and Realtime assertion.';

notify pgrst, 'reload schema';

commit;
