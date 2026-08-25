begin transaction read only;

set local statement_timeout = '30s';

do $diagnostic$
declare
  v_version_count integer;
  v_latest_version text;
  v_view_count integer;
  v_function_count integer;
  v_index_definition text;
  v_realtime_tables text[];
  v_phase3b jsonb;
  v_phase4a jsonb;
begin
  select count(*)::integer, max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 48 or v_latest_version <> '20260825091608' then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 4A diagnostic expected 48 migrations ending at 20260825091608; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<null>')
      );
  end if;

  v_phase3b := private.assert_reservation_phase3b_activation();
  if v_phase3b ->> 'status' <> 'clean'
     or v_phase3b -> 'writer_inventory' ->> 'status' <> 'activated'
     or (v_phase3b -> 'writer_inventory' ->> 'public_entry_count')::integer <> 17
     or (v_phase3b -> 'writer_inventory' ->> 'public_direct_booking_writer_count')::integer <> 0
     or (v_phase3b -> 'writer_inventory' ->> 'private_legacy_writer_count')::integer <> 17
     or (v_phase3b -> 'writer_inventory' ->> 'wrapper_count')::integer <> 3
     or (v_phase3b ->> 'membership_count')::integer
       <> (v_phase3b ->> 'booking_count')::integer
     or (v_phase3b ->> 'shadow_mismatch_count')::integer <> 0
     or (v_phase3b ->> 'projection_mismatch_count')::integer <> 0
     or (v_phase3b ->> 'payment_mismatch_count')::integer <> 0
     or (v_phase3b ->> 'incomplete_operation_count')::integer <> 0
     or (v_phase3b ->> 'rls_force_table_count')::integer <> 7
     or v_phase3b -> 'realtime_tables' <> '["public.court_slots"]'::jsonb
  then
    raise exception using errcode = '55000', message = 'Phase 3B.2 activation regressed';
  end if;

  select count(*)::integer
    into v_view_count
  from pg_catalog.pg_class as class
  join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relkind = 'v'
    and class.relname = any(array[
      'reservation_admin_summary_v1',
      'reservation_admin_allocations_v1',
      'reservation_phase4a_read_mismatches'
    ])
    and 'security_invoker=true' = any(coalesce(class.reloptions, '{}'::text[]));

  if v_view_count <> 3 then
    raise exception using errcode = '55000', message = 'Phase 4A security-invoker view inventory drifted';
  end if;

  select count(*)::integer
    into v_function_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = any(array[
      'admin_list_reservation_allocations',
      'admin_search_reservations',
      'admin_get_reservation_detail',
      'admin_get_reservation_read_shadow_status'
    ])
    and not procedure.prosecdef
    and procedure.proconfig = array['search_path=""']::text[]
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    and not has_function_privilege('service_role', procedure.oid, 'EXECUTE');

  if v_function_count <> 4 then
    raise exception using errcode = '55000', message = 'Phase 4A invoker function security/grant inventory drifted';
  end if;

  if exists (
    select 1
    from (values
      ('reservation_admin_summary_v1'),
      ('reservation_admin_allocations_v1'),
      ('reservation_phase4a_read_mismatches')
    ) as expected(view_name)
    where not has_table_privilege(
      'authenticated',
      format('public.%I', expected.view_name),
      'SELECT'
    )
       or has_table_privilege('anon', format('public.%I', expected.view_name), 'SELECT')
       or has_table_privilege('service_role', format('public.%I', expected.view_name), 'SELECT')
  ) then
    raise exception using errcode = '55000', message = 'Phase 4A view grants drifted';
  end if;

  select indexdef
    into v_index_definition
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = 'reservation_sessions'
    and indexname = 'reservation_sessions_admin_window_idx';

  if v_index_definition is null
     or v_index_definition not like '%(starts_at, id, reservation_id, ends_at)%'
  then
    raise exception using errcode = '55000', message = 'Phase 4A schedule window index drifted';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants as grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name = any(array[
        'reservations',
        'reservation_sessions',
        'reservation_parties',
        'reservation_party_roles',
        'reservation_payment_shares',
        'payments',
        'payment_allocation_entries',
        'reservation_allocation_memberships',
        'reservation_session_assignments',
        'reservation_transitions',
        'reservation_transition_sources',
        'reservation_transition_targets',
        'reservation_transition_allocations'
      ])
      and grant_row.grantee in ('anon', 'authenticated')
      and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    raise exception using errcode = '55000', message = 'Phase 4A introduced client mutation grants';
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
      message = format('Realtime boundary drifted: %s', v_realtime_tables);
  end if;

  if exists (
    select 1
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'reservation_phase4a_read_mismatches'
      and column_row.column_name in (
        'customer_name', 'customer_email', 'customer_phone', 'customer_notes',
        'display_name', 'email', 'phone', 'notes'
      )
  ) then
    raise exception using errcode = '55000', message = 'Phase 4A diagnostic exposes PII columns';
  end if;

  v_phase4a := private.assert_reservation_phase4a_read_contract();
  if v_phase4a ->> 'status' <> 'phase_4a_manager_read_contract_verified' then
    raise exception using errcode = '55000', message = 'Phase 4A read contract is not verified';
  end if;
end;
$diagnostic$;

select jsonb_build_object(
  'status', 'phase_4a_manager_read_contract_verified',
  'schema_version', 1,
  'migration_count', (
    select count(*) from supabase_migrations.schema_migrations
  ),
  'latest_migration', (
    select max(version) from supabase_migrations.schema_migrations
  ),
  'phase_3b', private.assert_reservation_phase3b_activation(),
  'phase_4a', private.assert_reservation_phase4a_read_contract(),
  'shadow_mismatch_count', (
    select count(*) from public.reservation_phase4a_read_mismatches
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
