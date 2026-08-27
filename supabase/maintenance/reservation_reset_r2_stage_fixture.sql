-- Tiger Issue #165 / R2 only.
-- Adds deterministic synthetic rows that exercise the confirmed production
-- purge categories missing from badminton_stage. This is not a migration and
-- must never be executed against production.

begin;
set transaction isolation level serializable;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';
set local timezone = 'UTC';

do $stage_guard$
declare
  v_lock_acquired boolean;
begin
  v_lock_acquired := pg_try_advisory_xact_lock(
    hashtextextended('tiger.issue-165.reservation-reset', 0)
  );
  if not v_lock_acquired then
    raise exception 'tiger_r2_fixture_lock_unavailable';
  end if;

  if current_database() <> 'postgres'
     or current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'tiger_r2_fixture_unexpected_postgres_runtime';
  end if;

  if (select count(*) from supabase_migrations.schema_migrations) <> 51
     or (select max(version) from supabase_migrations.schema_migrations)
        <> '20260827090512' then
    raise exception 'tiger_r2_fixture_migration_baseline_mismatch';
  end if;

  if (select count(*) from auth.users) <> 3
     or (select count(*) from auth.identities) <> 2
     or (select count(*) from auth.sessions) <> 3
     or (select count(*) from public.profiles) <> 2
     or (select count(*) from public.staff_members) <> 2
     or (select count(*) from private.manager_accounts) <> 0 then
    raise exception 'tiger_r2_fixture_auth_preserve_baseline_mismatch';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = '00000000-0000-0000-0000-000000017701'::uuid
      and email = 'synthetic-manager@example.invalid'
  ) then
    raise exception 'tiger_r2_fixture_synthetic_manager_missing';
  end if;

  if (select count(*) from public.bookings) <> 192
     or (select count(*) from public.court_slots) <> 139
     or (select count(*) from public.reservations) <> 123
     or (select count(*) from public.reservation_sessions) <> 135
     or (select count(*) from public.reservation_parties) <> 131
     or (select count(*) from public.reservation_party_roles) <> 254
     or (select count(*) from public.reservation_legacy_sources) <> 136
     or (select count(*) from public.reservation_allocation_memberships) <> 192
     or (select count(*) from public.payments) <> 23
     or (select count(*) from public.payment_allocation_entries) <> 26
     or (select count(*) from public.recurrence_series) <> 2 then
    raise exception 'tiger_r2_fixture_transaction_baseline_mismatch';
  end if;

  if exists (
    select 1
    from public.bookings
    where user_id <> '00000000-0000-0000-0000-000000017701'::uuid
       or customer_email is null
       or customer_email !~ '^[^@]+@example[.]invalid$'
  ) then
    raise exception 'tiger_r2_fixture_non_synthetic_booking_detected';
  end if;

  if (select count(*) from public.venue_events) <> 0
     or (select count(*) from public.venue_event_courts) <> 0
     or (select count(*) from public.venue_members) <> 0
     or (select count(*) from private.booking_admin_actions) <> 0
     or (select count(*) from private.app_audit_events) <> 202 then
    raise exception 'tiger_r2_fixture_optional_domain_baseline_mismatch';
  end if;

  if exists (
    select 1
    from private.app_audit_events
    where operation_id in (
      'reservation-reset-r2-stage-fixture-event-1',
      'reservation-reset-r2-stage-fixture-event-2',
      'reservation-reset-r2-stage-fixture-member-1',
      'reservation-reset-r2-stage-fixture-member-2',
      'reservation-reset-r2-stage-20260827-v1'
    )
  ) then
    raise exception 'tiger_r2_fixture_already_applied';
  end if;
end
$stage_guard$;

lock table
  public.venue_events,
  public.venue_event_courts,
  public.venue_members,
  private.booking_admin_actions,
  private.app_audit_events
in share row exclusive mode;

set local session_replication_role = replica;

insert into public.venue_events (
  id,
  title_zh,
  title_en,
  description,
  event_type,
  status,
  starts_at,
  ends_at,
  blocks_booking,
  color,
  created_at,
  updated_at,
  updated_by
) values
  (
    '00000000-0000-0000-0000-000000016501'::uuid,
    'R2 合成活动一',
    'R2 synthetic event one',
    'Issue 165 staging-only fixture',
    'maintenance',
    'scheduled',
    '2027-06-01 10:00:00'::timestamp,
    '2027-06-01 11:00:00'::timestamp,
    true,
    'ink',
    '2026-08-27 17:45:00+00'::timestamptz,
    '2026-08-27 17:45:00+00'::timestamptz,
    '00000000-0000-0000-0000-000000017701'::uuid
  ),
  (
    '00000000-0000-0000-0000-000000016502'::uuid,
    'R2 合成活动二',
    'R2 synthetic event two',
    'Issue 165 staging-only fixture',
    'promotion',
    'draft',
    '2027-06-02 12:00:00'::timestamp,
    '2027-06-02 13:00:00'::timestamp,
    false,
    'gold',
    '2026-08-27 17:46:00+00'::timestamptz,
    '2026-08-27 17:46:00+00'::timestamptz,
    '00000000-0000-0000-0000-000000017701'::uuid
  );

insert into public.venue_event_courts (event_id, court_id) values
  (
    '00000000-0000-0000-0000-000000016501'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid
  ),
  (
    '00000000-0000-0000-0000-000000016502'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid
  );

insert into public.venue_members (
  id,
  auth_user_id,
  member_number,
  display_name,
  email,
  phone,
  tier,
  status,
  discount_percent,
  joined_on,
  expires_on,
  notes,
  metadata,
  created_at,
  updated_at,
  updated_by,
  discount_override_percent
) values
  (
    '00000000-0000-0000-0000-000000016511'::uuid,
    null,
    'R2-STAGE-001',
    'R2 synthetic member one',
    'r2-member-1@example.invalid',
    '5550001651',
    'standard',
    'active',
    0,
    '2026-08-27'::date,
    null,
    'Issue 165 staging-only fixture',
    '{"fixture":"reservation-reset-r2"}'::jsonb,
    '2026-08-27 17:47:00+00'::timestamptz,
    '2026-08-27 17:47:00+00'::timestamptz,
    '00000000-0000-0000-0000-000000017701'::uuid,
    null
  ),
  (
    '00000000-0000-0000-0000-000000016512'::uuid,
    null,
    'R2-STAGE-002',
    'R2 synthetic member two',
    'r2-member-2@example.invalid',
    '5550001652',
    'standard',
    'paused',
    0,
    '2026-08-27'::date,
    '2027-08-27'::date,
    'Issue 165 staging-only fixture',
    '{"fixture":"reservation-reset-r2"}'::jsonb,
    '2026-08-27 17:48:00+00'::timestamptz,
    '2026-08-27 17:48:00+00'::timestamptz,
    '00000000-0000-0000-0000-000000017701'::uuid,
    5
  );

insert into private.booking_admin_actions (
  id,
  booking_id,
  actor_id,
  action,
  previous_status,
  new_status,
  created_at,
  previous_court_id,
  new_court_id,
  previous_start_at,
  previous_end_at,
  new_start_at,
  new_end_at,
  operation_id
) overriding system value
select
  -165010 - row_number() over (order by booking.id),
  booking.id,
  '00000000-0000-0000-0000-000000017701'::uuid,
  'details_updated',
  booking.status,
  booking.status,
  '2026-08-27 17:49:00+00'::timestamptz,
  booking.court_id,
  booking.court_id,
  booking.start_at,
  booking.end_at,
  booking.start_at,
  booking.end_at,
  case booking.id
    when '00000000-0000-0000-0000-000000002711'::uuid
      then '00000000-0000-0000-0000-000000016521'::uuid
    else '00000000-0000-0000-0000-000000016522'::uuid
  end
from public.bookings as booking
where booking.id in (
  '00000000-0000-0000-0000-000000002711'::uuid,
  '00000000-0000-0000-0000-000000002712'::uuid
);

insert into private.app_audit_events (
  id,
  occurred_at,
  transaction_id,
  operation_id,
  event_type,
  entity_type,
  entity_id,
  actor_id,
  actor_email,
  actor_kind,
  source,
  before_state,
  after_state,
  changed_fields,
  metadata,
  reverts_operation_id
) overriding system value values
  (
    -165001,
    '2026-08-27 17:45:00+00'::timestamptz,
    -165001,
    'reservation-reset-r2-stage-fixture-event-1',
    'venue_event.created',
    'venue_event',
    '00000000-0000-0000-0000-000000016501',
    '00000000-0000-0000-0000-000000017701'::uuid,
    null,
    'system',
    'reservation_reset_r2_fixture',
    null,
    '{"fixture":true}'::jsonb,
    array['fixture']::text[],
    '{"schema_version":1,"fixture":"reservation-reset-r2"}'::jsonb,
    null
  ),
  (
    -165002,
    '2026-08-27 17:46:00+00'::timestamptz,
    -165002,
    'reservation-reset-r2-stage-fixture-event-2',
    'venue_event.created',
    'venue_event',
    '00000000-0000-0000-0000-000000016502',
    '00000000-0000-0000-0000-000000017701'::uuid,
    null,
    'system',
    'reservation_reset_r2_fixture',
    null,
    '{"fixture":true}'::jsonb,
    array['fixture']::text[],
    '{"schema_version":1,"fixture":"reservation-reset-r2"}'::jsonb,
    null
  ),
  (
    -165011,
    '2026-08-27 17:47:00+00'::timestamptz,
    -165011,
    'reservation-reset-r2-stage-fixture-member-1',
    'venue_member.created',
    'venue_member',
    '00000000-0000-0000-0000-000000016511',
    '00000000-0000-0000-0000-000000017701'::uuid,
    null,
    'system',
    'reservation_reset_r2_fixture',
    null,
    '{"fixture":true}'::jsonb,
    array['fixture']::text[],
    '{"schema_version":1,"fixture":"reservation-reset-r2"}'::jsonb,
    null
  ),
  (
    -165012,
    '2026-08-27 17:48:00+00'::timestamptz,
    -165012,
    'reservation-reset-r2-stage-fixture-member-2',
    'venue_member.created',
    'venue_member',
    '00000000-0000-0000-0000-000000016512',
    '00000000-0000-0000-0000-000000017701'::uuid,
    null,
    'system',
    'reservation_reset_r2_fixture',
    null,
    '{"fixture":true}'::jsonb,
    array['fixture']::text[],
    '{"schema_version":1,"fixture":"reservation-reset-r2"}'::jsonb,
    null
  );

set local session_replication_role = origin;

do $fixture_postconditions$
begin
  if (select count(*) from public.venue_events) <> 2
     or (select count(*) from public.venue_event_courts) <> 2
     or (select count(*) from public.venue_members) <> 2
     or (select count(*) from private.booking_admin_actions) <> 2
     or (select count(*) from private.app_audit_events) <> 206
     or (
       select count(*)
       from private.app_audit_events
       where metadata ->> 'fixture' = 'reservation-reset-r2'
     ) <> 4 then
    raise exception 'tiger_r2_fixture_postcondition_failed';
  end if;
end
$fixture_postconditions$;

commit;

select jsonb_build_object(
  'status', 'tiger_r2_stage_fixture_installed',
  'venue_events', (select count(*) from public.venue_events),
  'venue_event_courts', (select count(*) from public.venue_event_courts),
  'venue_members', (select count(*) from public.venue_members),
  'booking_admin_actions', (select count(*) from private.booking_admin_actions),
  'app_audit_events', (select count(*) from private.app_audit_events),
  'auth_users_unchanged', (select count(*) from auth.users) = 3
) as tiger_r2_fixture_result;
