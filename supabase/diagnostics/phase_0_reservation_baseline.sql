-- Tiger reservation migration: privacy-safe Phase 0 baseline
--
-- This script is intentionally read-only. It emits aggregate counts and schema
-- metadata only; it must never select customer values, booking IDs, user IDs,
-- provider references, notes, or audit JSON payloads.
--
-- Run with an authorized read-only/admin metadata connection. The transaction
-- itself rejects accidental writes.

begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

-- 1. Environment and migration history.
select
  statement_timestamp() as captured_at_utc,
  current_setting('server_version') as postgres_version,
  current_setting('TimeZone') as database_session_timezone;

select
  settings.timezone as venue_timezone,
  settings.currency as venue_currency,
  settings.lock_historical_bookings,
  settings.multi_court_drag_mode
from public.venue_settings as settings
where settings.singleton;

select version, name
from supabase_migrations.schema_migrations
order by version;

-- 2. Core booking/group/link/slot cardinality.
select
  count(*) as booking_rows,
  count(*) filter (where status in ('held', 'confirmed')) as active_booking_rows,
  count(*) filter (
    where status in ('held', 'confirmed')
      and (status <> 'held' or hold_expires_at is null or hold_expires_at > now())
  ) as slot_eligible_rows,
  count(distinct booking_group_id) as booking_groups,
  count(distinct booking_group_id)
    filter (where status in ('held', 'confirmed')) as active_booking_groups,
  count(distinct booking_link_id)
    filter (where booking_link_id is not null) as link_clusters,
  count(distinct booking_link_id)
    filter (
      where booking_link_id is not null
        and status in ('held', 'confirmed')
    ) as active_link_clusters,
  count(distinct recurrence_series_id)
    filter (where recurrence_series_id is not null) as recurrence_series,
  count(*) filter (where booking_group_id is null) as null_booking_group_rows
from public.bookings;

with group_rollup as (
  select
    booking_group_id,
    count(*) as row_count,
    bool_or(status in ('held', 'confirmed')) as has_active_row,
    bool_or(status = 'cancelled') as has_cancelled_row,
    count(distinct coalesce(booking_link_id::text, '<null>')) as link_shapes,
    count(distinct (start_at, end_at)) as schedule_count,
    bool_or(booking_link_id is not null) as is_linked
  from public.bookings
  group by booking_group_id
)
select
  count(*) filter (where row_count > 1) as multi_row_groups,
  count(*) filter (where has_active_row and row_count > 1) as active_multi_row_groups,
  count(*) filter (where has_active_row and has_cancelled_row) as partially_cancelled_groups,
  count(*) filter (where link_shapes > 1) as inconsistent_link_membership_groups,
  count(*) filter (where schedule_count > 1) as multi_schedule_groups,
  count(*) filter (where has_active_row and schedule_count > 1) as active_multi_schedule_groups,
  count(*) filter (where is_linked) as linked_groups,
  count(*) filter (where is_linked and has_active_row) as active_linked_groups
from group_rollup;

-- 3. Court slot projection and overlap invariants.
with expected as (
  select id, court_id, start_at, end_at, status
  from public.bookings
  where status in ('held', 'confirmed')
    and (status <> 'held' or hold_expires_at is null or hold_expires_at > now())
), comparison as (
  select
    expected.id as expected_id,
    slot.id as slot_id,
    expected.court_id as expected_court_id,
    slot.court_id as slot_court_id,
    expected.start_at as expected_start_at,
    slot.start_at as slot_start_at,
    expected.end_at as expected_end_at,
    slot.end_at as slot_end_at,
    expected.status as expected_status,
    slot.status as slot_status
  from expected
  full join public.court_slots as slot on slot.id = expected.id
)
select
  count(*) filter (where expected_id is not null and slot_id is null) as missing_slots,
  count(*) filter (where expected_id is null and slot_id is not null) as stale_slots,
  count(*) filter (
    where expected_id is not null
      and slot_id is not null
      and (
        expected_court_id is distinct from slot_court_id
        or expected_start_at is distinct from slot_start_at
        or expected_end_at is distinct from slot_end_at
        or expected_status is distinct from slot_status
      )
  ) as mismatched_slots
from comparison;

select count(*) as active_overlap_pairs
from public.bookings as left_booking
join public.bookings as right_booking
  on left_booking.id::text < right_booking.id::text
 and left_booking.court_id = right_booking.court_id
 and tsrange(left_booking.start_at, left_booking.end_at, '[)')
     && tsrange(right_booking.start_at, right_booking.end_at, '[)')
where left_booking.status in ('held', 'confirmed')
  and right_booking.status in ('held', 'confirmed');

select
  count(*) filter (where end_at <= start_at) as invalid_intervals,
  count(*) filter (where total_amount < 0) as negative_amount_rows
from public.bookings;

-- 4. PII-safe linked-cluster shape. Customer values are never returned.
with active_link_clusters as (
  select
    booking_link_id,
    count(distinct booking_group_id) as group_count,
    count(distinct (start_at, end_at)) as schedule_count,
    count(distinct (end_at - start_at)) as duration_count,
    count(distinct payment_status) as payment_status_count,
    count(distinct currency) as currency_count,
    count(distinct lower(trim(customer_name))) as customer_name_count,
    count(distinct lower(trim(customer_email)))
      filter (where nullif(trim(customer_email), '') is not null) as nonblank_email_count,
    bool_or(nullif(trim(customer_email), '') is null) as has_blank_email,
    bool_or(nullif(trim(customer_email), '') is not null) as has_nonblank_email,
    count(distinct regexp_replace(trim(customer_phone), '\\s+', '', 'g'))
      filter (where nullif(trim(customer_phone), '') is not null) as nonblank_phone_count,
    bool_or(nullif(trim(customer_phone), '') is null) as has_blank_phone,
    bool_or(nullif(trim(customer_phone), '') is not null) as has_nonblank_phone
  from public.bookings
  where status in ('held', 'confirmed')
    and booking_link_id is not null
  group by booking_link_id
)
select
  count(*) as active_link_clusters,
  coalesce(sum(group_count), 0) as active_linked_groups,
  count(*) filter (where schedule_count > 1) as clusters_with_multiple_schedules,
  count(*) filter (where duration_count > 1) as clusters_with_multiple_durations,
  count(*) filter (where payment_status_count > 1) as clusters_with_mixed_payment,
  count(*) filter (where currency_count > 1) as clusters_with_multiple_currencies,
  count(*) filter (where customer_name_count > 1) as clusters_with_different_names,
  count(*) filter (where nonblank_email_count > 1) as clusters_with_different_nonblank_emails,
  count(*) filter (where has_blank_email and has_nonblank_email) as clusters_with_mixed_email_presence,
  count(*) filter (where nonblank_phone_count > 1) as clusters_with_different_nonblank_phones,
  count(*) filter (where has_blank_phone and has_nonblank_phone) as clusters_with_mixed_phone_presence
from active_link_clusters;

-- 5. Deterministic target cardinality. IDs are used only for grouping.
with legacy_groups as (
  select
    booking_group_id,
    (array_agg(booking_link_id order by booking_link_id)
      filter (where booking_link_id is not null))[1] as booking_link_id,
    bool_or(status in ('held', 'confirmed')) as has_active_row
  from public.bookings
  group by booking_group_id
), reservation_keys as (
  select
    booking_group_id,
    has_active_row,
    case
      when booking_link_id is null then 'group:' || booking_group_id::text
      else 'link:' || booking_link_id::text
    end as reservation_key
  from legacy_groups
), sessions as (
  select
    booking_group_id,
    start_at,
    end_at,
    bool_or(status in ('held', 'confirmed')) as is_active
  from public.bookings
  group by booking_group_id, start_at, end_at
)
select
  (select count(distinct reservation_key) from reservation_keys) as target_reservations,
  (select count(distinct reservation_key) from reservation_keys where has_active_row) as active_target_reservations,
  (select count(*) from sessions) as target_sessions,
  (select count(*) from sessions where is_active) as active_target_sessions,
  (select count(*) from public.bookings) as target_court_allocations,
  (select count(*) from public.bookings where status in ('held', 'confirmed')) as active_target_court_allocations,
  (select count(*) from legacy_groups) as target_legacy_group_party_snapshots,
  (select count(*) from legacy_groups where has_active_row) as active_target_party_snapshots;

-- 6. Recurrence shape.
with recurrence_occurrences as (
  select
    recurrence_series_id,
    recurrence_week,
    booking_group_id,
    bool_or(status in ('held', 'confirmed')) as has_active_row
  from public.bookings
  where recurrence_series_id is not null or recurrence_week is not null
  group by recurrence_series_id, recurrence_week, booking_group_id
), duplicate_weeks as (
  select recurrence_series_id, recurrence_week
  from recurrence_occurrences
  where recurrence_series_id is not null and recurrence_week is not null
  group by recurrence_series_id, recurrence_week
  having count(distinct booking_group_id) > 1
), inconsistent_groups as (
  select booking_group_id
  from public.bookings
  group by booking_group_id
  having count(distinct coalesce(recurrence_series_id::text, '<null>')) > 1
      or count(distinct coalesce(recurrence_week::text, '<null>')) > 1
)
select
  count(distinct recurrence_series_id)
    filter (where recurrence_series_id is not null) as recurrence_series,
  count(distinct recurrence_series_id)
    filter (where recurrence_series_id is not null and has_active_row) as active_recurrence_series,
  count(*) filter (
    where recurrence_series_id is not null and recurrence_week is not null
  ) as occurrence_groups,
  min(recurrence_week) as minimum_week,
  max(recurrence_week) as maximum_week,
  count(*) filter (
    where (recurrence_series_id is null) <> (recurrence_week is null)
  ) as incomplete_recurrence_rows,
  (select count(*) from duplicate_weeks) as duplicate_series_week_entries,
  (select count(*) from inconsistent_groups) as inconsistent_recurrence_groups
from recurrence_occurrences;

-- 7. Pricing and payment-state aggregates.
select
  status,
  payment_status,
  payment_method,
  price_source,
  currency,
  count(*) as row_count,
  round(sum(total_amount), 2) as total_amount
from public.bookings
group by status, payment_status, payment_method, price_source, currency
order by status, payment_status, payment_method, price_source, currency;

select
  count(*) as booking_rows,
  round(sum(total_amount), 2) as all_amount,
  count(*) filter (where status in ('held', 'confirmed')) as active_rows,
  round(sum(total_amount) filter (where status in ('held', 'confirmed')), 2) as active_amount,
  count(*) filter (where payment_status = 'paid') as paid_rows,
  round(sum(total_amount) filter (where payment_status = 'paid'), 2) as paid_marked_amount,
  count(distinct currency) as currencies_used,
  count(*) filter (where currency <> 'CAD') as non_cad_rows,
  count(*) filter (where payment_method = 'stripe') as stripe_rows,
  count(*) filter (where stripe_checkout_session_id is not null) as checkout_reference_rows,
  count(*) filter (where stripe_payment_intent_id is not null) as payment_intent_reference_rows,
  count(*) filter (where payment_status in ('refunded', 'failed')) as refunded_or_failed_rows
from public.bookings;

select
  count(*) filter (
    where price_source = 'system' and system_calculated_amount is null
  ) as system_amount_null_rows,
  count(*) filter (
    where price_source = 'system' and price_override_amount is not null
  ) as system_with_override_rows,
  count(*) filter (
    where price_source = 'manager_override' and price_override_amount is null
  ) as override_without_amount_rows,
  count(*) filter (
    where price_source = 'manager_override'
      and total_amount is distinct from price_override_amount
  ) as override_total_mismatch_rows,
  count(*) filter (where price_source = 'manager_override') as override_rows,
  round(sum(system_calculated_amount)
    filter (where price_source = 'manager_override'), 2) as override_system_amount,
  round(sum(total_amount)
    filter (where price_source = 'manager_override'), 2) as override_final_amount
from public.bookings;

-- 8. Payment audit reconstruction coverage. No audit state or entity ID is emitted.
with paid_bookings as (
  select id
  from public.bookings
  where payment_status = 'paid'
), paid_coverage as (
  select
    paid.id,
    exists (
      select 1
      from private.app_audit_events as event
      where event.entity_type = 'booking'
        and event.entity_id = paid.id::text
        and event.event_type = 'booking.payment_updated'
    ) as has_payment_update
  from paid_bookings as paid
)
select
  count(*) as paid_rows,
  count(*) filter (where has_payment_update) as paid_rows_with_payment_update,
  count(*) filter (where not has_payment_update) as paid_rows_without_payment_update,
  (select count(*)
   from public.bookings
   where payment_status = 'paid' and status = 'cancelled') as cancelled_paid_rows,
  (select count(*)
   from private.app_audit_events
   where event_type = 'booking.payment_updated') as payment_update_events,
  (select count(distinct operation_id)
   from private.app_audit_events
   where event_type = 'booking.payment_updated') as payment_update_operations
from paid_coverage;

-- 9. Audit coverage and event distribution.
select
  count(*) as audit_events,
  count(distinct operation_id) as audit_operations,
  count(distinct (entity_type, entity_id))
    filter (where entity_id is not null) as audited_entity_pairs,
  count(*) filter (where operation_id is null) as null_operation_ids,
  count(*) filter (where before_state is null) as null_before_states,
  count(*) filter (where after_state is null) as null_after_states
from private.app_audit_events;

select
  count(*) as bookings_without_audit_event
from public.bookings as booking
where not exists (
  select 1
  from private.app_audit_events as event
  where event.entity_type = 'booking'
    and event.entity_id = booking.id::text
);

select
  event_type,
  count(*) as event_count,
  count(distinct operation_id) as operation_count
from private.app_audit_events
group by event_type
order by event_type;

select count(*) as legacy_booking_admin_action_rows
from private.booking_admin_actions;

-- 10. Constraints, triggers, RLS, policies, grants, and Realtime publication.
select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  constraint_row.convalidated
from pg_constraint as constraint_row
join pg_class as relation on relation.oid = constraint_row.conrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname in ('public', 'private')
  and relation.relname in ('bookings', 'court_slots', 'app_audit_events')
order by namespace.nspname, relation.relname, constraint_row.conname;

select
  event_object_schema as schema_name,
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation
from information_schema.triggers
where event_object_schema in ('public', 'private')
  and event_object_table in ('bookings', 'court_slots', 'app_audit_events')
order by event_object_schema, event_object_table, trigger_name, event_manipulation;

select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_rls
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname in ('public', 'private')
  and relation.relkind in ('r', 'p')
order by namespace.nspname, relation.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname in ('public', 'private')
order by schemaname, tablename, policyname;

select
  table_schema,
  grantee,
  privilege_type,
  count(*) as granted_table_count
from information_schema.role_table_grants
where table_schema in ('public', 'private')
  and grantee in ('anon', 'authenticated')
group by table_schema, grantee, privilege_type
order by table_schema, grantee, privilege_type;

select
  has_schema_privilege('anon', 'public', 'USAGE') as anon_public_usage,
  has_schema_privilege('authenticated', 'public', 'USAGE') as authenticated_public_usage,
  has_schema_privilege('anon', 'private', 'USAGE') as anon_private_usage,
  has_schema_privilege('authenticated', 'private', 'USAGE') as authenticated_private_usage;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname in ('public', 'private')
order by schemaname, tablename;

-- 11. SECURITY DEFINER boundary summary. Function bodies and names are not emitted.
with routines as (
  select
    namespace.nspname as schema_name,
    routine.oid,
    routine.proname,
    routine.prosecdef,
    routine.proconfig,
    pg_get_functiondef(routine.oid) as definition
  from pg_proc as routine
  join pg_namespace as namespace on namespace.oid = routine.pronamespace
  where namespace.nspname in ('public', 'private')
)
select
  count(*) as public_private_routines,
  count(*) filter (where prosecdef) as security_definer_routines,
  count(*) filter (where prosecdef and schema_name = 'public') as public_security_definer_routines,
  count(*) filter (
    where prosecdef
      and schema_name = 'public'
      and has_function_privilege('authenticated', oid, 'EXECUTE')
  ) as authenticated_executable_public_definers,
  count(*) filter (
    where prosecdef
      and (
        proconfig is null
        or not exists (
          select 1 from unnest(proconfig) as setting
          where setting like 'search_path=%'
        )
      )
  ) as definers_without_explicit_search_path,
  count(*) filter (
    where prosecdef
      and schema_name = 'public'
      and proname like 'admin\_%' escape E'\\'
      and definition not ilike '%private.require_manager%'
  ) as public_admin_definers_without_direct_require_manager_call
from routines;

-- 12. Foreign keys without a valid leading-column index.
select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  constraint_row.conname as foreign_key_name
from pg_constraint as constraint_row
join pg_class as relation on relation.oid = constraint_row.conrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where constraint_row.contype = 'f'
  and namespace.nspname in ('public', 'private')
  and not exists (
    select 1
    from pg_index as index_row
    where index_row.indrelid = constraint_row.conrelid
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indnkeyatts >= cardinality(constraint_row.conkey)
      and not exists (
        select 1
        from unnest(constraint_row.conkey) with ordinality as fk_column(attnum, position)
        where (index_row.indkey::smallint[])[fk_column.position - 1] <> fk_column.attnum
      )
  )
order by namespace.nspname, relation.relname, constraint_row.conname;

-- 13. Privacy-safe size and maintenance signals.
select
  stats.schemaname,
  stats.relname as table_name,
  stats.n_live_tup,
  stats.n_dead_tup,
  pg_total_relation_size(format('%I.%I', stats.schemaname, stats.relname)::regclass) as total_bytes,
  stats.last_autovacuum,
  stats.last_autoanalyze
from pg_stat_user_tables as stats
where stats.schemaname in ('public', 'private')
order by total_bytes desc, stats.schemaname, stats.relname;

select
  datname,
  stats_reset,
  deadlocks,
  conflicts
from pg_stat_database
where datname = current_database();

rollback;
