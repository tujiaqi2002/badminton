-- Read-only production/isolated verification for Reservation Phase 3A.
-- This script must never perform catch-up or activate dual-write.

begin transaction read only;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $$
declare
  v_count integer;
  v_security_invoker boolean;
  v_security_definer boolean;
  v_config text[];
begin
  select count(*)::integer,
         coalesce('security_invoker=true' = any(class.reloptions), false)
    into v_count, v_security_invoker
  from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'reservation_shadow_mismatches'
    and class.relkind = 'v'
  group by class.reloptions;

  if coalesce(v_count, 0) <> 1 or not coalesce(v_security_invoker, false) then
    raise exception 'Phase 3A shadow view is missing or not security_invoker';
  end if;

  select routine.prosecdef, routine.proconfig
    into v_security_definer, v_config
  from pg_proc as routine
  join pg_namespace as namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public'
    and routine.oid =
      'public.admin_get_reservation_shadow_status(integer)'::regprocedure;

  if v_security_definer is distinct from false
     or v_config is null
     or not exists (
       select 1
       from unnest(v_config) as setting
       where setting in ('search_path=', 'search_path=""')
     ) then
    raise exception 'Phase 3A public diagnostic function security is incorrect';
  end if;

  if has_table_privilege('anon', 'public.reservation_shadow_mismatches', 'select')
     or has_table_privilege('service_role', 'public.reservation_shadow_mismatches', 'select')
     or not has_table_privilege(
       'authenticated',
       'public.reservation_shadow_mismatches',
       'select'
     ) then
    raise exception 'Phase 3A shadow view grants are incorrect';
  end if;

  if has_function_privilege(
       'anon',
       'public.admin_get_reservation_shadow_status(integer)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.admin_get_reservation_shadow_status(integer)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.admin_get_reservation_shadow_status(integer)',
       'execute'
     ) then
    raise exception 'Phase 3A public diagnostic function grants are incorrect';
  end if;
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.reservation_phase3_uuid(text,text)',
    'private.reservation_legacy_timestamp_to_timestamptz(timestamp without time zone,text)',
    'private.preserve_booking_ownership_timestamp()',
    'private.reconcile_legacy_recurrence_series(uuid,uuid,text)',
    'private.reconcile_legacy_booking_group(uuid,uuid,text)',
    'private.catch_up_reservation_aggregates(uuid,integer)',
    'private.assert_reservation_shadow_clean()'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Phase 3A private function is missing: %', v_signature;
    end if;

    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'Phase 3A private function has a client grant: %', v_signature;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_count integer;
  v_writer_names text[];
  v_expected_writer_names constant text[] := array[
    'public.admin_cancel_booking',
    'public.admin_create_multi_booking',
    'public.admin_create_multi_booking_with_price',
    'public.admin_create_weekly_booking',
    'public.admin_create_weekly_booking_with_price',
    'public.admin_link_booking_groups',
    'public.admin_mark_booking_paid',
    'public.admin_move_booking_group',
    'public.admin_reschedule_booking',
    'public.admin_reschedule_booking_group',
    'public.admin_revert_audit_operation',
    'public.admin_swap_booking_schedule',
    'public.admin_undo_booking_change',
    'public.admin_unlink_booking_group',
    'public.admin_update_booking_details',
    'public.cancel_booking',
    'public.create_multi_booking'
  ]::text[];
begin
  with routines as materialized (
    select
      namespace.nspname || '.' || routine.proname as routine_name,
      pg_get_functiondef(routine.oid) as definition
    from pg_proc as routine
    join pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.prokind = 'f'
  ), writers as (
    select routine_name
    from routines
    where definition ~* 'insert[[:space:]]+into[[:space:]]+public\.bookings'
       or definition ~* 'update[[:space:]]+public\.bookings'
       or definition ~* 'delete[[:space:]]+from[[:space:]]+public\.bookings'
  )
  select count(*)::integer, array_agg(routine_name order by routine_name)
    into v_count, v_writer_names
  from writers;

  if v_count <> 17 or v_writer_names is distinct from v_expected_writer_names then
    raise exception
      'Phase 3A writer inventory drifted: expected %, found %',
      v_expected_writer_names,
      coalesce(v_writer_names, '{}'::text[]);
  end if;

  select count(*)::integer
    into v_count
  from pg_trigger as trigger
  join pg_class as relation on relation.oid = trigger.tgrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'bookings'
    and trigger.tgname = 'zz_bookings_preserve_ownership_timestamp'
    and not trigger.tgisinternal;

  if v_count <> 1 then
    raise exception 'Phase 3A ownership timestamp trigger is missing';
  end if;
end;
$$;

do $$
declare
  v_column_grant_count integer;
  v_column_privilege_count integer;
  v_policy_count integer;
  v_permissive_select_policy_count integer;
begin
  select count(*)::integer
    into v_column_grant_count
  from information_schema.column_privileges as privilege
  where privilege.table_schema = 'public'
    and privilege.table_name = 'venue_settings'
    and privilege.grantee = 'authenticated'
    and privilege.privilege_type = 'SELECT';

  if v_column_grant_count <> 1
     or not has_column_privilege(
       'authenticated',
       'public.venue_settings',
       'timezone',
       'select'
     ) then
    raise exception
      'Phase 3A venue timezone column grant is missing or too broad';
  end if;

  select count(*)::integer
    into v_column_privilege_count
  from information_schema.column_privileges as privilege
  where privilege.table_schema = 'public'
    and privilege.table_name = 'venue_settings'
    and privilege.grantee = 'authenticated';

  if v_column_privilege_count <> 1 then
    raise exception
      'Phase 3A venue_settings column privileges are too broad';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'select'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'insert'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'update'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'delete'
     ) then
    raise exception
      'Phase 3A venue_settings table privileges are too broad';
  end if;

  select count(*)::integer
    into v_policy_count
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'venue_settings'
    and policy.policyname =
      'managers read venue timezone for reservation shadow'
    and policy.cmd = 'SELECT'
    and policy.roles = array['authenticated']::name[];

  if v_policy_count <> 1 then
    raise exception 'Phase 3A venue timezone manager policy is missing';
  end if;

  if exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'venue_settings'
      and policy.policyname = 'venue_settings_rpc_only'
  ) then
    raise exception
      'Phase 3A redundant venue_settings_rpc_only policy still exists';
  end if;

  select count(*)::integer
    into v_permissive_select_policy_count
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'venue_settings'
    and policy.permissive = 'PERMISSIVE'
    and policy.roles @> array['authenticated']::name[]
    and policy.cmd in ('ALL', 'SELECT');

  if v_permissive_select_policy_count <> 1 then
    raise exception
      'Phase 3A venue timezone SELECT policies are not consolidated';
  end if;

  if exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'venue_settings'
      and policy.roles @> array['authenticated']::name[]
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception
      'Phase 3A venue_settings DML is not RLS default-denied';
  end if;
end;
$$;

do $$
declare
  v_court_slots_count integer;
  v_other_count integer;
begin
  select
    (count(*) filter (
      where publication.tablename = 'court_slots'
    ))::integer,
    (count(*) filter (
      where publication.tablename <> 'court_slots'
    ))::integer
    into v_court_slots_count, v_other_count
  from pg_publication_tables as publication
  where publication.pubname = 'supabase_realtime'
    and publication.schemaname in ('public', 'private');

  if v_court_slots_count <> 1 or v_other_count <> 0 then
    raise exception 'Phase 3A changed the Realtime publication boundary';
  end if;

  perform private.assert_reservation_shadow_clean();
end;
$$;

select jsonb_build_object(
  'result', 'phase_3a_reservation_compatibility_verified',
  'booking_rows', (select count(*) from public.bookings),
  'owned_booking_rows', (
    select count(*)
    from public.bookings
    where reservation_id is not null and session_id is not null
  ),
  'reservations', (select count(*) from public.reservations),
  'sessions', (select count(*) from public.reservation_sessions),
  'parties', (select count(*) from public.reservation_parties),
  'payments', (select count(*) from public.payments),
  'allocation_entries', (
    select count(*) from public.payment_allocation_entries
  ),
  'shadow_mismatch_rows', (
    select count(*) from public.reservation_shadow_mismatches
  )
) as phase_3a_verification;

commit;
