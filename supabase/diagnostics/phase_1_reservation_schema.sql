-- Tiger Reservation migration Phase 1 verification
--
-- Run only after 20260823072016_reservation_aggregate_schema.sql has been
-- applied to an isolated/local/preview database. This script is read-only,
-- emits metadata/aggregate results only, and raises on a failed invariant.

begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

do $$
declare
  v_count bigint;
  v_names text[] := array[
    'payment_allocation_entries',
    'payments',
    'recurrence_series',
    'reservation_legacy_sources',
    'reservation_parties',
    'reservation_party_roles',
    'reservation_payment_shares',
    'reservation_sessions',
    'reservations'
  ];
begin
  select count(*) into v_count
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname = any(v_names);
  if v_count <> cardinality(v_names) then
    raise exception 'Expected % Phase 1 tables, found %', cardinality(v_names), v_count;
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'bookings'
    and column_name in ('reservation_id', 'session_id')
    and data_type = 'uuid'
    and is_nullable = 'YES'
    and column_default is null;
  if v_count <> 2 then
    raise exception 'bookings Reservation ownership columns are missing or not nullable/default-free';
  end if;

  select count(*) into v_count
  from public.bookings
  where reservation_id is not null or session_id is not null;
  if v_count <> 0 then
    raise exception 'Phase 1 must not backfill booking ownership; found % populated rows', v_count;
  end if;

  select
    (select count(*) from public.recurrence_series)
    + (select count(*) from public.reservations)
    + (select count(*) from public.reservation_legacy_sources)
    + (select count(*) from public.reservation_parties)
    + (select count(*) from public.reservation_party_roles)
    + (select count(*) from public.reservation_sessions)
    + (select count(*) from public.reservation_payment_shares)
    + (select count(*) from public.payments)
    + (select count(*) from public.payment_allocation_entries)
  into v_count;
  if v_count <> 0 then
    raise exception 'Phase 1 target tables must remain empty; found % rows', v_count;
  end if;

  select count(*) into v_count
  from pg_constraint as constraint_row
  join pg_class as relation on relation.oid = constraint_row.conrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in ('bookings', 'reservations', 'reservation_sessions')
    and constraint_row.conname in (
      'bookings_reservation_ownership_shape_check',
      'bookings_reservation_currency_fkey',
      'bookings_session_reservation_fkey',
      'bookings_no_time_overlap',
      'reservations_id_currency_key',
      'reservation_sessions_id_reservation_key'
    )
    and constraint_row.convalidated;
  if v_count <> 6 then
    raise exception 'One or more ownership/overlap constraints are missing or unvalidated';
  end if;

  select count(*) into v_count
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = any(v_names)
    and relation.relkind = 'r'
    and relation.relrowsecurity
    and relation.relforcerowsecurity;
  if v_count <> cardinality(v_names) then
    raise exception 'Every Phase 1 table must have RLS and FORCE RLS';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = any(v_names)
    and cmd = 'SELECT'
    and roles = array['authenticated']::name[];
  if v_count <> cardinality(v_names) then
    raise exception 'Every Phase 1 table must have one authenticated manager SELECT policy';
  end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_names)
    and grantee in ('anon', 'service_role');
  if v_count <> 0 then
    raise exception 'anon/service_role received unexpected direct Phase 1 table grants';
  end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_names)
    and grantee = 'authenticated'
    and privilege_type <> 'SELECT';
  if v_count <> 0 then
    raise exception 'authenticated received unexpected Phase 1 DML grants';
  end if;

  select count(distinct table_name) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_names)
    and grantee = 'authenticated'
    and privilege_type = 'SELECT';
  if v_count <> cardinality(v_names) then
    raise exception 'authenticated is missing an intended manager-only SELECT grant';
  end if;

  select count(*) into v_count
  from information_schema.role_usage_grants
  where object_schema = 'public'
    and object_name in (
      'reservations_reference_number_seq',
      'reservation_legacy_sources_id_seq',
      'payment_allocation_entries_id_seq'
    )
    and grantee in ('anon', 'authenticated', 'service_role');
  if v_count <> 0 then
    raise exception 'A client/API role received an unexpected Phase 1 sequence grant';
  end if;

  select count(*) into v_count
  from pg_proc as routine
  join pg_namespace as namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'private'
    and routine.proname in (
      'enforce_booking_session_projection',
      'reject_reservation_history_mutation',
      'enforce_payment_immutability'
    )
    and not routine.prosecdef
    and exists (
      select 1 from unnest(routine.proconfig) as setting
      where setting = 'search_path=' or setting = 'search_path=""'
    );
  if v_count <> 3 then
    raise exception 'Phase 1 integrity functions must be SECURITY INVOKER with an empty search_path';
  end if;

  select count(*) into v_count
  from pg_proc as routine
  join pg_namespace as namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'private'
    and routine.proname in (
      'enforce_booking_session_projection',
      'reject_reservation_history_mutation',
      'enforce_payment_immutability'
    )
    and (
      has_function_privilege('anon', routine.oid, 'EXECUTE')
      or has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      or has_function_privilege('service_role', routine.oid, 'EXECUTE')
    );
  if v_count <> 0 then
    raise exception 'A client/API role can directly execute a Phase 1 integrity function';
  end if;

  select count(distinct trigger_name) into v_count
  from information_schema.triggers
  where event_object_schema = 'public'
    and trigger_name in (
      'bookings_enforce_session_projection',
      'reservation_legacy_sources_no_delete',
      'payment_allocation_entries_immutable',
      'payments_enforce_immutability',
      'recurrence_series_set_updated_at',
      'reservations_set_updated_at',
      'reservation_parties_set_updated_at',
      'reservation_sessions_set_updated_at',
      'reservation_payment_shares_set_updated_at'
    );
  if v_count <> 9 then
    raise exception 'Expected 9 Phase 1 triggers, found %', v_count;
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = any(v_names)
    and data_type = 'timestamp without time zone';
  if v_count <> 0 then
    raise exception 'New Phase 1 tables must use timestamptz, not timestamp without time zone';
  end if;

  select count(*) into v_count
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = any(v_names);
  if v_count <> 0 then
    raise exception 'Phase 1 must not add new tables to the Realtime publication';
  end if;
end;
$$;

-- Every foreign key needs a valid index whose leading columns
-- match the referencing columns. This emits only schema metadata.
do $$
declare
  v_missing text;
begin
  select string_agg(
    format('%I.%I:%I', namespace.nspname, relation.relname, constraint_row.conname),
    ', ' order by namespace.nspname, relation.relname, constraint_row.conname
  ) into v_missing
  from pg_constraint as constraint_row
  join pg_class as relation on relation.oid = constraint_row.conrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where constraint_row.contype = 'f'
    and namespace.nspname = 'public'
    and relation.relname in (
      'bookings',
      'payment_allocation_entries',
      'payments',
      'recurrence_series',
      'reservation_legacy_sources',
      'reservation_parties',
      'reservation_party_roles',
      'reservation_payment_shares',
      'reservation_sessions',
      'reservations'
    )
    and not exists (
      select 1
      from pg_index as index_row
      where index_row.indrelid = constraint_row.conrelid
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indnkeyatts >= cardinality(constraint_row.conkey)
        and not exists (
          select 1
          from unnest(constraint_row.conkey) with ordinality as fk_column(attnum, position)
          where (index_row.indkey::smallint[])[fk_column.position - 1] <> fk_column.attnum
        )
    );

  if v_missing is not null then
    raise exception 'Missing leading-column FK indexes: %', v_missing;
  end if;
end;
$$;

-- Existing slot and overlap protections must remain intact.
do $$
declare
  v_count bigint;
begin
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
  select count(*) into v_count
  from comparison
  where expected_id is null
     or slot_id is null
     or expected_court_id is distinct from slot_court_id
     or expected_start_at is distinct from slot_start_at
     or expected_end_at is distinct from slot_end_at
     or expected_status is distinct from slot_status;

  if v_count <> 0 then
    raise exception 'Existing court_slots projection changed or is inconsistent';
  end if;
end;
$$;

select
  statement_timestamp() as verified_at,
  'phase_1_reservation_schema_verified' as result,
  (select count(*) from public.bookings) as unchanged_legacy_booking_rows,
  (select count(*) from public.court_slots) as unchanged_active_slot_rows;

rollback;
