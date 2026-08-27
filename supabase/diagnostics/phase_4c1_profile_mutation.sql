-- Read-only verification for Reservation Phase 4C.1.
-- Output is deliberately limited to contract state, counts and scope labels;
-- it never selects customer contact fields, free-text notes or patch payloads.

begin transaction read only;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $diagnostic$
declare
  v_version_count integer;
  v_latest_version text;
  v_phase3b jsonb;
  v_phase4a jsonb;
  v_phase4c1 jsonb;
  v_private_function_count integer;
  v_incomplete_operation_count integer;
  v_realtime_tables text[];
begin
  select count(*)::integer, max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 51 or v_latest_version <> '20260827090512' then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 4C.1 diagnostic expected 51 migrations ending at 20260827090512; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<null>')
      );
  end if;

  v_phase3b := private.assert_reservation_phase3b_activation();
  v_phase4a := private.assert_reservation_phase4a_read_contract();
  v_phase4c1 := private.assert_reservation_phase4c1_profile_mutation();

  if v_phase3b ->> 'status' <> 'clean'
     or v_phase4a ->> 'status' <> 'phase_4a_manager_read_contract_verified'
     or v_phase4c1 ->> 'status' <> 'phase_4c1_profile_mutation_verified'
     or (v_phase4c1 ->> 'public_rpc_count')::integer <> 1
     or (v_phase4c1 ->> 'private_function_count')::integer <> 5
     or v_phase4c1 ->> 'party_lineage_mode' <> 'bidirectional_transition_graph'
     or (v_phase4c1 ->> 'private_client_execute_count')::integer <> 0
  then
    raise exception using errcode = '55000', message = 'Phase 4C.1 contract verification failed';
  end if;

  select count(*)::integer
    into v_private_function_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname in (
      'reservation_phase4c1_record_audit',
      'reservation_phase4c1_update_profile',
      'reservation_phase4c1_party_lineage_scope',
      'reservation_phase4c1_update_party_profile',
      'assert_reservation_phase4c1_profile_mutation'
    );

  if v_private_function_count <> 5 then
    raise exception using errcode = '55000', message = 'Phase 4C.1 private function inventory drifted';
  end if;

  if has_function_privilege(
       'anon',
       'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)',
       'EXECUTE'
     ) then
    raise exception using errcode = '55000', message = 'Phase 4C.1 public RPC grants drifted';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants as grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'reservations',
        'reservation_sessions',
        'reservation_parties',
        'bookings'
      )
      and grant_row.grantee in ('anon', 'authenticated')
      and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    raise exception using errcode = '55000', message = 'Phase 4C.1 introduced client table mutation grants';
  end if;

  select count(*)::integer
    into v_incomplete_operation_count
  from private.reservation_phase3b_operations as operation
  where operation.status <> 'completed';

  if v_incomplete_operation_count <> 0 then
    raise exception using errcode = '55000', message = 'Phase 4C.1 found incomplete transaction operations';
  end if;

  select coalesce(array_agg(
    format('%I.%I', publication_table.schemaname, publication_table.tablename)
    order by publication_table.schemaname, publication_table.tablename
  ), '{}'::text[])
    into v_realtime_tables
  from pg_catalog.pg_publication_tables as publication_table
  where publication_table.pubname = 'supabase_realtime'
    and publication_table.schemaname in ('public', 'private');

  if v_realtime_tables is distinct from array['public.court_slots']::text[] then
    raise exception using
      errcode = '55000',
      message = format('Phase 4C.1 Realtime boundary drifted: %s', v_realtime_tables);
  end if;
end;
$diagnostic$;

select jsonb_build_object(
  'status', 'phase_4c1_profile_mutation_verified',
  'schema_version', 1,
  'migration_count', (
    select count(*) from supabase_migrations.schema_migrations
  ),
  'latest_migration', (
    select max(version) from supabase_migrations.schema_migrations
  ),
  'contract', private.assert_reservation_phase4c1_profile_mutation(),
  'profile_operation_count', (
    select count(*)
    from private.reservation_phase3b_operations as operation
    where operation.operation_type = 'update_profile'
  ),
  'profile_audit_count', (
    select count(*)
    from private.app_audit_events as event
    where event.source = 'reservation_phase4c1_profile'
  ),
  'profile_audit_scope_counts', (
    select coalesce(jsonb_object_agg(scope_count.entity_type, scope_count.event_count), '{}'::jsonb)
    from (
      select event.entity_type, count(*) as event_count
      from private.app_audit_events as event
      where event.source = 'reservation_phase4c1_profile'
      group by event.entity_type
      order by event.entity_type
    ) as scope_count
  ),
  'incomplete_operation_count', (
    select count(*)
    from private.reservation_phase3b_operations as operation
    where operation.status <> 'completed'
  ),
  'realtime_tables', (
    select coalesce(jsonb_agg(
      format('%I.%I', publication_table.schemaname, publication_table.tablename)
      order by publication_table.schemaname, publication_table.tablename
    ), '[]'::jsonb)
    from pg_catalog.pg_publication_tables as publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname in ('public', 'private')
  )
) as result;

rollback;
