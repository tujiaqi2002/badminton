-- Read-only verification for Reservation Phase 3B.1.
-- This script proves that the private kernel is installed but inactive. It
-- must never create memberships, invoke catch-up, or replace a public writer.

begin transaction read only;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $$
declare
  v_relation text;
  v_policy_count integer;
begin
  foreach v_relation in array array[
    'reservation_transitions',
    'reservation_transition_sources',
    'reservation_transition_targets',
    'reservation_transition_allocations',
    'reservation_transition_parties',
    'reservation_allocation_memberships'
  ]
  loop
    if not exists (
      select 1
      from pg_class as relation
      join pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_relation
        and relation.relkind = 'r'
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception
        'Phase 3B.1 relation is missing FORCE RLS: public.%',
        v_relation;
    end if;

    if has_table_privilege('anon', 'public.' || v_relation, 'select')
       or has_table_privilege('service_role', 'public.' || v_relation, 'select')
       or not has_table_privilege(
         'authenticated',
         'public.' || v_relation,
         'select'
       )
       or has_table_privilege(
         'authenticated',
         'public.' || v_relation,
         'insert,update,delete'
       ) then
      raise exception
        'Phase 3B.1 relation grants are incorrect: public.%',
        v_relation;
    end if;

    select count(*)::integer
      into v_policy_count
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = v_relation
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[];

    if v_policy_count <> 1 then
      raise exception
        'Phase 3B.1 relation must have exactly one manager SELECT policy: public.%',
        v_relation;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_signature text;
  v_routine record;
begin
  foreach v_signature in array array[
    'private.reservation_phase3b_request_fingerprint(jsonb)',
    'private.reservation_phase3b_claim_operation(text,text,text,uuid)',
    'private.reservation_phase3b_complete_operation(text,uuid,jsonb)',
    'private.reservation_phase3b_audit(text,text,text,text,uuid,jsonb)',
    'private.reservation_phase3b_lock_allocations(uuid[],uuid[])',
    'private.reservation_phase3b_attach_legacy_groups(uuid[],text,uuid)',
    'private.reservation_phase3b_reschedule_session(uuid,timestamp with time zone,timestamp with time zone,text,uuid)',
    'private.reservation_phase3b_set_booking_status(uuid[],public.booking_status,text,uuid)',
    'private.reservation_phase3b_update_booking_details(uuid[],text,text,text,text,smallint,text,uuid)',
    'private.reservation_phase3b_record_payment(uuid,uuid[],numeric[],text,text,timestamp with time zone,uuid,uuid)',
    'private.reservation_phase3b_refund_payment(uuid,bigint[],numeric[],text,timestamp with time zone,uuid)',
    'private.reservation_phase3b_apply_transition(text,uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],text,uuid)',
    'private.reservation_phase3b_reverse_transition(uuid,text,uuid)',
    'private.reservation_phase3b_effective_scope(uuid)',
    'private.assert_reservation_phase3b_writer_inventory()',
    'private.assert_reservation_phase3b_kernel_inactive()'
  ]
  loop
    select routine.prosecdef, routine.proconfig
      into v_routine
    from pg_proc as routine
    where routine.oid = to_regprocedure(v_signature);

    if not found
       or v_routine.prosecdef
       or v_routine.proconfig is null
       or not exists (
         select 1
         from unnest(v_routine.proconfig) as setting
         where setting in ('search_path=', 'search_path=""')
       ) then
      raise exception
        'Phase 3B.1 private helper is missing or unsafe: %',
        v_signature;
    end if;

    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute') then
      raise exception
        'Phase 3B.1 private helper has a client EXECUTE grant: %',
        v_signature;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc as routine
    join pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname like 'reservation_phase3b%'
  ) then
    raise exception 'Phase 3B.1 exposed a public mutation function';
  end if;

  if exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'public.bookings'::regclass
      and not trigger.tgisinternal
      and trigger.tgname like '%phase3b%'
  ) then
    raise exception 'Phase 3B.1 installed a booking dual-write trigger';
  end if;

  if exists (
    select 1
    from pg_publication_tables as publication_table
    where publication_table.schemaname = 'public'
      and publication_table.tablename in (
        'reservation_transitions',
        'reservation_transition_sources',
        'reservation_transition_targets',
        'reservation_transition_allocations',
        'reservation_transition_parties',
        'reservation_allocation_memberships'
      )
  ) then
    raise exception 'Phase 3B.1 unexpectedly enabled Realtime publication';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid =
      'public.payment_allocation_entries'::regclass
      and constraint_row.conname =
        'payment_allocation_entries_booking_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.bookings'::regclass
      and constraint_row.convalidated
      and cardinality(constraint_row.conkey) = 1
      and cardinality(constraint_row.confkey) = 1
  ) then
    raise exception 'Phase 3B.1 cross-origin payment FK is missing';
  end if;

  if exists (
    select 1
    from pg_constraint as foreign_key
    where foreign_key.contype = 'f'
      and foreign_key.conrelid in (
        'private.reservation_phase3b_operations'::regclass,
        'public.reservation_transitions'::regclass,
        'public.reservation_transition_sources'::regclass,
        'public.reservation_transition_targets'::regclass,
        'public.reservation_transition_allocations'::regclass,
        'public.reservation_transition_parties'::regclass,
        'public.reservation_allocation_memberships'::regclass
      )
      and not exists (
        select 1
        from pg_index as index_row
        where index_row.indrelid = foreign_key.conrelid
          and index_row.indisvalid
          and index_row.indisready
          and index_row.indnkeyatts >= cardinality(foreign_key.conkey)
          and (
            select count(distinct foreign_key_column.attnum)
            from unnest(foreign_key.conkey)
              as foreign_key_column(attnum)
            join unnest(index_row.indkey::smallint[]) with ordinality
              as index_column(attnum, position)
              on index_column.attnum = foreign_key_column.attnum
             and index_column.position <= cardinality(foreign_key.conkey)
          ) = cardinality(foreign_key.conkey)
      )
  ) then
    raise exception 'Phase 3B.1 has an unindexed foreign key';
  end if;
end;
$$;

select jsonb_build_object(
  'status', 'phase_3b_inactive_transaction_kernel_verified',
  'kernel', private.assert_reservation_phase3b_kernel_inactive(),
  'writer_inventory', private.assert_reservation_phase3b_writer_inventory(),
  'public_transition_table_count', 6,
  'client_mutation_function_count', 0,
  'booking_dual_write_trigger_count', 0,
  'realtime_publication_count', 0
) as phase_3b_inactive_transaction_kernel_diagnostic;

rollback;
