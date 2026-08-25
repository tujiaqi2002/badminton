begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Phase 4A.1 is an additive manager-read foundation. It does not replace any
-- legacy reader or writer, publish a new Realtime table, or modify customer
-- data. The protected-branch integration applies migrations immediately after
-- merge, so fail closed unless the verified Phase 3B.2 production boundary is
-- the exact predecessor.
do $preflight$
declare
  v_version_count integer;
  v_latest_version text;
  v_activation jsonb;
begin
  select count(*)::integer, max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 47 or v_latest_version <> '20260825074102' then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 4A read contract requires the verified 47-migration Phase 3B.2 baseline; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<null>')
      );
  end if;

  if to_regprocedure('private.assert_reservation_phase3b_activation()') is null then
    raise exception using
      errcode = '55000',
      message = 'Phase 4A read contract requires the active Phase 3B.2 assertion';
  end if;

  v_activation := private.assert_reservation_phase3b_activation();
  if v_activation ->> 'status' <> 'clean'
     or v_activation -> 'writer_inventory' ->> 'status' <> 'activated'
     or (v_activation -> 'writer_inventory' ->> 'public_entry_count')::integer <> 17
     or (v_activation -> 'writer_inventory' ->> 'public_direct_booking_writer_count')::integer <> 0
     or (v_activation -> 'writer_inventory' ->> 'private_legacy_writer_count')::integer <> 17
     or (v_activation -> 'writer_inventory' ->> 'wrapper_count')::integer <> 3
     or (v_activation ->> 'membership_count')::integer
       <> (v_activation ->> 'booking_count')::integer
     or (v_activation ->> 'shadow_mismatch_count')::integer <> 0
     or (v_activation ->> 'projection_mismatch_count')::integer <> 0
     or (v_activation ->> 'payment_mismatch_count')::integer <> 0
     or (v_activation ->> 'incomplete_operation_count')::integer <> 0
     or (v_activation ->> 'rls_force_table_count')::integer <> 7
     or v_activation -> 'realtime_tables' <> '["public.court_slots"]'::jsonb
  then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.2 activation is not verified';
  end if;

  if to_regclass('public.reservation_admin_summary_v1') is not null
     or to_regclass('public.reservation_admin_allocations_v1') is not null
     or to_regclass('public.reservation_phase4a_read_mismatches') is not null
     or to_regprocedure(
       'public.admin_list_reservation_allocations(timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,uuid)'
     ) is not null
     or to_regprocedure(
       'public.admin_search_reservations(date,date,text,text,text,integer,timestamp with time zone,uuid)'
     ) is not null
     or to_regprocedure('public.admin_get_reservation_detail(uuid)') is not null
     or to_regprocedure('public.admin_get_reservation_read_shadow_status(integer)') is not null
  then
    raise exception using
      errcode = '55000',
      message = 'Phase 4A read contract objects already exist';
  end if;
end;
$preflight$;

-- Window-first schedule and date-range search start from canonical Session
-- timestamps. Existing (reservation_id, starts_at, id) remains the efficient
-- detail path; this index serves global manager windows and keyset ordering.
create index reservation_sessions_admin_window_idx
  on public.reservation_sessions (starts_at, id, reservation_id, ends_at);

-- One row per current/effective commercial Reservation. All relationship and
-- payment facts are derived from current allocation membership, never from the
-- immutable origin Reservation stored on bookings.
create view public.reservation_admin_summary_v1
with (security_invoker = true)
as
with actor as (
  select (
    current_user = 'postgres'
    or exists (
      select 1
      from public.staff_members as staff
      where staff.user_id = (select auth.uid())
        and staff.role = 'admin'
    )
  ) as allowed
), allocation_scope as (
  select
    membership.effective_reservation_id as reservation_id,
    count(*)::integer as allocation_count,
    count(distinct membership.effective_session_id)::integer as session_count,
    min(session.starts_at) as first_session_starts_at,
    max(session.ends_at) as last_session_ends_at,
    min(session.starts_at) filter (
      where session.ends_at >= statement_timestamp()
    ) as next_session_starts_at,
    coalesce(
      sum(extract(epoch from (session.ends_at - session.starts_at)) / 60),
      0
    )::integer as allocation_minutes,
    coalesce(sum(booking.total_amount), 0)::numeric(12,2) as total_amount,
    array_agg(distinct booking.court_id order by booking.court_id) as court_ids,
    count(distinct booking.booking_group_id)::integer as legacy_group_count,
    count(distinct booking.booking_link_id) filter (
      where booking.booking_link_id is not null
    )::integer as legacy_link_count,
    bool_or(
      nullif(pg_catalog.btrim(coalesce(session.notes, '')), '') is not null
      or nullif(pg_catalog.btrim(coalesce(booking.customer_notes, '')), '') is not null
    ) as has_notes,
    case
      when bool_and(booking.status::text = 'cancelled') then 'cancelled'
      when bool_or(booking.status::text = 'held') then 'held'
      when bool_or(booking.status::text = 'confirmed') then 'confirmed'
      when bool_and(booking.status::text in ('cancelled', 'completed'))
        and bool_or(booking.status::text = 'completed') then 'completed'
      when bool_and(booking.status::text in ('cancelled', 'no_show'))
        and bool_or(booking.status::text = 'no_show') then 'no_show'
      when bool_and(booking.status::text in ('cancelled', 'expired'))
        and bool_or(booking.status::text = 'expired') then 'expired'
      else 'mixed'
    end as reservation_status
  from public.reservation_allocation_memberships as membership
  join public.bookings as booking
    on booking.id = membership.booking_id
  join public.reservation_sessions as session
    on session.id = membership.effective_session_id
   and session.reservation_id = membership.effective_reservation_id
  cross join actor
  where actor.allowed
  group by membership.effective_reservation_id
), allocation_statuses as (
  select
    statuses.reservation_id,
    jsonb_object_agg(statuses.status, statuses.status_count order by statuses.status)
      as allocation_status_counts
  from (
    select
      membership.effective_reservation_id as reservation_id,
      booking.status::text as status,
      count(*)::integer as status_count
    from public.reservation_allocation_memberships as membership
    join public.bookings as booking on booking.id = membership.booking_id
    cross join actor
    where actor.allowed
    group by membership.effective_reservation_id, booking.status::text
  ) as statuses
  group by statuses.reservation_id
), primary_contacts as (
  select
    role.reservation_id,
    party.id as primary_party_id,
    party.display_name as primary_contact_name,
    party.email as primary_contact_email,
    party.phone as primary_contact_phone
  from public.reservation_party_roles as role
  join public.reservation_parties as party
    on party.id = role.party_id
   and party.reservation_id = role.reservation_id
  cross join actor
  where actor.allowed
    and role.role = 'primary_contact'
), ledger as (
  select
    membership.effective_reservation_id as reservation_id,
    count(distinct payment.id) filter (
      where payment.status = 'succeeded'
    )::integer as succeeded_payment_count,
    coalesce(sum(entry.amount) filter (
      where payment.status = 'succeeded'
    ), 0)::numeric(12,2) as net_paid_amount,
    coalesce(sum(entry.amount) filter (
      where payment.status = 'succeeded' and entry.amount > 0
    ), 0)::numeric(12,2) as paid_amount,
    coalesce(-sum(entry.amount) filter (
      where payment.status = 'succeeded' and entry.amount < 0
    ), 0)::numeric(12,2) as refunded_amount
  from public.reservation_allocation_memberships as membership
  left join public.payment_allocation_entries as entry
    on entry.booking_id = membership.booking_id
  left join public.payments as payment on payment.id = entry.payment_id
  cross join actor
  where actor.allowed
  group by membership.effective_reservation_id
), source_counts as (
  select
    source.reservation_id,
    count(*)::integer as source_lineage_count
  from public.reservation_legacy_sources as source
  cross join actor
  where actor.allowed
  group by source.reservation_id
), transition_ids as (
  select source.reservation_id, source.transition_id
  from public.reservation_transition_sources as source
  union
  select target.reservation_id, target.transition_id
  from public.reservation_transition_targets as target
  union
  select allocation.from_reservation_id, allocation.transition_id
  from public.reservation_transition_allocations as allocation
  union
  select allocation.to_reservation_id, allocation.transition_id
  from public.reservation_transition_allocations as allocation
), transition_counts as (
  select
    transition_id.reservation_id,
    count(distinct transition_id.transition_id)::integer as transition_count,
    max(transition.sequence) as latest_transition_sequence
  from transition_ids as transition_id
  join public.reservation_transitions as transition
    on transition.id = transition_id.transition_id
  cross join actor
  where actor.allowed
  group by transition_id.reservation_id
)
select
  1::integer as schema_version,
  reservation.id as reservation_id,
  reservation.reference_number,
  'R-' || pg_catalog.lpad(reservation.reference_number::text, 6, '0')
    as reservation_reference,
  reservation.currency,
  reservation.payment_plan,
  reservation.source,
  reservation.created_at,
  reservation.updated_at,
  allocation_scope.reservation_status,
  allocation_statuses.allocation_status_counts,
  allocation_scope.first_session_starts_at,
  allocation_scope.last_session_ends_at,
  allocation_scope.next_session_starts_at,
  allocation_scope.session_count,
  allocation_scope.allocation_count,
  allocation_scope.allocation_minutes,
  allocation_scope.court_ids,
  allocation_scope.has_notes,
  allocation_scope.legacy_group_count,
  allocation_scope.legacy_link_count,
  coalesce(source_counts.source_lineage_count, 0)::integer as source_lineage_count,
  coalesce(transition_counts.transition_count, 0)::integer as transition_count,
  transition_counts.latest_transition_sequence,
  primary_contacts.primary_party_id,
  primary_contacts.primary_contact_name,
  primary_contacts.primary_contact_email,
  primary_contacts.primary_contact_phone,
  allocation_scope.total_amount,
  coalesce(ledger.paid_amount, 0)::numeric(12,2) as paid_amount,
  coalesce(ledger.refunded_amount, 0)::numeric(12,2) as refunded_amount,
  coalesce(ledger.net_paid_amount, 0)::numeric(12,2) as net_paid_amount,
  greatest(
    allocation_scope.total_amount - coalesce(ledger.net_paid_amount, 0),
    0::numeric
  )::numeric(12,2) as outstanding_amount,
  coalesce(ledger.succeeded_payment_count, 0)::integer as succeeded_payment_count,
  case
    when allocation_scope.total_amount = 0
      and coalesce(ledger.net_paid_amount, 0) = 0 then 'no_charge'
    when coalesce(ledger.net_paid_amount, 0) < 0 then 'inconsistent'
    when coalesce(ledger.net_paid_amount, 0) = 0
      and coalesce(ledger.refunded_amount, 0) > 0 then 'refunded'
    when coalesce(ledger.net_paid_amount, 0) = 0 then 'unpaid'
    when coalesce(ledger.net_paid_amount, 0) < allocation_scope.total_amount then 'partial'
    when coalesce(ledger.net_paid_amount, 0) = allocation_scope.total_amount then 'paid'
    else 'inconsistent'
  end as payment_status,
  reservation.recurrence_series_id,
  reservation.recurrence_sequence,
  recurrence.timezone as recurrence_timezone,
  recurrence.frequency as recurrence_frequency,
  recurrence.interval_count as recurrence_interval_count,
  recurrence.day_of_week as recurrence_day_of_week,
  recurrence.starts_on as recurrence_starts_on,
  recurrence.ends_on as recurrence_ends_on,
  recurrence.occurrence_count as recurrence_occurrence_count
from allocation_scope
join public.reservations as reservation
  on reservation.id = allocation_scope.reservation_id
join allocation_statuses
  on allocation_statuses.reservation_id = reservation.id
left join primary_contacts
  on primary_contacts.reservation_id = reservation.id
left join ledger on ledger.reservation_id = reservation.id
left join source_counts on source_counts.reservation_id = reservation.id
left join transition_counts on transition_counts.reservation_id = reservation.id
left join public.recurrence_series as recurrence
  on recurrence.id = reservation.recurrence_series_id;

comment on view public.reservation_admin_summary_v1 is
  'Phase 4A v1 manager-only effective Reservation summary. Amounts are derived from current allocation membership and the append-only succeeded ledger.';

-- One row per current Court allocation for manager schedule rendering. The
-- first projection Session is recovered from append-only assignment history so
-- a later move cannot erase its origin; the current effective Session remains
-- the schedule authority.
create view public.reservation_admin_allocations_v1
with (security_invoker = true)
as
with actor as (
  select (
    current_user = 'postgres'
    or exists (
      select 1
      from public.staff_members as staff
      where staff.user_id = (select auth.uid())
        and staff.role = 'admin'
    )
  ) as allowed
), first_assignment as (
  select distinct on (assignment.booking_id)
    assignment.booking_id,
    assignment.from_projection_session_id as origin_session_id
  from public.reservation_session_assignments as assignment
  cross join actor
  where actor.allowed
  order by assignment.booking_id, assignment.created_at, assignment.id
), session_counts as (
  select
    membership.effective_session_id,
    membership.effective_reservation_id,
    count(*)::integer as session_allocation_count
  from public.reservation_allocation_memberships as membership
  cross join actor
  where actor.allowed
  group by
    membership.effective_session_id,
    membership.effective_reservation_id
)
select
  1::integer as schema_version,
  booking.id as allocation_id,
  membership.origin_reservation_id,
  coalesce(first_assignment.origin_session_id, booking.session_id) as origin_session_id,
  booking.reservation_id as projection_reservation_id,
  booking.session_id as projection_session_id,
  membership.effective_reservation_id,
  membership.effective_session_id,
  membership.version as membership_version,
  membership.last_transition_id,
  court.id as court_id,
  court.name_zh as court_name_zh,
  court.name_en as court_name_en,
  court.sort_order as court_sort_order,
  session.starts_at,
  session.ends_at,
  session.party_size,
  booking.status::text as allocation_status,
  booking.total_amount::numeric(12,2) as allocation_amount,
  booking.currency,
  booking.system_calculated_amount::numeric(12,2) as system_calculated_amount,
  booking.price_source,
  booking.price_override_amount::numeric(12,2) as price_override_amount,
  nullif(pg_catalog.btrim(coalesce(session.notes, booking.customer_notes, '')), '')
    is not null as has_notes,
  booking.booking_group_id as legacy_source_group_id,
  booking.booking_link_id as legacy_source_link_id,
  session_counts.session_allocation_count,
  summary.reservation_reference,
  summary.reference_number,
  summary.reservation_status,
  summary.payment_status,
  summary.payment_plan,
  summary.total_amount as reservation_total_amount,
  summary.paid_amount as reservation_paid_amount,
  summary.refunded_amount as reservation_refunded_amount,
  summary.net_paid_amount as reservation_net_paid_amount,
  summary.outstanding_amount as reservation_outstanding_amount,
  summary.session_count as reservation_session_count,
  summary.allocation_count as reservation_allocation_count,
  summary.primary_party_id,
  summary.primary_contact_name,
  summary.primary_contact_email,
  summary.primary_contact_phone,
  summary.recurrence_series_id,
  summary.recurrence_sequence,
  summary.transition_count,
  summary.source_lineage_count,
  booking.created_at as allocation_created_at,
  booking.updated_at as allocation_updated_at
from public.reservation_allocation_memberships as membership
join public.bookings as booking on booking.id = membership.booking_id
join public.reservation_sessions as session
  on session.id = membership.effective_session_id
 and session.reservation_id = membership.effective_reservation_id
join public.courts as court on court.id = booking.court_id
join public.reservation_admin_summary_v1 as summary
  on summary.reservation_id = membership.effective_reservation_id
join session_counts
  on session_counts.effective_session_id = membership.effective_session_id
 and session_counts.effective_reservation_id = membership.effective_reservation_id
left join first_assignment on first_assignment.booking_id = booking.id
cross join actor
where actor.allowed;

comment on view public.reservation_admin_allocations_v1 is
  'Phase 4A v1 manager-only schedule projection. One row is one physical Court allocation; effective membership defines current Reservation and Session ownership.';

create function public.admin_list_reservation_allocations(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_limit integer default 500,
  p_after_starts_at timestamptz default null,
  p_after_allocation_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
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

  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception using errcode = '22023', message = 'Invalid schedule window';
  end if;

  if p_end_at > p_start_at + interval '31 days' then
    raise exception using errcode = '22023', message = 'Schedule window cannot exceed 31 days';
  end if;

  if (p_after_starts_at is null) <> (p_after_allocation_id is null) then
    raise exception using errcode = '22023', message = 'Invalid schedule cursor';
  end if;

  with page_candidates as materialized (
    select allocation.*
    from public.reservation_admin_allocations_v1 as allocation
    where allocation.starts_at < p_end_at
      and allocation.ends_at > p_start_at
      and (
        p_after_starts_at is null
        or (allocation.starts_at, allocation.allocation_id)
          > (p_after_starts_at, p_after_allocation_id)
      )
    order by allocation.starts_at, allocation.allocation_id
    limit v_limit + 1
  ), page_items as materialized (
    select page_candidate.*
    from page_candidates as page_candidate
    order by page_candidate.starts_at, page_candidate.allocation_id
    limit v_limit
  ), page_cursor as (
    select page_item.starts_at, page_item.allocation_id
    from page_items as page_item
    order by page_item.starts_at desc, page_item.allocation_id desc
    limit 1
  )
  select jsonb_build_object(
    'schema_version', 1,
    'generated_at', statement_timestamp(),
    'limit', v_limit,
    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(page_item)
          order by page_item.starts_at, page_item.allocation_id)
        from page_items as page_item
      ),
      '[]'::jsonb
    ),
    'has_more', (select count(*) > v_limit from page_candidates),
    'next_cursor', case
      when (select count(*) > v_limit from page_candidates) then (
        select jsonb_build_object(
          'starts_at', page_cursor.starts_at,
          'allocation_id', page_cursor.allocation_id
        )
        from page_cursor
      )
      else null
    end
  ) into v_result;

  return v_result;
end;
$function$;

comment on function public.admin_list_reservation_allocations(
  timestamptz, timestamptz, integer, timestamptz, uuid
) is
  'Phase 4A v1 manager schedule read with (starts_at, allocation_id) keyset pagination.';

create function public.admin_search_reservations(
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
  ), matching as materialized (
    select
      summary.*,
      matched_scope.matched_start_at,
      matched_scope.matched_allocation_minutes,
      matched_scope.matched_today
    from matched_scope
    join public.reservation_admin_summary_v1 as summary
      on summary.reservation_id = matched_scope.reservation_id
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
        or summary.primary_contact_name ilike '%' || v_query || '%'
        or summary.primary_contact_email ilike '%' || v_query || '%'
        or summary.primary_contact_phone ilike '%' || v_query || '%'
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
  'Phase 4A v1 manager Reservation search with venue-local date bounds and (matched_start_at, reservation_id) keyset pagination.';

create function public.admin_get_reservation_detail(p_reservation_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_summary jsonb;
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

  if p_reservation_id is null then
    raise exception using errcode = '22023', message = 'Reservation ID is required';
  end if;

  select to_jsonb(summary)
    into v_summary
  from public.reservation_admin_summary_v1 as summary
  where summary.reservation_id = p_reservation_id;

  if v_summary is null then
    raise exception using errcode = 'P0002', message = 'Current Reservation not found';
  end if;

  with party_roles as (
    select
      role.party_id,
      jsonb_agg(role.role order by role.role) as roles
    from public.reservation_party_roles as role
    where role.reservation_id = p_reservation_id
    group by role.party_id
  ), parties as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'party_id', party.id,
          'party_type', party.party_type,
          'display_name', party.display_name,
          'email', party.email,
          'phone', party.phone,
          'source', party.source,
          'roles', coalesce(party_roles.roles, '[]'::jsonb),
          'created_at', party.created_at,
          'updated_at', party.updated_at
        ) order by party.created_at, party.id
      ),
      '[]'::jsonb
    ) as rows
    from public.reservation_parties as party
    left join party_roles on party_roles.party_id = party.id
    where party.reservation_id = p_reservation_id
  ), current_sessions as (
    select distinct
      session.id,
      session.starts_at,
      session.ends_at,
      session.party_size,
      session.notes,
      session.source,
      session.created_at,
      session.updated_at
    from public.reservation_allocation_memberships as membership
    join public.reservation_sessions as session
      on session.id = membership.effective_session_id
     and session.reservation_id = membership.effective_reservation_id
    where membership.effective_reservation_id = p_reservation_id
  ), session_allocations as (
    select
      allocation.effective_session_id,
      jsonb_agg(
        jsonb_build_object(
          'allocation_id', allocation.allocation_id,
          'origin_reservation_id', allocation.origin_reservation_id,
          'origin_session_id', allocation.origin_session_id,
          'projection_reservation_id', allocation.projection_reservation_id,
          'projection_session_id', allocation.projection_session_id,
          'court_id', allocation.court_id,
          'court_name_zh', allocation.court_name_zh,
          'court_name_en', allocation.court_name_en,
          'court_sort_order', allocation.court_sort_order,
          'status', allocation.allocation_status,
          'amount', allocation.allocation_amount,
          'currency', allocation.currency,
          'system_calculated_amount', allocation.system_calculated_amount,
          'price_source', allocation.price_source,
          'price_override_amount', allocation.price_override_amount,
          'legacy_source_group_id', allocation.legacy_source_group_id,
          'legacy_source_link_id', allocation.legacy_source_link_id,
          'membership_version', allocation.membership_version,
          'last_transition_id', allocation.last_transition_id,
          'created_at', allocation.allocation_created_at,
          'updated_at', allocation.allocation_updated_at
        ) order by allocation.court_sort_order, allocation.allocation_id
      ) as allocations
    from public.reservation_admin_allocations_v1 as allocation
    where allocation.effective_reservation_id = p_reservation_id
    group by allocation.effective_session_id
  ), sessions as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'session_id', current_session.id,
          'starts_at', current_session.starts_at,
          'ends_at', current_session.ends_at,
          'party_size', current_session.party_size,
          'notes', current_session.notes,
          'source', current_session.source,
          'allocations', coalesce(session_allocations.allocations, '[]'::jsonb),
          'created_at', current_session.created_at,
          'updated_at', current_session.updated_at
        ) order by current_session.starts_at, current_session.id
      ),
      '[]'::jsonb
    ) as rows
    from current_sessions as current_session
    left join session_allocations
      on session_allocations.effective_session_id = current_session.id
  ), relevant_payment_ids as (
    select distinct entry.payment_id
    from public.payment_allocation_entries as entry
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = entry.booking_id
    where membership.effective_reservation_id = p_reservation_id
    union
    select payment.id
    from public.payments as payment
    where payment.reservation_id = p_reservation_id
  ), payment_current_allocations as (
    select
      entry.payment_id,
      coalesce(sum(entry.amount), 0)::numeric(12,2) as current_reservation_amount
    from public.payment_allocation_entries as entry
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = entry.booking_id
    where membership.effective_reservation_id = p_reservation_id
    group by entry.payment_id
  ), payments as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_id', payment.id,
          'original_reservation_id', payment.reservation_id,
          'payer_party_id', payment.payer_party_id,
          'kind', payment.kind,
          'amount', payment.amount,
          'currency', payment.currency,
          'method', payment.method,
          'status', payment.status,
          'provider', payment.provider,
          'source', payment.source,
          'reverses_payment_id', payment.reverses_payment_id,
          'occurred_at', payment.occurred_at,
          'current_reservation_amount',
            coalesce(payment_current_allocations.current_reservation_amount, 0),
          'created_at', payment.created_at,
          'updated_at', payment.updated_at
        ) order by coalesce(payment.occurred_at, payment.created_at), payment.id
      ),
      '[]'::jsonb
    ) as rows
    from relevant_payment_ids
    join public.payments as payment on payment.id = relevant_payment_ids.payment_id
    left join payment_current_allocations
      on payment_current_allocations.payment_id = payment.id
  ), payment_entries as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entry_id', entry.id,
          'payment_id', entry.payment_id,
          'allocation_id', entry.booking_id,
          'original_payment_reservation_id', entry.reservation_id,
          'entry_kind', entry.entry_kind,
          'amount', entry.amount,
          'reverses_entry_id', entry.reverses_entry_id,
          'created_at', entry.created_at
        ) order by entry.created_at, entry.id
      ),
      '[]'::jsonb
    ) as rows
    from public.payment_allocation_entries as entry
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = entry.booking_id
    where membership.effective_reservation_id = p_reservation_id
  ), payment_shares as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'share_id', share.id,
          'party_id', share.party_id,
          'share_type', share.share_type,
          'target_amount', share.target_amount,
          'target_percentage', share.target_percentage,
          'created_at', share.created_at,
          'updated_at', share.updated_at
        ) order by share.created_at, share.id
      ),
      '[]'::jsonb
    ) as rows
    from public.reservation_payment_shares as share
    where share.reservation_id = p_reservation_id
  ), sources as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_type', source.source_type,
          'source_id', source.source_id,
          'created_at', source.created_at
        ) order by source.source_type, source.source_id
      ),
      '[]'::jsonb
    ) as rows
    from public.reservation_legacy_sources as source
    where source.reservation_id = p_reservation_id
  ), relevant_transition_ids as (
    select source.transition_id
    from public.reservation_transition_sources as source
    where source.reservation_id = p_reservation_id
    union
    select target.transition_id
    from public.reservation_transition_targets as target
    where target.reservation_id = p_reservation_id
    union
    select allocation.transition_id
    from public.reservation_transition_allocations as allocation
    where allocation.from_reservation_id = p_reservation_id
       or allocation.to_reservation_id = p_reservation_id
  ), transitions as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'transition_id', transition.id,
          'sequence', transition.sequence,
          'type', transition.transition_type,
          'reverses_transition_id', transition.reverses_transition_id,
          'created_at', transition.created_at
        ) order by transition.sequence, transition.id
      ),
      '[]'::jsonb
    ) as rows
    from relevant_transition_ids
    join public.reservation_transitions as transition
      on transition.id = relevant_transition_ids.transition_id
  ), assignment_summary as (
    select jsonb_build_object(
      'assignment_count', count(*)::integer,
      'allocation_count', count(distinct assignment.booking_id)::integer,
      'latest_assignment_at', max(assignment.created_at)
    ) as value
    from public.reservation_session_assignments as assignment
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = assignment.booking_id
    where membership.effective_reservation_id = p_reservation_id
  )
  select jsonb_build_object(
    'schema_version', 1,
    'generated_at', statement_timestamp(),
    'reservation', v_summary || jsonb_build_object(
      'notes', reservation.notes
    ),
    'parties', parties.rows,
    'sessions', sessions.rows,
    'payment_shares', payment_shares.rows,
    'payments', payments.rows,
    'payment_allocation_entries', payment_entries.rows,
    'source_lineage', sources.rows,
    'transitions', transitions.rows,
    'session_assignment_summary', assignment_summary.value
  ) into v_result
  from public.reservations as reservation
  cross join parties
  cross join sessions
  cross join payment_shares
  cross join payments
  cross join payment_entries
  cross join sources
  cross join transitions
  cross join assignment_summary
  where reservation.id = p_reservation_id;

  return v_result;
end;
$function$;

comment on function public.admin_get_reservation_detail(uuid) is
  'Phase 4A v1 manager detail snapshot. Excludes provider references, idempotency keys, raw provider payloads, and unnecessary Auth identifiers.';

-- PII-free contract diagnostic. Samples contain only internal IDs, codes,
-- counts, timestamps, statuses, and amounts.
create view public.reservation_phase4a_read_mismatches
with (security_invoker = true)
as
with actor as (
  select (
    current_user = 'postgres'
    or exists (
      select 1
      from public.staff_members as staff
      where staff.user_id = (select auth.uid())
        and staff.role = 'admin'
    )
  ) as allowed
), allocation_rows as (
  select allocation.allocation_id, count(*)::integer as row_count
  from public.reservation_admin_allocations_v1 as allocation
  group by allocation.allocation_id
), expected_summary as (
  select
    membership.effective_reservation_id as reservation_id,
    count(*)::integer as allocation_count,
    count(distinct membership.effective_session_id)::integer as session_count,
    min(session.starts_at) as first_session_starts_at,
    max(session.ends_at) as last_session_ends_at,
    coalesce(sum(booking.total_amount), 0)::numeric(12,2) as total_amount,
    case
      when bool_and(booking.status::text = 'cancelled') then 'cancelled'
      when bool_or(booking.status::text = 'held') then 'held'
      when bool_or(booking.status::text = 'confirmed') then 'confirmed'
      when bool_and(booking.status::text in ('cancelled', 'completed'))
        and bool_or(booking.status::text = 'completed') then 'completed'
      when bool_and(booking.status::text in ('cancelled', 'no_show'))
        and bool_or(booking.status::text = 'no_show') then 'no_show'
      when bool_and(booking.status::text in ('cancelled', 'expired'))
        and bool_or(booking.status::text = 'expired') then 'expired'
      else 'mixed'
    end as reservation_status
  from public.reservation_allocation_memberships as membership
  join public.bookings as booking on booking.id = membership.booking_id
  join public.reservation_sessions as session
    on session.id = membership.effective_session_id
   and session.reservation_id = membership.effective_reservation_id
  cross join actor
  where actor.allowed
  group by membership.effective_reservation_id
), expected_primary as (
  select
    reservation.id as reservation_id,
    count(role.party_id)::integer as primary_count,
    (array_agg(role.party_id order by role.party_id)
      filter (where role.party_id is not null))[1] as primary_party_id
  from public.reservations as reservation
  left join public.reservation_party_roles as role
    on role.reservation_id = reservation.id
   and role.role = 'primary_contact'
  cross join actor
  where actor.allowed
  group by reservation.id
), expected_ledger as (
  select
    membership.effective_reservation_id as reservation_id,
    coalesce(sum(entry.amount) filter (
      where payment.status = 'succeeded'
    ), 0)::numeric(12,2) as net_paid_amount,
    coalesce(sum(entry.amount) filter (
      where payment.status = 'succeeded' and entry.amount > 0
    ), 0)::numeric(12,2) as paid_amount,
    coalesce(-sum(entry.amount) filter (
      where payment.status = 'succeeded' and entry.amount < 0
    ), 0)::numeric(12,2) as refunded_amount
  from public.reservation_allocation_memberships as membership
  left join public.payment_allocation_entries as entry
    on entry.booking_id = membership.booking_id
  left join public.payments as payment on payment.id = entry.payment_id
  cross join actor
  where actor.allowed
  group by membership.effective_reservation_id
), actual_summary as (
  select summary.*
  from public.reservation_admin_summary_v1 as summary
)
select
  'allocation_unowned'::text as mismatch_code,
  booking.reservation_id,
  booking.session_id,
  booking.id as allocation_id,
  jsonb_build_object('membership_count', 0) as details
from public.bookings as booking
cross join actor
left join public.reservation_allocation_memberships as membership
  on membership.booking_id = booking.id
where actor.allowed
  and membership.booking_id is null

union all

select
  'allocation_read_row_count_mismatch',
  membership.effective_reservation_id,
  membership.effective_session_id,
  membership.booking_id,
  jsonb_build_object(
    'expected_count', 1,
    'actual_count', coalesce(allocation_rows.row_count, 0)
  )
from public.reservation_allocation_memberships as membership
cross join actor
left join allocation_rows on allocation_rows.allocation_id = membership.booking_id
where actor.allowed
  and coalesce(allocation_rows.row_count, 0) <> 1

union all

select
  'allocation_projection_mismatch',
  membership.effective_reservation_id,
  membership.effective_session_id,
  booking.id,
  jsonb_build_object(
    'reservation_matches',
      allocation.effective_reservation_id is not distinct from membership.effective_reservation_id,
    'session_matches',
      allocation.effective_session_id is not distinct from membership.effective_session_id,
    'court_matches', allocation.court_id is not distinct from booking.court_id,
    'starts_at_matches', allocation.starts_at is not distinct from session.starts_at,
    'ends_at_matches', allocation.ends_at is not distinct from session.ends_at,
    'status_matches', allocation.allocation_status is not distinct from booking.status::text,
    'amount_matches', allocation.allocation_amount is not distinct from booking.total_amount
  )
from public.reservation_allocation_memberships as membership
join public.bookings as booking on booking.id = membership.booking_id
join public.reservation_sessions as session
  on session.id = membership.effective_session_id
 and session.reservation_id = membership.effective_reservation_id
join public.reservation_admin_allocations_v1 as allocation
  on allocation.allocation_id = membership.booking_id
cross join actor
where actor.allowed
  and (
    allocation.effective_reservation_id is distinct from membership.effective_reservation_id
    or allocation.effective_session_id is distinct from membership.effective_session_id
    or allocation.court_id is distinct from booking.court_id
    or allocation.starts_at is distinct from session.starts_at
    or allocation.ends_at is distinct from session.ends_at
    or allocation.allocation_status is distinct from booking.status::text
    or allocation.allocation_amount is distinct from booking.total_amount
  )

union all

select
  'reservation_summary_missing',
  expected_summary.reservation_id,
  null::uuid,
  null::uuid,
  jsonb_build_object('expected_count', 1, 'actual_count', 0)
from expected_summary
left join actual_summary
  on actual_summary.reservation_id = expected_summary.reservation_id
where actual_summary.reservation_id is null

union all

select
  'reservation_summary_projection_mismatch',
  expected_summary.reservation_id,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'allocation_count_matches',
      actual_summary.allocation_count is not distinct from expected_summary.allocation_count,
    'session_count_matches',
      actual_summary.session_count is not distinct from expected_summary.session_count,
    'first_session_matches',
      actual_summary.first_session_starts_at is not distinct from expected_summary.first_session_starts_at,
    'last_session_matches',
      actual_summary.last_session_ends_at is not distinct from expected_summary.last_session_ends_at,
    'total_amount_matches',
      actual_summary.total_amount is not distinct from expected_summary.total_amount,
    'reservation_status_matches',
      actual_summary.reservation_status is not distinct from expected_summary.reservation_status,
    'primary_count', expected_primary.primary_count,
    'primary_party_matches',
      actual_summary.primary_party_id is not distinct from expected_primary.primary_party_id,
    'net_paid_matches',
      actual_summary.net_paid_amount is not distinct from expected_ledger.net_paid_amount,
    'paid_amount_matches',
      actual_summary.paid_amount is not distinct from expected_ledger.paid_amount,
    'refunded_amount_matches',
      actual_summary.refunded_amount is not distinct from expected_ledger.refunded_amount
  )
from expected_summary
join actual_summary on actual_summary.reservation_id = expected_summary.reservation_id
join expected_primary on expected_primary.reservation_id = expected_summary.reservation_id
join expected_ledger on expected_ledger.reservation_id = expected_summary.reservation_id
where actual_summary.allocation_count is distinct from expected_summary.allocation_count
   or actual_summary.session_count is distinct from expected_summary.session_count
   or actual_summary.first_session_starts_at is distinct from expected_summary.first_session_starts_at
   or actual_summary.last_session_ends_at is distinct from expected_summary.last_session_ends_at
   or actual_summary.total_amount is distinct from expected_summary.total_amount
   or actual_summary.reservation_status is distinct from expected_summary.reservation_status
   or expected_primary.primary_count <> 1
   or actual_summary.primary_party_id is distinct from expected_primary.primary_party_id
   or actual_summary.net_paid_amount is distinct from expected_ledger.net_paid_amount
   or actual_summary.paid_amount is distinct from expected_ledger.paid_amount
   or actual_summary.refunded_amount is distinct from expected_ledger.refunded_amount;

comment on view public.reservation_phase4a_read_mismatches is
  'Phase 4A manager-only PII-free canonical read contract mismatches. Contains codes, internal IDs, counts, timestamps, statuses, and amounts only.';

create function public.admin_get_reservation_read_shadow_status(
  p_sample_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
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

  if p_sample_limit < 0 or p_sample_limit > 200 then
    raise exception using errcode = '22023', message = 'Sample limit must be between 0 and 200';
  end if;

  select jsonb_build_object(
    'schema_version', 1,
    'contract_version', 1,
    'generated_at', statement_timestamp(),
    'status', case when mismatch.total_count = 0 then 'clean' else 'mismatch' end,
    'mismatch_count', mismatch.total_count,
    'mismatch_counts', mismatch.counts,
    'samples', samples.rows,
    'totals', jsonb_build_object(
      'allocations', (select count(*) from public.bookings),
      'effective_memberships', (
        select count(*) from public.reservation_allocation_memberships
      ),
      'effective_reservations', (
        select count(distinct membership.effective_reservation_id)
        from public.reservation_allocation_memberships as membership
      ),
      'effective_sessions', (
        select count(distinct membership.effective_session_id)
        from public.reservation_allocation_memberships as membership
      ),
      'summary_rows', (
        select count(*) from public.reservation_admin_summary_v1
      ),
      'schedule_rows', (
        select count(*) from public.reservation_admin_allocations_v1
      )
    )
  ) into v_result
  from (
    select
      coalesce(sum(summary.mismatch_count), 0)::integer as total_count,
      coalesce(
        jsonb_object_agg(summary.mismatch_code, summary.mismatch_count),
        '{}'::jsonb
      ) as counts
    from (
      select mismatch.mismatch_code, count(*)::integer as mismatch_count
      from public.reservation_phase4a_read_mismatches as mismatch
      group by mismatch.mismatch_code
    ) as summary
  ) as mismatch
  cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(sample)), '[]'::jsonb) as rows
    from (
      select
        read_mismatch.mismatch_code,
        read_mismatch.reservation_id,
        read_mismatch.session_id,
        read_mismatch.allocation_id,
        read_mismatch.details
      from public.reservation_phase4a_read_mismatches as read_mismatch
      order by
        read_mismatch.mismatch_code,
        read_mismatch.reservation_id,
        read_mismatch.session_id,
        read_mismatch.allocation_id
      limit p_sample_limit
    ) as sample
  ) as samples;

  return v_result;
end;
$function$;

comment on function public.admin_get_reservation_read_shadow_status(integer) is
  'Phase 4A manager-only PII-free read contract status. Safe for CI counts/codes/ID samples.';

create function private.assert_reservation_phase4a_read_contract()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_mismatch_count integer;
  v_codes text;
  v_allocation_count integer;
  v_summary_count integer;
begin
  select
    count(*)::integer,
    string_agg(distinct mismatch.mismatch_code, ', ' order by mismatch.mismatch_code)
    into v_mismatch_count, v_codes
  from public.reservation_phase4a_read_mismatches as mismatch;

  if v_mismatch_count <> 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Phase 4A read contract found %s mismatch rows: %s',
        v_mismatch_count,
        coalesce(v_codes, '<unknown>')
      );
  end if;

  select count(*)::integer
    into v_allocation_count
  from public.reservation_admin_allocations_v1;

  select count(*)::integer
    into v_summary_count
  from public.reservation_admin_summary_v1;

  return jsonb_build_object(
    'status', 'phase_4a_manager_read_contract_verified',
    'schema_version', 1,
    'allocation_count', v_allocation_count,
    'reservation_count', v_summary_count,
    'mismatch_count', v_mismatch_count
  );
end;
$function$;

-- Exposure and grants are explicit because Data API auto-exposure is no longer
-- a stable platform default. Underlying manager RLS remains authoritative via
-- security_invoker; anon and service-role do not receive these new entries.
revoke all on table public.reservation_admin_summary_v1
  from public, anon, authenticated, service_role;
grant select on table public.reservation_admin_summary_v1 to authenticated;

revoke all on table public.reservation_admin_allocations_v1
  from public, anon, authenticated, service_role;
grant select on table public.reservation_admin_allocations_v1 to authenticated;

revoke all on table public.reservation_phase4a_read_mismatches
  from public, anon, authenticated, service_role;
grant select on table public.reservation_phase4a_read_mismatches to authenticated;

revoke all on function public.admin_list_reservation_allocations(
  timestamptz, timestamptz, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_reservation_allocations(
  timestamptz, timestamptz, integer, timestamptz, uuid
) to authenticated;

revoke all on function public.admin_search_reservations(
  date, date, text, text, text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_reservations(
  date, date, text, text, text, integer, timestamptz, uuid
) to authenticated;

revoke all on function public.admin_get_reservation_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_reservation_detail(uuid)
  to authenticated;

revoke all on function public.admin_get_reservation_read_shadow_status(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_reservation_read_shadow_status(integer)
  to authenticated;

revoke all on function private.assert_reservation_phase4a_read_contract()
  from public, anon, authenticated, service_role;

-- The migration itself proves the existing dataset can be rendered through the
-- new contract without changing the active writer or legacy product paths.
do $postflight$
declare
  v_view record;
  v_function record;
  v_read_contract jsonb;
begin
  for v_view in
    select
      class.relname,
      coalesce(class.reloptions, '{}'::text[]) as reloptions
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = any(array[
        'reservation_admin_summary_v1',
        'reservation_admin_allocations_v1',
        'reservation_phase4a_read_mismatches'
      ])
  loop
    if not ('security_invoker=true' = any(v_view.reloptions)) then
      raise exception using
        errcode = '55000',
        message = format('Phase 4A view %s is not security_invoker', v_view.relname);
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = any(array[
        'reservation_admin_summary_v1',
        'reservation_admin_allocations_v1',
        'reservation_phase4a_read_mismatches'
      ])
  ) <> 3 then
    raise exception using errcode = '55000', message = 'Phase 4A view inventory is incomplete';
  end if;

  for v_function in
    select
      procedure.oid,
      procedure.proname,
      procedure.prosecdef,
      procedure.proconfig
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'admin_list_reservation_allocations',
        'admin_search_reservations',
        'admin_get_reservation_detail',
        'admin_get_reservation_read_shadow_status'
      ])
  loop
    if v_function.prosecdef
       or v_function.proconfig is distinct from array['search_path=""']::text[]
    then
      raise exception using
        errcode = '55000',
        message = format('Phase 4A function %s security shape drifted', v_function.proname);
    end if;

    -- anon inherits any EXECUTE left on PUBLIC, so this check covers both the
    -- concrete client role and PostgreSQL's pseudo-role without treating
    -- PUBLIC as a pg_roles row.
    if has_function_privilege('anon', v_function.oid, 'EXECUTE')
       or has_function_privilege('service_role', v_function.oid, 'EXECUTE')
       or not has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
    then
      raise exception using
        errcode = '55000',
        message = format('Phase 4A function %s grants drifted', v_function.proname);
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'admin_list_reservation_allocations',
        'admin_search_reservations',
        'admin_get_reservation_detail',
        'admin_get_reservation_read_shadow_status'
      ])
  ) <> 4 then
    raise exception using errcode = '55000', message = 'Phase 4A function inventory is incomplete';
  end if;

  v_read_contract := private.assert_reservation_phase3b_activation();
  if v_read_contract ->> 'status' <> 'clean'
     or v_read_contract -> 'writer_inventory' ->> 'status' <> 'activated'
     or (v_read_contract ->> 'membership_count')::integer
       <> (v_read_contract ->> 'booking_count')::integer
     or (v_read_contract ->> 'shadow_mismatch_count')::integer <> 0
     or (v_read_contract ->> 'projection_mismatch_count')::integer <> 0
     or (v_read_contract ->> 'payment_mismatch_count')::integer <> 0
     or (v_read_contract ->> 'incomplete_operation_count')::integer <> 0
  then
    raise exception using errcode = '55000', message = 'Phase 3B.2 activation regressed during Phase 4A migration';
  end if;

  v_read_contract := private.assert_reservation_phase4a_read_contract();

  if v_read_contract ->> 'status' <> 'phase_4a_manager_read_contract_verified' then
    raise exception using errcode = '55000', message = 'Phase 4A read contract is not verified';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
