begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Phase 4B.3 extends only the already-installed manager Reservation search
-- response. It preserves the version 1 envelope and all legacy readers so the
-- frontend can remain production-default-legacy until a later cutover gate.
do $preflight$
declare
  v_version_count integer;
  v_latest_version text;
  v_activation jsonb;
  v_read_contract jsonb;
  v_search_oid regprocedure := to_regprocedure(
    'public.admin_search_reservations(date,date,text,text,text,integer,timestamp with time zone,uuid)'
  );
begin
  select count(*)::integer, max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 48 or v_latest_version <> '20260825091608' then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 4B.3 order search requires the verified 48-migration Phase 4A baseline; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<null>')
      );
  end if;

  if v_search_oid is null
     or to_regclass('public.reservation_admin_summary_v1') is null
     or to_regprocedure('private.assert_reservation_phase3b_activation()') is null
     or to_regprocedure('private.assert_reservation_phase4a_read_contract()') is null
  then
    raise exception using
      errcode = '55000',
      message = 'Phase 4B.3 order search requires the complete Phase 4A manager read contract';
  end if;

  if (
    select procedure.prosecdef
       or procedure.proconfig is distinct from array['search_path=""']::text[]
    from pg_catalog.pg_proc as procedure
    where procedure.oid = v_search_oid
  ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 4B.3 predecessor Reservation search security shape drifted';
  end if;

  if has_function_privilege('anon', v_search_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_search_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', v_search_oid, 'EXECUTE')
  then
    raise exception using
      errcode = '55000',
      message = 'Phase 4B.3 predecessor Reservation search grants drifted';
  end if;

  v_activation := private.assert_reservation_phase3b_activation();
  v_read_contract := private.assert_reservation_phase4a_read_contract();

  if v_activation ->> 'status' <> 'clean'
     or v_activation -> 'writer_inventory' ->> 'status' <> 'activated'
     or (v_activation ->> 'membership_count')::integer
       <> (v_activation ->> 'booking_count')::integer
     or (v_activation ->> 'shadow_mismatch_count')::integer <> 0
     or (v_activation ->> 'projection_mismatch_count')::integer <> 0
     or (v_activation ->> 'payment_mismatch_count')::integer <> 0
     or (v_activation ->> 'incomplete_operation_count')::integer <> 0
     or v_read_contract ->> 'status' <> 'phase_4a_manager_read_contract_verified'
  then
    raise exception using
      errcode = '55000',
      message = 'Phase 4B.3 predecessor Reservation contracts are not clean';
  end if;
end;
$preflight$;

create or replace function public.admin_search_reservations(
  p_start_date date,
  p_end_date date,
  p_query text default '',
  p_reservation_status text default 'not_cancelled',
  p_payment_status text default 'all',
  p_limit integer default 50,
  p_after_sort_at timestamptz default null,
  p_after_reservation_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_query text := nullif(pg_catalog.btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_today date;
  v_result jsonb;
begin
  if v_actor_id is null or not exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = v_actor_id
      and staff.role = 'admin'
  ) then
    raise exception 'Manager access required';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'Invalid Reservation search date range';
  end if;

  if p_end_date > p_start_date + 366 then
    raise exception using errcode = '22023', message = 'Reservation search range cannot exceed 367 days';
  end if;

  if (p_after_sort_at is null) <> (p_after_reservation_id is null) then
    raise exception using errcode = '22023', message = 'Invalid Reservation search cursor';
  end if;

  if coalesce(p_reservation_status, '') not in (
    'not_cancelled', 'all', 'held', 'confirmed', 'cancelled',
    'completed', 'expired', 'no_show', 'mixed'
  ) then
    raise exception using errcode = '22023', message = 'Invalid Reservation status filter';
  end if;

  if coalesce(p_payment_status, '') not in (
    'all', 'unpaid', 'partial', 'paid', 'refunded', 'no_charge', 'inconsistent'
  ) then
    raise exception using errcode = '22023', message = 'Invalid Reservation payment status filter';
  end if;

  select settings.timezone
    into v_timezone
  from public.venue_settings as settings
  limit 1;

  if v_timezone is null then
    raise exception using errcode = '55000', message = 'Venue timezone is not configured';
  end if;

  v_start_at := p_start_date::timestamp at time zone v_timezone;
  v_end_at := (p_end_date + 1)::timestamp at time zone v_timezone;
  v_today := pg_catalog.timezone(v_timezone, statement_timestamp())::date;

  with matched_scope as materialized (
    select
      membership.effective_reservation_id as reservation_id,
      min(session.starts_at) as matched_start_at,
      coalesce(
        sum(extract(epoch from (session.ends_at - session.starts_at)) / 60),
        0
      )::integer as matched_allocation_minutes,
      bool_or(
        pg_catalog.timezone(v_timezone, session.starts_at)::date = v_today
      ) as matched_today
    from public.reservation_allocation_memberships as membership
    join public.reservation_sessions as session
      on session.id = membership.effective_session_id
     and session.reservation_id = membership.effective_reservation_id
    where session.starts_at >= v_start_at
      and session.starts_at < v_end_at
    group by membership.effective_reservation_id
  ), party_scope as materialized (
    select
      party.reservation_id,
      count(*)::integer as party_count
    from public.reservation_parties as party
    group by party.reservation_id
  ), matching as materialized (
    select
      summary.*,
      party_scope.party_count,
      matched_scope.matched_start_at,
      matched_scope.matched_allocation_minutes,
      matched_scope.matched_today
    from matched_scope
    join public.reservation_admin_summary_v1 as summary
      on summary.reservation_id = matched_scope.reservation_id
    join party_scope
      on party_scope.reservation_id = summary.reservation_id
    where (
      p_reservation_status = 'all'
      or (p_reservation_status = 'not_cancelled'
        and summary.reservation_status <> 'cancelled')
      or summary.reservation_status = p_reservation_status
    )
      and (
        p_payment_status = 'all'
        or summary.payment_status = p_payment_status
      )
      and (
        v_query is null
        or summary.reservation_reference ilike '%' || v_query || '%'
        or summary.reference_number::text ilike '%' || v_query || '%'
        or exists (
          select 1
          from public.reservation_parties as search_party
          where search_party.reservation_id = summary.reservation_id
            and (
              search_party.display_name ilike '%' || v_query || '%'
              or search_party.email ilike '%' || v_query || '%'
              or search_party.phone ilike '%' || v_query || '%'
            )
        )
        or exists (
          select 1
          from public.reservation_allocation_memberships as search_membership
          join public.bookings as search_booking
            on search_booking.id = search_membership.booking_id
          join public.courts as search_court
            on search_court.id = search_booking.court_id
          join public.reservation_sessions as search_session
            on search_session.id = search_membership.effective_session_id
           and search_session.reservation_id = search_membership.effective_reservation_id
          where search_membership.effective_reservation_id = summary.reservation_id
            and (
              search_court.name_zh ilike '%' || v_query || '%'
              or search_court.name_en ilike '%' || v_query || '%'
              or search_court.description ilike '%' || v_query || '%'
              or search_session.notes ilike '%' || v_query || '%'
            )
        )
      )
  ), page_candidates as materialized (
    select matching.*
    from matching
    where p_after_sort_at is null
       or (matching.matched_start_at, matching.reservation_id)
         > (p_after_sort_at, p_after_reservation_id)
    order by matching.matched_start_at, matching.reservation_id
    limit v_limit + 1
  ), page_items as materialized (
    select page_candidate.*
    from page_candidates as page_candidate
    order by page_candidate.matched_start_at, page_candidate.reservation_id
    limit v_limit
  ), page_cursor as (
    select page_item.matched_start_at, page_item.reservation_id
    from page_items as page_item
    order by page_item.matched_start_at desc, page_item.reservation_id desc
    limit 1
  )
  select jsonb_build_object(
    'schema_version', 1,
    'generated_at', statement_timestamp(),
    'limit', v_limit,
    'items', coalesce(
      (
        select jsonb_agg(
          to_jsonb(page_item) - 'matched_today'
          order by page_item.matched_start_at, page_item.reservation_id
        )
        from page_items as page_item
      ),
      '[]'::jsonb
    ),
    'has_more', (select count(*) > v_limit from page_candidates),
    'next_cursor', case
      when (select count(*) > v_limit from page_candidates) then (
        select jsonb_build_object(
          'sort_at', page_cursor.matched_start_at,
          'reservation_id', page_cursor.reservation_id
        )
        from page_cursor
      )
      else null
    end,
    'summary', jsonb_build_object(
      'results', (select count(*)::integer from matching),
      'total_minutes', coalesce((
        select sum(matching.matched_allocation_minutes)::integer from matching
      ), 0),
      'primary_contacts', (
        select count(distinct matching.primary_party_id)::integer from matching
      ),
      'today', (
        select count(*) filter (where matching.matched_today)::integer from matching
      )
    )
  ) into v_result;

  return v_result;
end;
$function$;

comment on function public.admin_search_reservations(
  date, date, text, text, text, integer, timestamptz, uuid
) is
  'Phase 4B.3 manager Reservation search: all-Party matching, Party count, venue-local bounds, and (matched_start_at, reservation_id) keyset pagination.';

-- CREATE OR REPLACE preserves the existing ACL, but reassert the exact Data
-- API boundary so a predecessor grant drift cannot survive this migration.
revoke all on function public.admin_search_reservations(
  date, date, text, text, text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_reservations(
  date, date, text, text, text, integer, timestamptz, uuid
) to authenticated;

do $postflight$
declare
  v_search_oid regprocedure := to_regprocedure(
    'public.admin_search_reservations(date,date,text,text,text,integer,timestamp with time zone,uuid)'
  );
  v_definition text;
  v_activation jsonb;
  v_read_contract jsonb;
begin
  if v_search_oid is null then
    raise exception using errcode = '55000', message = 'Phase 4B.3 Reservation search is missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_search_oid::oid)
    into v_definition;

  if v_definition not like '%party_scope.party_count%'
     or v_definition not like '%public.reservation_parties as search_party%'
     or v_definition not like '%(matching.matched_start_at, matching.reservation_id)%'
  then
    raise exception using errcode = '55000', message = 'Phase 4B.3 Reservation search definition is incomplete';
  end if;

  if (
    select procedure.prosecdef
       or procedure.proconfig is distinct from array['search_path=""']::text[]
    from pg_catalog.pg_proc as procedure
    where procedure.oid = v_search_oid
  ) then
    raise exception using errcode = '55000', message = 'Phase 4B.3 Reservation search security shape drifted';
  end if;

  if has_function_privilege('anon', v_search_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_search_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', v_search_oid, 'EXECUTE')
  then
    raise exception using errcode = '55000', message = 'Phase 4B.3 Reservation search grants drifted';
  end if;

  v_activation := private.assert_reservation_phase3b_activation();
  v_read_contract := private.assert_reservation_phase4a_read_contract();

  if v_activation ->> 'status' <> 'clean'
     or v_activation -> 'writer_inventory' ->> 'status' <> 'activated'
     or (v_activation ->> 'membership_count')::integer
       <> (v_activation ->> 'booking_count')::integer
     or (v_activation ->> 'shadow_mismatch_count')::integer <> 0
     or (v_activation ->> 'projection_mismatch_count')::integer <> 0
     or (v_activation ->> 'payment_mismatch_count')::integer <> 0
     or (v_activation ->> 'incomplete_operation_count')::integer <> 0
     or v_read_contract ->> 'status' <> 'phase_4a_manager_read_contract_verified'
  then
    raise exception using errcode = '55000', message = 'Phase 4B.3 changed a predecessor contract';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
