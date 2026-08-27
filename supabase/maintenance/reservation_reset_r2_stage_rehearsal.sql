-- Tiger Issue #165 / R2 only.
-- One-time reset + restore rehearsal for the exact badminton_stage synthetic
-- baseline. This file is intentionally outside supabase/migrations.
-- It does not delete Auth rows and must never be reused for production.

set tiger.r2.fail_after_reset = 'false';

begin;
set transaction isolation level serializable;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local timezone = 'UTC';

create temporary table tiger_r2_timing (
  started_at timestamptz not null,
  reset_at timestamptz,
  restored_at timestamptz
) on commit drop;

insert into tiger_r2_timing (started_at) values (clock_timestamp());

create function pg_temp.tiger_r2_count(
  p_relation regclass,
  p_predicate text
) returns bigint
language plpgsql
as $function$
declare
  v_count bigint;
begin
  execute format(
    'select count(*) from %s as t where %s',
    p_relation,
    p_predicate
  ) into v_count;
  return v_count;
end
$function$;

create function pg_temp.tiger_r2_fingerprint(
  p_relation regclass,
  p_predicate text
) returns text
language plpgsql
as $function$
declare
  v_fingerprint text;
begin
  execute format(
    'select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '''' order by md5(to_jsonb(t)::text)), '''')) from %s as t where %s',
    p_relation,
    p_predicate
  ) into v_fingerprint;
  return v_fingerprint;
end
$function$;

create temporary table tiger_r2_expected (
  scope text not null check (scope in ('preserve', 'purge')),
  relation_name text not null,
  relation_oid regclass not null,
  predicate text not null,
  expected_count bigint not null,
  expected_fingerprint text not null check (
    expected_fingerprint ~ '^[0-9a-f]{32}$'
  ),
  primary key (scope, relation_name)
) on commit drop;

insert into tiger_r2_expected (
  scope,
  relation_name,
  relation_oid,
  predicate,
  expected_count,
  expected_fingerprint
) values
  ('preserve', 'auth.identities', 'auth.identities'::regclass, 'true', 2, 'de2bb0bf69e3c5d986de2b65d30248b0'),
  ('preserve', 'auth.refresh_tokens', 'auth.refresh_tokens'::regclass, 'true', 6, 'b7feae3bfc8e9620e28393298797194d'),
  ('preserve', 'auth.sessions', 'auth.sessions'::regclass, 'true', 3, '3b38903bdf141675b772c23535315046'),
  ('preserve', 'auth.users', 'auth.users'::regclass, 'true', 3, 'dd565c50d260360e140b3d3eb0db5ce1'),
  (
    'preserve',
    'private.app_audit_events:preserve',
    'private.app_audit_events'::regclass,
    $audit_preserve$not (
      (entity_type = 'booking' and entity_id in (select id::text from public.bookings))
      or (entity_type = 'venue_event' and entity_id in ('00000000-0000-0000-0000-000000016501','00000000-0000-0000-0000-000000016502'))
      or (entity_type = 'venue_member' and entity_id in ('00000000-0000-0000-0000-000000016511','00000000-0000-0000-0000-000000016512'))
    )$audit_preserve$,
    4,
    '9a10429726e2112036643b61122ba5df'
  ),
  ('preserve', 'private.manager_accounts', 'private.manager_accounts'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('preserve', 'private.reservation_phase3b_activation_state', 'private.reservation_phase3b_activation_state'::regclass, 'true', 1, 'b0fd1621961bad23cd40368529694d98'),
  ('preserve', 'private.reservation_phase3b_writer_baseline', 'private.reservation_phase3b_writer_baseline'::regclass, 'true', 17, '30dca537ec242ebd80cda407a24efd69'),
  ('preserve', 'private.reservation_phase3b_writer_inventory', 'private.reservation_phase3b_writer_inventory'::regclass, 'true', 22, '2154424649487fc500d087bb3f2d951b'),
  ('preserve', 'public.courts', 'public.courts'::regclass, 'true', 5, '8759bac295df23f32dfa962c9124fee6'),
  ('preserve', 'public.profiles', 'public.profiles'::regclass, 'true', 2, '190c3774d8ed21c60f410cad3cba5ea2'),
  ('preserve', 'public.staff_members', 'public.staff_members'::regclass, 'true', 2, '301fabcc604bf2c0f5ebb9321567e33d'),
  ('preserve', 'public.venue_member_tiers', 'public.venue_member_tiers'::regclass, 'true', 4, '37aa121d27b4e9564210e27b4e08fb8b'),
  ('preserve', 'public.venue_opening_hours', 'public.venue_opening_hours'::regclass, 'true', 7, '8caabc87ff88267a1260a56f8c9f08fb'),
  ('preserve', 'public.venue_pricing_rules', 'public.venue_pricing_rules'::regclass, 'true', 4, 'e428c331587c24ede9451bfa99fdb78a'),
  ('preserve', 'public.venue_settings', 'public.venue_settings'::regclass, 'true', 1, 'e9b9ac49cd811aaecd23b413c252e4d3'),
  ('preserve', 'supabase_migrations.schema_migrations', 'supabase_migrations.schema_migrations'::regclass, 'true', 51, '420dc391b1d2261ad4d03c10d63b4dbf'),
  ('purge', 'private.app_audit_events:purge', 'private.app_audit_events'::regclass, $audit_purge$(
      (entity_type = 'booking' and entity_id in (select id::text from public.bookings))
      or (entity_type = 'venue_event' and entity_id in ('00000000-0000-0000-0000-000000016501','00000000-0000-0000-0000-000000016502'))
      or (entity_type = 'venue_member' and entity_id in ('00000000-0000-0000-0000-000000016511','00000000-0000-0000-0000-000000016512'))
    )$audit_purge$, 202, 'c138b3b53e071b41454897b2b9ad58e9'),
  ('purge', 'private.booking_admin_actions', 'private.booking_admin_actions'::regclass, 'booking_id in (select id from public.bookings)', 2, '047482c990d3f8545a4e68847f0953f9'),
  ('purge', 'private.reservation_phase3b_operations', 'private.reservation_phase3b_operations'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.bookings', 'public.bookings'::regclass, 'true', 192, 'f4ec585d2029b648be713145290d9d02'),
  ('purge', 'public.court_slots', 'public.court_slots'::regclass, 'true', 139, 'e570975b4945ccca339bf242e31bef62'),
  ('purge', 'public.payment_allocation_entries', 'public.payment_allocation_entries'::regclass, 'true', 26, 'f57917b49074e9268821c750023c10cd'),
  ('purge', 'public.payments', 'public.payments'::regclass, 'true', 23, 'df24bc58a04cecd5b7b225ebaa951bff'),
  ('purge', 'public.recurrence_series', 'public.recurrence_series'::regclass, 'true', 2, '612bf0e53396a41d42b42db32d2001fa'),
  ('purge', 'public.reservation_allocation_memberships', 'public.reservation_allocation_memberships'::regclass, 'true', 192, '2e7fccf6e2d12431ff56710d7934459e'),
  ('purge', 'public.reservation_legacy_sources', 'public.reservation_legacy_sources'::regclass, 'true', 136, '95e166863ce73f76cbb7fae4064bb3b5'),
  ('purge', 'public.reservation_parties', 'public.reservation_parties'::regclass, 'true', 131, 'a4bc6f58f868d00812e9316d2e57e110'),
  ('purge', 'public.reservation_party_roles', 'public.reservation_party_roles'::regclass, 'true', 254, '415800ca5c99423e19a97d17a681df14'),
  ('purge', 'public.reservation_payment_shares', 'public.reservation_payment_shares'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservation_session_assignments', 'public.reservation_session_assignments'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservation_sessions', 'public.reservation_sessions'::regclass, 'true', 135, '7bd4f091684d0dff2b91e20f07359b50'),
  ('purge', 'public.reservation_transition_allocations', 'public.reservation_transition_allocations'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservation_transition_parties', 'public.reservation_transition_parties'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservation_transition_sources', 'public.reservation_transition_sources'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservation_transition_targets', 'public.reservation_transition_targets'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservation_transitions', 'public.reservation_transitions'::regclass, 'true', 0, 'd41d8cd98f00b204e9800998ecf8427e'),
  ('purge', 'public.reservations', 'public.reservations'::regclass, 'true', 123, 'dd623e6a99a4ff83701fe36fc91efad4'),
  ('purge', 'public.venue_event_courts', 'public.venue_event_courts'::regclass, $event_ids$event_id in ('00000000-0000-0000-0000-000000016501'::uuid,'00000000-0000-0000-0000-000000016502'::uuid)$event_ids$, 2, '1a90373f222c5e9183b266433671c22f'),
  ('purge', 'public.venue_events', 'public.venue_events'::regclass, $event_ids$id in ('00000000-0000-0000-0000-000000016501'::uuid,'00000000-0000-0000-0000-000000016502'::uuid)$event_ids$, 2, '8f4dd90fa8e2a1fdf056163d231d6094'),
  ('purge', 'public.venue_members', 'public.venue_members'::regclass, $member_ids$id in ('00000000-0000-0000-0000-000000016511'::uuid,'00000000-0000-0000-0000-000000016512'::uuid)$member_ids$, 2, '18fde48822fdbca4c32dc50495cffbcc');

do $stage_preflight$
declare
  v_mismatch text;
  v_preserve_fingerprint text;
  v_purge_fingerprint text;
begin
  if not pg_try_advisory_xact_lock(
    hashtextextended('tiger.issue-165.reservation-reset', 0)
  ) then
    raise exception 'tiger_r2_rehearsal_lock_unavailable';
  end if;

  if current_database() <> 'postgres'
     or current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'tiger_r2_rehearsal_unexpected_postgres_runtime';
  end if;

  if exists (
    select 1
    from private.app_audit_events
    where operation_id = 'reservation-reset-r2-stage-20260827-v1'
       or id = -1650999
  ) then
    raise exception 'tiger_r2_rehearsal_already_completed';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = '00000000-0000-0000-0000-000000017701'::uuid
      and email = 'synthetic-manager@example.invalid'
  ) or exists (
    select 1
    from public.bookings
    where user_id <> '00000000-0000-0000-0000-000000017701'::uuid
       or customer_email is null
       or customer_email !~ '^[^@]+@example[.]invalid$'
  ) then
    raise exception 'tiger_r2_rehearsal_non_synthetic_stage_detected';
  end if;

  select relation_name
  into v_mismatch
  from tiger_r2_expected
  where expected_count <> pg_temp.tiger_r2_count(relation_oid, predicate)
     or expected_fingerprint <> pg_temp.tiger_r2_fingerprint(relation_oid, predicate)
  order by scope, relation_name
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r2_rehearsal_baseline_mismatch:%', v_mismatch;
  end if;

  select md5(string_agg(
    relation_name || ':' || expected_count || ':' || expected_fingerprint,
    '|' order by relation_name
  )) into v_preserve_fingerprint
  from tiger_r2_expected
  where scope = 'preserve';

  select md5(string_agg(
    relation_name || ':' || expected_count || ':' || expected_fingerprint,
    '|' order by relation_name
  )) into v_purge_fingerprint
  from tiger_r2_expected
  where scope = 'purge';

  if v_preserve_fingerprint <> '5d5f491dfb3f49b9aeb11208c34c9e64'
     or v_purge_fingerprint <> 'd7b8917ef74c84b6dc8472966aab6203'
     or (select sum(expected_count) from tiger_r2_expected where scope = 'preserve') <> 134
     or (select sum(expected_count) from tiger_r2_expected where scope = 'purge') <> 1563 then
    raise exception 'tiger_r2_rehearsal_manifest_self_check_failed';
  end if;

  if (select last_value from private.app_audit_events_id_seq) <> 653
     or not (select is_called from private.app_audit_events_id_seq)
     or (select last_value from private.booking_admin_actions_id_seq) <> 73
     or not (select is_called from private.booking_admin_actions_id_seq)
     or (select last_value from public.payment_allocation_entries_id_seq) <> 46
     or not (select is_called from public.payment_allocation_entries_id_seq)
     or (select last_value from public.reservation_legacy_sources_id_seq) <> 178
     or not (select is_called from public.reservation_legacy_sources_id_seq)
     or (select last_value from public.reservation_transitions_sequence_seq) <> 18
     or not (select is_called from public.reservation_transitions_sequence_seq)
     or (select last_value from public.reservations_reference_number_seq) <> 1172
     or not (select is_called from public.reservations_reference_number_seq) then
    raise exception 'tiger_r2_rehearsal_sequence_baseline_mismatch';
  end if;
end
$stage_preflight$;

lock table
  private.app_audit_events,
  private.booking_admin_actions,
  private.reservation_phase3b_operations,
  public.bookings,
  public.court_slots,
  public.payment_allocation_entries,
  public.payments,
  public.recurrence_series,
  public.reservation_allocation_memberships,
  public.reservation_legacy_sources,
  public.reservation_parties,
  public.reservation_party_roles,
  public.reservation_payment_shares,
  public.reservation_session_assignments,
  public.reservation_sessions,
  public.reservation_transition_allocations,
  public.reservation_transition_parties,
  public.reservation_transition_sources,
  public.reservation_transition_targets,
  public.reservation_transitions,
  public.reservations,
  public.venue_event_courts,
  public.venue_events,
  public.venue_members
in share row exclusive mode;

lock table
  auth.identities,
  auth.refresh_tokens,
  auth.sessions,
  auth.users,
  private.manager_accounts,
  private.reservation_phase3b_activation_state,
  private.reservation_phase3b_writer_baseline,
  private.reservation_phase3b_writer_inventory,
  public.courts,
  public.profiles,
  public.staff_members,
  public.venue_member_tiers,
  public.venue_opening_hours,
  public.venue_pricing_rules,
  public.venue_settings,
  supabase_migrations.schema_migrations
in share mode;

create temporary table tiger_r2_snap_app_audit_events on commit drop as
select *
from private.app_audit_events
where (entity_type = 'booking' and entity_id in (select id::text from public.bookings))
   or (entity_type = 'venue_event' and entity_id in ('00000000-0000-0000-0000-000000016501','00000000-0000-0000-0000-000000016502'))
   or (entity_type = 'venue_member' and entity_id in ('00000000-0000-0000-0000-000000016511','00000000-0000-0000-0000-000000016512'));
create temporary table tiger_r2_snap_booking_admin_actions on commit drop as select * from private.booking_admin_actions;
create temporary table tiger_r2_snap_operations on commit drop as select * from private.reservation_phase3b_operations;
create temporary table tiger_r2_snap_bookings on commit drop as select * from public.bookings;
create temporary table tiger_r2_snap_court_slots on commit drop as select * from public.court_slots;
create temporary table tiger_r2_snap_payment_allocations on commit drop as select * from public.payment_allocation_entries;
create temporary table tiger_r2_snap_payments on commit drop as select * from public.payments;
create temporary table tiger_r2_snap_recurrence_series on commit drop as select * from public.recurrence_series;
create temporary table tiger_r2_snap_memberships on commit drop as select * from public.reservation_allocation_memberships;
create temporary table tiger_r2_snap_legacy_sources on commit drop as select * from public.reservation_legacy_sources;
create temporary table tiger_r2_snap_parties on commit drop as select * from public.reservation_parties;
create temporary table tiger_r2_snap_party_roles on commit drop as select * from public.reservation_party_roles;
create temporary table tiger_r2_snap_payment_shares on commit drop as select * from public.reservation_payment_shares;
create temporary table tiger_r2_snap_session_assignments on commit drop as select * from public.reservation_session_assignments;
create temporary table tiger_r2_snap_sessions on commit drop as select * from public.reservation_sessions;
create temporary table tiger_r2_snap_transition_allocations on commit drop as select * from public.reservation_transition_allocations;
create temporary table tiger_r2_snap_transition_parties on commit drop as select * from public.reservation_transition_parties;
create temporary table tiger_r2_snap_transition_sources on commit drop as select * from public.reservation_transition_sources;
create temporary table tiger_r2_snap_transition_targets on commit drop as select * from public.reservation_transition_targets;
create temporary table tiger_r2_snap_transitions on commit drop as select * from public.reservation_transitions;
create temporary table tiger_r2_snap_reservations on commit drop as select * from public.reservations;
create temporary table tiger_r2_snap_event_courts on commit drop as
select * from public.venue_event_courts
where event_id in (
  '00000000-0000-0000-0000-000000016501'::uuid,
  '00000000-0000-0000-0000-000000016502'::uuid
);
create temporary table tiger_r2_snap_events on commit drop as
select * from public.venue_events
where id in (
  '00000000-0000-0000-0000-000000016501'::uuid,
  '00000000-0000-0000-0000-000000016502'::uuid
);
create temporary table tiger_r2_snap_members on commit drop as
select * from public.venue_members
where id in (
  '00000000-0000-0000-0000-000000016511'::uuid,
  '00000000-0000-0000-0000-000000016512'::uuid
);

set local session_replication_role = replica;

delete from private.booking_admin_actions
where id in (select id from tiger_r2_snap_booking_admin_actions);
delete from private.app_audit_events
where id in (select id from tiger_r2_snap_app_audit_events);
delete from public.reservation_allocation_memberships;
delete from public.reservation_transition_parties;
delete from public.reservation_transition_allocations;
delete from public.reservation_transition_sources;
delete from public.reservation_transition_targets;
delete from public.reservation_session_assignments;
delete from public.reservation_transitions;
delete from private.reservation_phase3b_operations;
delete from public.payment_allocation_entries;
delete from public.reservation_payment_shares;
delete from public.payments;
delete from public.reservation_party_roles;
delete from public.reservation_legacy_sources;
delete from public.court_slots;
delete from public.bookings;
delete from public.reservation_parties;
delete from public.reservation_sessions;
delete from public.reservations;
delete from public.recurrence_series;
delete from public.venue_event_courts
where event_id in (select event_id from tiger_r2_snap_event_courts);
delete from public.venue_events
where id in (select id from tiger_r2_snap_events);
delete from public.venue_members
where id in (select id from tiger_r2_snap_members);

set local session_replication_role = origin;

update tiger_r2_timing set reset_at = clock_timestamp();

do $reset_postconditions$
declare
  v_mismatch text;
begin
  if (select count(*) from public.bookings) <> 0
     or (select count(*) from public.court_slots) <> 0
     or (select count(*) from public.recurrence_series) <> 0
     or (select count(*) from public.reservations) <> 0
     or (select count(*) from public.reservation_legacy_sources) <> 0
     or (select count(*) from public.reservation_parties) <> 0
     or (select count(*) from public.reservation_party_roles) <> 0
     or (select count(*) from public.reservation_sessions) <> 0
     or (select count(*) from public.reservation_payment_shares) <> 0
     or (select count(*) from public.payments) <> 0
     or (select count(*) from public.payment_allocation_entries) <> 0
     or (select count(*) from public.reservation_transitions) <> 0
     or (select count(*) from public.reservation_transition_sources) <> 0
     or (select count(*) from public.reservation_transition_targets) <> 0
     or (select count(*) from public.reservation_transition_allocations) <> 0
     or (select count(*) from public.reservation_transition_parties) <> 0
     or (select count(*) from public.reservation_allocation_memberships) <> 0
     or (select count(*) from public.reservation_session_assignments) <> 0
     or (select count(*) from private.reservation_phase3b_operations) <> 0
     or exists (select 1 from private.booking_admin_actions where id in (select id from tiger_r2_snap_booking_admin_actions))
     or exists (select 1 from private.app_audit_events where id in (select id from tiger_r2_snap_app_audit_events))
     or exists (select 1 from public.venue_events where id in (select id from tiger_r2_snap_events))
     or exists (select 1 from public.venue_event_courts where event_id in (select event_id from tiger_r2_snap_event_courts))
     or exists (select 1 from public.venue_members where id in (select id from tiger_r2_snap_members)) then
    raise exception 'tiger_r2_rehearsal_reset_postcondition_failed';
  end if;

  select relation_name
  into v_mismatch
  from tiger_r2_expected
  where scope = 'preserve'
    and (
      expected_count <> pg_temp.tiger_r2_count(relation_oid, predicate)
      or expected_fingerprint <> pg_temp.tiger_r2_fingerprint(relation_oid, predicate)
    )
  order by relation_name
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r2_rehearsal_preserve_drift_after_reset:%', v_mismatch;
  end if;

  if coalesce(current_setting('tiger.r2.fail_after_reset', true), 'false') = 'true' then
    raise exception 'tiger_r2_rehearsal_injected_failure_after_reset';
  end if;
end
$reset_postconditions$;

set local session_replication_role = replica;

insert into public.recurrence_series select * from tiger_r2_snap_recurrence_series;
insert into public.reservations overriding system value select * from tiger_r2_snap_reservations;
insert into public.reservation_sessions select * from tiger_r2_snap_sessions;
insert into public.reservation_parties select * from tiger_r2_snap_parties;
insert into public.reservation_party_roles select * from tiger_r2_snap_party_roles;
insert into public.payments select * from tiger_r2_snap_payments;
insert into public.reservation_payment_shares select * from tiger_r2_snap_payment_shares;
insert into public.bookings select * from tiger_r2_snap_bookings;
insert into public.reservation_legacy_sources overriding system value select * from tiger_r2_snap_legacy_sources;
insert into public.court_slots select * from tiger_r2_snap_court_slots;
insert into public.payment_allocation_entries overriding system value select * from tiger_r2_snap_payment_allocations;
insert into private.reservation_phase3b_operations select * from tiger_r2_snap_operations;
insert into public.reservation_transitions overriding system value select * from tiger_r2_snap_transitions;
insert into public.reservation_transition_sources select * from tiger_r2_snap_transition_sources;
insert into public.reservation_transition_targets select * from tiger_r2_snap_transition_targets;
insert into public.reservation_transition_allocations select * from tiger_r2_snap_transition_allocations;
insert into public.reservation_transition_parties select * from tiger_r2_snap_transition_parties;
insert into public.reservation_session_assignments select * from tiger_r2_snap_session_assignments;
insert into public.reservation_allocation_memberships select * from tiger_r2_snap_memberships;
insert into public.venue_events select * from tiger_r2_snap_events;
insert into public.venue_event_courts select * from tiger_r2_snap_event_courts;
insert into public.venue_members select * from tiger_r2_snap_members;
insert into private.app_audit_events overriding system value select * from tiger_r2_snap_app_audit_events;
insert into private.booking_admin_actions overriding system value select * from tiger_r2_snap_booking_admin_actions;

set local session_replication_role = origin;

update tiger_r2_timing set restored_at = clock_timestamp();

do $restore_postconditions$
declare
  v_mismatch text;
begin
  select relation_name
  into v_mismatch
  from tiger_r2_expected
  where expected_count <> pg_temp.tiger_r2_count(relation_oid, predicate)
     or expected_fingerprint <> pg_temp.tiger_r2_fingerprint(relation_oid, predicate)
  order by scope, relation_name
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r2_rehearsal_restore_mismatch:%', v_mismatch;
  end if;

  if (select coalesce(sum(amount), 0) from public.payment_allocation_entries) <> 1642.00
     or (select count(*) from public.bookings where reservation_id is null or session_id is null) <> 0
     or (select count(*) from public.reservation_allocation_memberships) <> 192
     or exists (select 1 from pg_constraint where contype = 'f' and not convalidated)
     or (select count(*) from pg_publication_tables where pubname = 'supabase_realtime') <> 1
     or not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'court_slots'
     )
     or (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) <> 28 then
    raise exception 'tiger_r2_rehearsal_business_postcondition_failed';
  end if;

  if (select last_value from private.app_audit_events_id_seq) <> 653
     or not (select is_called from private.app_audit_events_id_seq)
     or (select last_value from private.booking_admin_actions_id_seq) <> 73
     or not (select is_called from private.booking_admin_actions_id_seq)
     or (select last_value from public.payment_allocation_entries_id_seq) <> 46
     or not (select is_called from public.payment_allocation_entries_id_seq)
     or (select last_value from public.reservation_legacy_sources_id_seq) <> 178
     or not (select is_called from public.reservation_legacy_sources_id_seq)
     or (select last_value from public.reservation_transitions_sequence_seq) <> 18
     or not (select is_called from public.reservation_transitions_sequence_seq)
     or (select last_value from public.reservations_reference_number_seq) <> 1172
     or not (select is_called from public.reservations_reference_number_seq) then
    raise exception 'tiger_r2_rehearsal_sequence_restore_mismatch';
  end if;
end
$restore_postconditions$;

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
) overriding system value
select
  -1650999,
  clock_timestamp(),
  txid_current(),
  'reservation-reset-r2-stage-20260827-v1',
  'maintenance.reservation_reset_rehearsed',
  'maintenance_run',
  'issue-165-r2-stage-v1',
  null,
  null,
  'system',
  'reservation_reset_r2',
  null,
  null,
  array[]::text[],
  jsonb_build_object(
    'schema_version', 1,
    'project_ref', 'vcoujmzsgdboidndtzzg',
    'postgres_version', current_setting('server_version'),
    'migration_count', 51,
    'preserve_rows', 134,
    'purge_rows', 1563,
    'preserve_fingerprint', '5d5f491dfb3f49b9aeb11208c34c9e64',
    'purge_fingerprint', 'd7b8917ef74c84b6dc8472966aab6203',
    'reset_ms', round(extract(epoch from (reset_at - started_at)) * 1000, 3),
    'restore_ms', round(extract(epoch from (restored_at - reset_at)) * 1000, 3),
    'total_ms', round(extract(epoch from (restored_at - started_at)) * 1000, 3),
    'auth_deleted', false,
    'plaintext_backup_persisted', false
  ),
  null
from tiger_r2_timing;

commit;

select jsonb_build_object(
  'status', 'tiger_r2_stage_reset_restore_verified',
  'operation_id', operation_id,
  'postgres_version', metadata ->> 'postgres_version',
  'migration_count', (metadata ->> 'migration_count')::integer,
  'preserve_rows', (metadata ->> 'preserve_rows')::integer,
  'purge_rows', (metadata ->> 'purge_rows')::integer,
  'preserve_fingerprint', metadata ->> 'preserve_fingerprint',
  'purge_fingerprint', metadata ->> 'purge_fingerprint',
  'reset_ms', (metadata ->> 'reset_ms')::numeric,
  'restore_ms', (metadata ->> 'restore_ms')::numeric,
  'total_ms', (metadata ->> 'total_ms')::numeric,
  'auth_deleted', (metadata ->> 'auth_deleted')::boolean,
  'sequence_values_unchanged', true,
  'second_run_policy', 'reject_same_operation_id'
) as tiger_r2_rehearsal_result
from private.app_audit_events
where operation_id = 'reservation-reset-r2-stage-20260827-v1';
