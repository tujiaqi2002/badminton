-- Read-only verification for Reservation Phase 3B.2 atomic writer activation.
-- Output is deliberately limited to counts, state, and function fingerprints;
-- it never selects customer contact fields or free-text notes.

begin transaction read only;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $diagnostic$
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

  if v_version_count <> 47
     or v_latest_version <> '20260825074102'
     or v_version_fingerprint <> '10799dd49909e684c3eb035fa05fbf91' then
    raise exception
      'Phase 3B.2 migration history drift: count=% latest=% fingerprint=%',
      v_version_count,
      coalesce(v_latest_version, '<none>'),
      coalesce(v_version_fingerprint, '<none>');
  end if;

  if not exists (
    select 1
    from private.reservation_phase3b_activation_state as state
    where state.singleton and state.status = 'activated'
  ) then
    raise exception 'Phase 3B.2 writer activation is not active';
  end if;

  if to_regprocedure(
    'public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)'
  ) is null
     or has_function_privilege(
       'anon',
       'public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)',
       'execute'
     ) then
    raise exception 'Explicit-primary merge RPC grant drift';
  end if;
end;
$diagnostic$;

select jsonb_build_object(
  'status', 'phase_3b_atomic_writer_activation_verified',
  'activation', private.assert_reservation_phase3b_activation(),
  'activation_state', (
    select jsonb_build_object(
      'status', state.status,
      'migration_version', state.migration_version,
      'writer_count', state.writer_count,
      'baseline_fingerprint', state.baseline_fingerprint,
      'activated_at', state.activated_at
    )
    from private.reservation_phase3b_activation_state as state
    where state.singleton
  )
) as phase_3b_atomic_writer_activation_diagnostic;

rollback;
