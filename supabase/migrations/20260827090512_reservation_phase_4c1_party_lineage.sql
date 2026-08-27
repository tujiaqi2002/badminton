begin;

-- Hosted migration version: 20260827090512.
-- Phase 4C.1 follow-up: an explicitly selected Party may be a transition copy
-- created by a merge or split. Resolve the immutable Party lineage in both
-- directions before updating the canonical copies and legacy projections.

do $preflight$
declare
  v_version_count integer;
  v_latest_version text;
  v_phase4c1 jsonb;
  v_public_definition text;
begin
  select count(*)::integer, max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 50
     or v_latest_version <> '20260827084719' then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 4C.1 Party-lineage hardening requires 50 migrations ending at 20260827084719; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<none>')
      );
  end if;

  v_phase4c1 := private.assert_reservation_phase4c1_profile_mutation();
  if v_phase4c1 ->> 'status' <> 'phase_4c1_profile_mutation_verified' then
    raise exception using errcode = '55000', message = 'Phase 4C.1 predecessor drift';
  end if;

  if to_regprocedure(
       'private.reservation_phase4c1_party_lineage_scope(uuid)'
     ) is not null
     or to_regprocedure(
       'private.reservation_phase4c1_update_party_profile(uuid,uuid,jsonb,text,text,timestamp with time zone,uuid)'
     ) is not null then
    raise exception using errcode = '55000', message = 'Phase 4C.1 Party-lineage helpers already exist';
  end if;

  select pg_get_functiondef(procedure.oid)
    into v_public_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = (
    'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)'
  )::regprocedure;

  if v_public_definition is null
     or position('reservation_phase4c1_update_profile' in v_public_definition) = 0
     or position('reservation_phase4c1_update_party_profile' in v_public_definition) > 0 then
    raise exception using errcode = '55000', message = 'Phase 4C.1 public wrapper drift';
  end if;
end;
$preflight$;

create function private.reservation_phase4c1_party_lineage_scope(
  p_target_id uuid
)
returns table (
  party_ids uuid[],
  reservation_ids uuid[],
  legacy_group_ids uuid[],
  booking_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with recursive
  lineage_edges(source_party_id, target_party_id) as materialized (
    select lineage.source_party_id, lineage.target_party_id
    from public.reservation_transition_parties as lineage
    union all
    select lineage.target_party_id, lineage.source_party_id
    from public.reservation_transition_parties as lineage
  ),
  lineage(party_id) as (
    select p_target_id
    union
    select edge.target_party_id
    from lineage
    join lineage_edges as edge on edge.source_party_id = lineage.party_id
  ),
  lineage_parties as materialized (
    select party.id, party.reservation_id, party.legacy_booking_group_id
    from lineage
    join public.reservation_parties as party on party.id = lineage.party_id
  ),
  legacy_groups as materialized (
    select distinct party.legacy_booking_group_id as booking_group_id
    from lineage_parties as party
    where party.legacy_booking_group_id is not null
  )
  select
    coalesce((
      select array_agg(party.id order by party.id)
      from lineage_parties as party
    ), '{}'::uuid[]) as party_ids,
    coalesce((
      select array_agg(distinct party.reservation_id order by party.reservation_id)
      from lineage_parties as party
    ), '{}'::uuid[]) as reservation_ids,
    coalesce((
      select array_agg(group_row.booking_group_id order by group_row.booking_group_id)
      from legacy_groups as group_row
    ), '{}'::uuid[]) as legacy_group_ids,
    coalesce((
      select array_agg(booking.id order by booking.id)
      from public.bookings as booking
      where booking.booking_group_id in (
        select group_row.booking_group_id from legacy_groups as group_row
      )
    ), '{}'::uuid[]) as booking_ids;
$function$;

create function private.reservation_phase4c1_update_party_profile(
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
  v_scope record;
  v_locked_scope record;
  v_patch_keys text[];
  v_changed_fields text[] := '{}'::text[];
  v_status text;
  v_event_type text;
  v_completed_at timestamptz;
  v_result jsonb;
  v_target_updated_at timestamptz;
  v_display_name text;
  v_email text;
  v_phone text;
  v_party public.reservation_parties%rowtype;
begin
  if p_actor_id is null then
    raise exception using errcode = '42501', message = 'reservation_profile_manager_required';
  end if;
  if p_reservation_id is null or p_target_id is null then
    raise exception using errcode = '22023', message = 'reservation_profile_target_required';
  end if;
  if p_reason not in (
    'manager_edit',
    'customer_request',
    'correction',
    'operational_update'
  ) then
    raise exception using errcode = '22023', message = 'reservation_profile_invalid_reason';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$' then
    raise exception using errcode = '22023', message = 'reservation_profile_invalid_idempotency_key';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'reservation_profile_expected_version_required';
  end if;
  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or octet_length(p_patch::text) > 10000 then
    raise exception using errcode = '22023', message = 'reservation_profile_invalid_patch';
  end if;

  select array_agg(key order by key)
    into v_patch_keys
  from jsonb_object_keys(p_patch) as key;

  if coalesce(cardinality(v_patch_keys), 0) = 0
     or exists (
       select 1
       from unnest(v_patch_keys) as patch_key
       where patch_key not in ('display_name', 'email', 'phone')
     ) then
    raise exception using errcode = '22023', message = 'reservation_profile_patch_scope_mismatch';
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
    'scope', 'party',
    'reservation_id', p_reservation_id,
    'target_id', p_target_id,
    'reason', p_reason,
    'expected_updated_at', p_expected_updated_at,
    'patch_keys', to_jsonb(v_patch_keys),
    'notes_hash', null,
    'party_size', null,
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

  select * into v_scope
  from private.reservation_phase4c1_party_lineage_scope(p_target_id);

  if coalesce(cardinality(v_scope.party_ids), 0) = 0
     or not (p_target_id = any(v_scope.party_ids))
     or not (p_reservation_id = any(v_scope.reservation_ids)) then
    raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
  end if;

  if cardinality(v_scope.booking_ids) > 0 then
    perform private.reservation_phase3b_lock_allocations(
      v_scope.booking_ids,
      v_scope.reservation_ids
    );
  else
    perform reservation.id
    from public.reservations as reservation
    where reservation.id = any(v_scope.reservation_ids)
    order by reservation.id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'reservation_profile_target_not_found';
    end if;
  end if;

  select * into v_locked_scope
  from private.reservation_phase4c1_party_lineage_scope(p_target_id);

  if v_locked_scope.party_ids is distinct from v_scope.party_ids
     or v_locked_scope.reservation_ids is distinct from v_scope.reservation_ids
     or v_locked_scope.legacy_group_ids is distinct from v_scope.legacy_group_ids
     or v_locked_scope.booking_ids is distinct from v_scope.booking_ids then
    raise exception using errcode = '40001', message = 'reservation_profile_stale_target';
  end if;

  if exists (
    select 1
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_scope.booking_ids)
      and membership.effective_reservation_id <> p_reservation_id
  ) then
    raise exception using errcode = '23514', message = 'reservation_profile_party_lineage_split';
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
    update public.reservation_parties as party
       set display_name = case when p_patch ? 'display_name' then v_display_name else party.display_name end,
           email = case when p_patch ? 'email' then v_email else party.email end,
           phone = case when p_patch ? 'phone' then v_phone else party.phone end,
           updated_at = statement_timestamp()
     where party.id = any(v_scope.party_ids);

    if cardinality(v_scope.booking_ids) > 0 then
      perform pg_catalog.set_config('app.audit_operation_id', v_operation_id, true);
      perform pg_catalog.set_config('app.audit_event_type', 'booking.details_updated', true);
      perform pg_catalog.set_config('app.audit_source', 'reservation_phase4c1_profile', true);

      update public.bookings as booking
         set customer_name = case when p_patch ? 'display_name' then v_display_name else booking.customer_name end,
             customer_email = case when p_patch ? 'email' then v_email else booking.customer_email end,
             customer_phone = case when p_patch ? 'phone' then v_phone else booking.customer_phone end,
             updated_at = statement_timestamp()
       where booking.id = any(v_scope.booking_ids);
    end if;
  end if;

  select party.updated_at
    into v_target_updated_at
  from public.reservation_parties as party
  where party.id = p_target_id
    and party.reservation_id = p_reservation_id;

  v_status := case when cardinality(v_changed_fields) > 0 then 'updated' else 'unchanged' end;
  v_event_type := private.reservation_phase4c1_record_audit(
    v_operation_id,
    'party',
    p_reservation_id,
    p_target_id,
    p_actor_id,
    v_status,
    v_changed_fields,
    p_reason,
    cardinality(v_scope.booking_ids),
    cardinality(v_scope.party_ids)
  );
  v_completed_at := statement_timestamp();
  v_result := jsonb_build_object(
    'schema_version', 1,
    'contract', 'admin_reservation_profile_mutation',
    'operation_id', v_operation_id,
    'operation_type', 'update_profile',
    'scope', 'party',
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

create or replace function public.admin_update_reservation_profile(
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
  begin
    v_actor_id := private.require_manager();
  exception when others then
    if sqlerrm = 'Manager access required' then
      raise exception using
        errcode = '42501',
        message = 'reservation_profile_manager_required';
    end if;
    raise;
  end;

  if p_scope = 'party' then
    return private.reservation_phase4c1_update_party_profile(
      p_reservation_id,
      p_target_id,
      p_patch,
      p_reason,
      p_idempotency_key,
      p_expected_updated_at,
      v_actor_id
    );
  end if;

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

revoke all on function private.reservation_phase4c1_party_lineage_scope(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.reservation_phase4c1_update_party_profile(
  uuid, uuid, jsonb, text, text, timestamptz, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.admin_update_reservation_profile(
  text, uuid, uuid, jsonb, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_reservation_profile(
  text, uuid, uuid, jsonb, text, text, timestamptz
) to authenticated;

create or replace function private.assert_reservation_phase4c1_profile_mutation()
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
  v_public_definition text;
  v_operation_constraint text;
  v_private_function_count integer;
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
    pg_get_functiondef(procedure.oid) as definition
    into v_function
  from pg_catalog.pg_proc as procedure
  where procedure.oid = (
    'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)'
  )::regprocedure;

  if not found
     or not v_function.security_definer
     or v_function.volatility <> 'v'
     or v_function.configuration is distinct from array['search_path=""']::text[]
     or position('reservation_phase4c1_update_party_profile' in v_function.definition) = 0
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
     or position('^[a-z][a-z0-9_.]{0,99}$' in v_operation_constraint) = 0 then
    raise exception using errcode = '55000', message = 'Phase 4C.1 operation contract drift';
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
    raise exception using errcode = '55000', message = 'Phase 4C.1 private function inventory drift';
  end if;

  select count(*)::integer
    into v_private_client_execute_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname in (
      'reservation_phase4c1_record_audit',
      'reservation_phase4c1_update_profile',
      'reservation_phase4c1_party_lineage_scope',
      'reservation_phase4c1_update_party_profile',
      'assert_reservation_phase4c1_profile_mutation'
    )
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
    'party_lineage_mode', 'bidirectional_transition_graph',
    'public_rpc_count', 1,
    'private_function_count', v_private_function_count,
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
