begin;

-- Hosted migration version: 20260827084719.
-- Reservation Phase 4C.1 installs one explicit, manager-only profile mutation
-- boundary. It does not replace the booking compatibility writer and remains
-- default-off in the frontend until a separate production cutover gate.

do $preflight$
declare
  v_version_count integer;
  v_latest_version text;
  v_phase3b jsonb;
  v_phase4a jsonb;
  v_operation_constraint text;
begin
  select count(*), max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 49
     or v_latest_version <> '20260826181644' then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 4C.1 requires the exact 49-migration Phase 4B.3 baseline; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<none>')
      );
  end if;

  if to_regprocedure('private.assert_reservation_phase3b_activation()') is null
     or to_regprocedure('private.assert_reservation_phase4a_read_contract()') is null
     or to_regprocedure(
       'private.reservation_phase3b_claim_operation(text,text,text,uuid)'
     ) is null
     or to_regprocedure(
       'private.reservation_phase3b_complete_operation(text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'private.reservation_phase3b_lock_allocations(uuid[],uuid[])'
     ) is null
     or to_regprocedure('private.reservation_phase3b_request_fingerprint(jsonb)') is null
     or to_regprocedure('private.require_manager()') is null then
    raise exception using
      errcode = '55000',
      message = 'Phase 4C.1 requires the active Phase 3B transaction kernel';
  end if;

  v_phase3b := private.assert_reservation_phase3b_activation();
  v_phase4a := private.assert_reservation_phase4a_read_contract();
  if v_phase3b ->> 'status' <> 'clean'
     or v_phase4a ->> 'status' <> 'phase_4a_manager_read_contract_verified' then
    raise exception using
      errcode = '55000',
      message = 'Phase 4C.1 preflight found Reservation contract drift';
  end if;

  if to_regprocedure(
    'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)'
  ) is not null
     or to_regprocedure(
       'private.reservation_phase4c1_update_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone,uuid)'
     ) is not null
     or to_regprocedure('private.assert_reservation_phase4c1_profile_mutation()') is not null then
    raise exception using
      errcode = '55000',
      message = 'Phase 4C.1 mutation objects already exist';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
    into v_operation_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'private.reservation_phase3b_operations'::regclass
    and constraint_row.conname = 'reservation_phase3b_operations_type_check';

  if v_operation_constraint is null
     or position(
       '^[a-z][a-z0-9_.]{0,99}$'
       in v_operation_constraint
     ) = 0 then
    raise exception using
      errcode = '55000',
      message = 'Phase 4C.1 operation-type constraint drifted';
  end if;
end;
$preflight$;

create function private.reservation_phase4c1_record_audit(
  p_operation_id text,
  p_scope text,
  p_reservation_id uuid,
  p_target_id uuid,
  p_actor_id uuid,
  p_status text,
  p_changed_fields text[],
  p_reason text,
  p_allocation_count integer default 0,
  p_projection_count integer default 0
)
returns text
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event_type text := p_scope || '.profile_' ||
    case when p_status = 'updated' then 'updated' else 'unchanged' end;
begin
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
    v_event_type,
    p_scope,
    p_target_id::text,
    p_actor_id,
    'manager',
    'reservation_phase4c1_profile',
    coalesce(p_changed_fields, '{}'::text[]),
    jsonb_build_object(
      'schema_version', 3,
      'mutation_contract_version', 1,
      'reservation_id', p_reservation_id,
      'reason', p_reason,
      'allocation_count', greatest(coalesce(p_allocation_count, 0), 0),
      'projection_count', greatest(coalesce(p_projection_count, 0), 0)
    )
  );

  return v_event_type;
end;
$function$;

create function private.reservation_phase4c1_update_profile(
  p_scope text,
  p_reservation_id uuid,
  p_target_id uuid,
  p_patch jsonb,
  p_reason text,
  p_idempotency_key text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_operation_id text;
  v_request jsonb;
  v_claim record;
  v_patch_keys text[];
  v_changed_fields text[] := '{}'::text[];
  v_status text;
  v_event_type text;
  v_completed_at timestamptz;
  v_result jsonb;
  v_target_updated_at timestamptz;
  v_notes text;
  v_party_size smallint;
  v_display_name text;
  v_email text;
  v_phone text;
  v_reservation public.reservations%rowtype;
  v_session public.reservation_sessions%rowtype;
  v_party public.reservation_parties%rowtype;
  v_booking_ids uuid[];
  v_projection_session_ids uuid[];
  v_lineage_party_ids uuid[];
  v_legacy_group_id uuid;
  v_allocation_count integer := 0;
  v_projection_count integer := 0;
begin
  if p_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'reservation_profile_manager_required';
  end if;

  if p_scope not in ('reservation', 'session', 'party') then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_invalid_scope';
  end if;
  if p_reservation_id is null or p_target_id is null then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_target_required';
  end if;
  if p_scope = 'reservation' and p_target_id <> p_reservation_id then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_target_scope_mismatch';
  end if;
  if p_reason not in (
    'manager_edit',
    'customer_request',
    'correction',
    'operational_update'
  ) then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_invalid_reason';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$' then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_invalid_idempotency_key';
  end if;
  if p_expected_updated_at is null then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_expected_version_required';
  end if;
  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or octet_length(p_patch::text) > 10000 then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_invalid_patch';
  end if;

  select array_agg(key order by key)
    into v_patch_keys
  from jsonb_object_keys(p_patch) as key;

  if coalesce(cardinality(v_patch_keys), 0) = 0
     or exists (
       select 1
       from unnest(v_patch_keys) as patch_key
       where (p_scope = 'reservation' and patch_key <> 'notes')
          or (p_scope = 'session' and patch_key not in ('notes', 'party_size'))
          or (p_scope = 'party' and patch_key not in ('display_name', 'email', 'phone'))
     ) then
    raise exception using
      errcode = '22023',
      message = 'reservation_profile_patch_scope_mismatch';
  end if;

  if p_patch ? 'notes' then
    if jsonb_typeof(p_patch -> 'notes') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_notes';
    end if;
    v_notes := nullif(trim(p_patch ->> 'notes'), '');
    if (p_scope = 'reservation' and length(coalesce(v_notes, '')) > 4000)
       or (p_scope = 'session' and length(coalesce(v_notes, '')) > 2000) then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_notes';
    end if;
  end if;

  if p_patch ? 'party_size' then
    if jsonb_typeof(p_patch -> 'party_size') <> 'number'
       or (p_patch ->> 'party_size') !~ '^[0-9]+$'
       or (p_patch ->> 'party_size')::integer not between 1 and 8 then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_party_size';
    end if;
    v_party_size := (p_patch ->> 'party_size')::smallint;
  end if;

  if p_patch ? 'display_name' then
    if jsonb_typeof(p_patch -> 'display_name') <> 'string' then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_display_name';
    end if;
    v_display_name := nullif(trim(p_patch ->> 'display_name'), '');
    if v_display_name is null or length(v_display_name) > 200 then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_display_name';
    end if;
  end if;

  if p_patch ? 'email' then
    if jsonb_typeof(p_patch -> 'email') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_email';
    end if;
    v_email := lower(nullif(trim(p_patch ->> 'email'), ''));
    if length(coalesce(v_email, '')) > 320
       or (v_email is not null and position('@' in v_email) < 2) then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_email';
    end if;
  end if;

  if p_patch ? 'phone' then
    if jsonb_typeof(p_patch -> 'phone') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_phone';
    end if;
    v_phone := nullif(trim(p_patch ->> 'phone'), '');
    if length(coalesce(v_phone, '')) > 40 then
      raise exception using errcode = '22023', message = 'reservation_profile_invalid_phone';
    end if;
  end if;

  v_operation_id := 'phase4c1:' || p_idempotency_key;
  v_request := jsonb_build_object(
    'scope', p_scope,
    'reservation_id', p_reservation_id,
    'target_id', p_target_id,
    'reason', p_reason,
    'expected_updated_at', p_expected_updated_at,
    'patch_keys', to_jsonb(v_patch_keys),
    'notes_hash', case when p_patch ? 'notes'
      then md5(coalesce(to_jsonb(v_notes)::text, 'null')) else null end,
    'party_size', case when p_patch ? 'party_size' then v_party_size else null end,
    'display_name_hash', case when p_patch ? 'display_name'
      then md5(to_jsonb(v_display_name)::text) else null end,
    'email_hash', case when p_patch ? 'email'
      then md5(coalesce(to_jsonb(v_email)::text, 'null')) else null end,
    'phone_hash', case when p_patch ? 'phone'
      then md5(coalesce(to_jsonb(v_phone)::text, 'null')) else null end
  );

  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    v_operation_id,
    'update_profile',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return v_claim.result_payload;
  end if;

  if p_scope = 'reservation' then
    select reservation.*
      into v_reservation
    from public.reservations as reservation
    where reservation.id = p_reservation_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
    end if;
    if v_reservation.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = '40001', message = 'reservation_profile_stale_target';
    end if;

    if v_reservation.notes is distinct from v_notes then
      v_changed_fields := array_append(v_changed_fields, 'notes');
      update public.reservations as reservation
         set notes = v_notes,
             updated_at = statement_timestamp()
       where reservation.id = p_reservation_id;
    end if;

    select reservation.updated_at
      into v_target_updated_at
    from public.reservations as reservation
    where reservation.id = p_reservation_id;

  elsif p_scope = 'session' then
    select array_agg(membership.booking_id order by membership.booking_id)
      into v_booking_ids
    from public.reservation_allocation_memberships as membership
    where membership.effective_reservation_id = p_reservation_id
      and membership.effective_session_id = p_target_id;

    if coalesce(cardinality(v_booking_ids), 0) = 0 then
      raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
    end if;

    perform private.reservation_phase3b_lock_allocations(
      v_booking_ids,
      array[p_reservation_id]::uuid[]
    );

    if exists (
      select 1
      from public.reservation_allocation_memberships as membership
      where membership.booking_id = any(v_booking_ids)
        and (
          membership.effective_reservation_id <> p_reservation_id
          or membership.effective_session_id <> p_target_id
        )
    ) then
      raise exception using errcode = '40001', message = 'reservation_profile_stale_target';
    end if;

    select session.*
      into v_session
    from public.reservation_sessions as session
    where session.id = p_target_id
      and session.reservation_id = p_reservation_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
    end if;
    if v_session.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = '40001', message = 'reservation_profile_stale_target';
    end if;

    if p_patch ? 'notes' and v_session.notes is distinct from v_notes then
      v_changed_fields := array_append(v_changed_fields, 'notes');
    end if;
    if p_patch ? 'party_size' and v_session.party_size is distinct from v_party_size then
      v_changed_fields := array_append(v_changed_fields, 'party_size');
    end if;

    if cardinality(v_changed_fields) > 0 then
      select array_agg(distinct booking.session_id order by booking.session_id)
        into v_projection_session_ids
      from public.bookings as booking
      where booking.id = any(v_booking_ids);

      v_allocation_count := cardinality(v_booking_ids);
      v_projection_count := coalesce(cardinality(v_projection_session_ids), 0);

      update public.reservation_sessions as session
         set notes = case when p_patch ? 'notes' then v_notes else session.notes end,
             party_size = case when p_patch ? 'party_size' then v_party_size else session.party_size end,
             updated_at = statement_timestamp()
       where session.id = p_target_id
          or session.id = any(coalesce(v_projection_session_ids, '{}'::uuid[]));

      perform pg_catalog.set_config('app.audit_operation_id', v_operation_id, true);
      perform pg_catalog.set_config('app.audit_event_type', 'booking.details_updated', true);
      perform pg_catalog.set_config('app.audit_source', 'reservation_phase4c1_profile', true);

      update public.bookings as booking
         set customer_notes = case when p_patch ? 'notes' then v_notes else booking.customer_notes end,
             party_size = case when p_patch ? 'party_size' then v_party_size else booking.party_size end,
             updated_at = statement_timestamp()
       where booking.id = any(v_booking_ids);
    end if;

    select session.updated_at
      into v_target_updated_at
    from public.reservation_sessions as session
    where session.id = p_target_id
      and session.reservation_id = p_reservation_id;

  else
    select party.legacy_booking_group_id
      into v_legacy_group_id
    from public.reservation_parties as party
    where party.id = p_target_id
      and party.reservation_id = p_reservation_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
    end if;

    if v_legacy_group_id is not null then
      if exists (
        select 1
        from public.bookings as booking
        join public.reservation_allocation_memberships as membership
          on membership.booking_id = booking.id
        where booking.booking_group_id = v_legacy_group_id
          and membership.effective_reservation_id <> p_reservation_id
      ) then
        raise exception using
          errcode = '23514',
          message = 'reservation_profile_party_lineage_split';
      end if;

      select array_agg(booking.id order by booking.id)
        into v_booking_ids
      from public.bookings as booking
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = booking.id
      where booking.booking_group_id = v_legacy_group_id
        and membership.effective_reservation_id = p_reservation_id;
    end if;

    if coalesce(cardinality(v_booking_ids), 0) > 0 then
      perform private.reservation_phase3b_lock_allocations(
        v_booking_ids,
        array[p_reservation_id]::uuid[]
      );
    else
      perform 1
      from public.reservations as reservation
      where reservation.id = p_reservation_id
      for update;
      if not found then
        raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
      end if;
    end if;

    select party.*
      into v_party
    from public.reservation_parties as party
    where party.id = p_target_id
      and party.reservation_id = p_reservation_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
    end if;
    if v_party.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = '40001', message = 'reservation_profile_stale_target';
    end if;
    if v_party.legacy_booking_group_id is distinct from v_legacy_group_id then
      raise exception using errcode = '40001', message = 'reservation_profile_stale_target';
    end if;

    if p_patch ? 'display_name' and v_party.display_name is distinct from v_display_name then
      v_changed_fields := array_append(v_changed_fields, 'display_name');
    end if;
    if p_patch ? 'email' and v_party.email is distinct from v_email then
      v_changed_fields := array_append(v_changed_fields, 'email');
    end if;
    if p_patch ? 'phone' and v_party.phone is distinct from v_phone then
      v_changed_fields := array_append(v_changed_fields, 'phone');
    end if;

    if cardinality(v_changed_fields) > 0 then
      if v_legacy_group_id is null then
        v_lineage_party_ids := array[p_target_id]::uuid[];
      else
        select array_agg(party.id order by party.id)
          into v_lineage_party_ids
        from public.reservation_parties as party
        where party.legacy_booking_group_id = v_legacy_group_id;

        perform 1
        from public.reservation_parties as party
        where party.id = any(v_lineage_party_ids)
        order by party.id
        for update;
      end if;

      update public.reservation_parties as party
         set display_name = case when p_patch ? 'display_name' then v_display_name else party.display_name end,
             email = case when p_patch ? 'email' then v_email else party.email end,
             phone = case when p_patch ? 'phone' then v_phone else party.phone end,
             updated_at = statement_timestamp()
       where party.id = any(v_lineage_party_ids);

      if coalesce(cardinality(v_booking_ids), 0) > 0 then
        perform pg_catalog.set_config('app.audit_operation_id', v_operation_id, true);
        perform pg_catalog.set_config('app.audit_event_type', 'booking.details_updated', true);
        perform pg_catalog.set_config('app.audit_source', 'reservation_phase4c1_profile', true);

        update public.bookings as booking
           set customer_name = case when p_patch ? 'display_name' then v_display_name else booking.customer_name end,
               customer_email = case when p_patch ? 'email' then v_email else booking.customer_email end,
               customer_phone = case when p_patch ? 'phone' then v_phone else booking.customer_phone end,
               updated_at = statement_timestamp()
         where booking.id = any(v_booking_ids);
      end if;

      v_allocation_count := coalesce(cardinality(v_booking_ids), 0);
      v_projection_count := coalesce(cardinality(v_lineage_party_ids), 0);
    end if;

    select party.updated_at
      into v_target_updated_at
    from public.reservation_parties as party
    where party.id = p_target_id
      and party.reservation_id = p_reservation_id;
  end if;

  v_status := case when cardinality(v_changed_fields) > 0 then 'updated' else 'unchanged' end;
  v_event_type := private.reservation_phase4c1_record_audit(
    v_operation_id,
    p_scope,
    p_reservation_id,
    p_target_id,
    p_actor_id,
    v_status,
    v_changed_fields,
    p_reason,
    v_allocation_count,
    v_projection_count
  );
  v_completed_at := statement_timestamp();
  v_result := jsonb_build_object(
    'schema_version', 1,
    'contract', 'admin_reservation_profile_mutation',
    'operation_id', v_operation_id,
    'operation_type', 'update_profile',
    'scope', p_scope,
    'reservation_id', p_reservation_id,
    'target_id', p_target_id,
    'status', v_status,
    'changed_fields', to_jsonb(v_changed_fields),
    'reason', p_reason,
    'audit_event_type', v_event_type,
    'target_updated_at', v_target_updated_at,
    'completed_at', v_completed_at
  );

  perform private.reservation_phase3b_complete_operation(
    v_operation_id,
    p_target_id,
    v_result
  );
  return v_result;
end;
$function$;

create function public.admin_update_reservation_profile(
  p_scope text,
  p_reservation_id uuid,
  p_target_id uuid,
  p_patch jsonb,
  p_reason text,
  p_idempotency_key text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
begin
  -- Authorization intentionally precedes every argument and target check.
  v_actor_id := private.require_manager();

  return private.reservation_phase4c1_update_profile(
    p_scope,
    p_reservation_id,
    p_target_id,
    p_patch,
    p_reason,
    p_idempotency_key,
    p_expected_updated_at,
    v_actor_id
  );
end;
$function$;

comment on function public.admin_update_reservation_profile(
  text, uuid, uuid, jsonb, text, text, timestamptz
) is
  'Phase 4C.1 v1 manager-only canonical Reservation/Session/Party profile mutation. Explicit scope, target, reason, idempotency, stale-write guard and PII-free result envelope.';

revoke all on function private.reservation_phase4c1_record_audit(
  text, text, uuid, uuid, uuid, text, text[], text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.reservation_phase4c1_update_profile(
  text, uuid, uuid, jsonb, text, text, timestamptz, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.admin_update_reservation_profile(
  text, uuid, uuid, jsonb, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_reservation_profile(
  text, uuid, uuid, jsonb, text, text, timestamptz
) to authenticated;

create function private.assert_reservation_phase4c1_profile_mutation()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_phase3b jsonb;
  v_phase4a jsonb;
  v_function record;
  v_operation_constraint text;
  v_private_client_execute_count integer;
begin
  v_phase3b := private.assert_reservation_phase3b_activation();
  v_phase4a := private.assert_reservation_phase4a_read_contract();
  if v_phase3b ->> 'status' <> 'clean'
     or v_phase4a ->> 'status' <> 'phase_4a_manager_read_contract_verified' then
    raise exception using errcode = '55000', message = 'Phase 4C.1 predecessor drift';
  end if;

  select
    procedure.prosecdef as security_definer,
    procedure.provolatile as volatility,
    procedure.proconfig as configuration,
    procedure.proacl as acl
    into v_function
  from pg_catalog.pg_proc as procedure
  where procedure.oid = (
    'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)'
  )::regprocedure;

  if not found
     or not v_function.security_definer
     or v_function.volatility <> 'v'
     or v_function.configuration is distinct from array['search_path=""']::text[]
     or not has_function_privilege(
       'authenticated',
       'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)',
       'EXECUTE'
     ) then
    raise exception using errcode = '55000', message = 'Phase 4C.1 public RPC security drift';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
    into v_operation_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'private.reservation_phase3b_operations'::regclass
    and constraint_row.conname = 'reservation_phase3b_operations_type_check';
  if v_operation_constraint is null
     or position(
       '^[a-z][a-z0-9_.]{0,99}$'
       in v_operation_constraint
     ) = 0 then
    raise exception using errcode = '55000', message = 'Phase 4C.1 operation contract drift';
  end if;

  select count(*)::integer
    into v_private_client_execute_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname like 'reservation_phase4c1_%'
    and (
      has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      or has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    );
  if v_private_client_execute_count <> 0 then
    raise exception using errcode = '55000', message = 'Phase 4C.1 private helper exposure drift';
  end if;

  return jsonb_build_object(
    'status', 'phase_4c1_profile_mutation_verified',
    'schema_version', 1,
    'public_rpc_count', 1,
    'private_client_execute_count', v_private_client_execute_count,
    'phase3b', v_phase3b,
    'phase4a', v_phase4a
  );
end;
$function$;

revoke all on function private.assert_reservation_phase4c1_profile_mutation()
  from public, anon, authenticated, service_role;

select private.assert_reservation_phase4c1_profile_mutation();

commit;
