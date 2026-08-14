drop function if exists public.admin_search_bookings(date, date, text, text, text, integer);

create function public.admin_search_bookings(
  p_start_date date,
  p_end_date date,
  p_query text default '',
  p_booking_status text default 'not_cancelled',
  p_payment_status text default 'all',
  p_limit integer default 50,
  p_after_start_at timestamp default null,
  p_after_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
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
    raise exception 'Invalid booking search date range';
  end if;

  if p_end_date > p_start_date + 366 then
    raise exception 'Booking search range cannot exceed 367 days';
  end if;

  if (p_after_start_at is null) <> (p_after_id is null) then
    raise exception 'Invalid booking search cursor';
  end if;

  if coalesce(p_booking_status, '') not in (
    'not_cancelled', 'all', 'held', 'confirmed', 'cancelled', 'completed', 'expired', 'no_show'
  ) then
    raise exception 'Invalid booking status filter';
  end if;

  if coalesce(p_payment_status, '') not in (
    'all', 'unpaid', 'pending', 'paid', 'pay_at_venue', 'refunded', 'failed'
  ) then
    raise exception 'Invalid payment status filter';
  end if;

  with matching as materialized (
    select
      booking.id,
      booking.booking_group_id,
      booking.recurrence_series_id,
      booking.recurrence_week,
      booking.user_id,
      booking.court_id,
      booking.customer_name,
      booking.customer_email,
      booking.customer_phone,
      booking.customer_notes,
      booking.start_at,
      booking.end_at,
      booking.status,
      booking.payment_status,
      booking.payment_method,
      booking.total_amount,
      booking.currency,
      booking.party_size,
      booking.created_at
    from public.bookings as booking
    join public.courts as court on court.id = booking.court_id
    where booking.start_at >= p_start_date::timestamp
      and booking.start_at < (p_end_date + 1)::timestamp
      and (
        p_booking_status = 'all'
        or (p_booking_status = 'not_cancelled' and booking.status <> 'cancelled')
        or booking.status::text = p_booking_status
      )
      and (
        p_payment_status = 'all'
        or (p_payment_status = 'unpaid' and booking.payment_status in ('pending', 'pay_at_venue'))
        or booking.payment_status::text = p_payment_status
      )
      and (
        v_query is null
        or booking.customer_name ilike '%' || v_query || '%'
        or booking.customer_email ilike '%' || v_query || '%'
        or booking.customer_phone ilike '%' || v_query || '%'
        or booking.customer_notes ilike '%' || v_query || '%'
        or court.name_zh ilike '%' || v_query || '%'
        or court.name_en ilike '%' || v_query || '%'
        or court.description ilike '%' || v_query || '%'
      )
  ),
  summary as (
    select
      count(*)::integer as result_count,
      coalesce(sum(extract(epoch from (end_at - start_at)) / 60), 0)::integer as total_minutes,
      count(distinct coalesce(nullif(customer_email, ''), nullif(customer_phone, ''), customer_name))::integer as customer_count,
      count(*) filter (where start_at::date = timezone('America/Toronto', clock_timestamp())::date)::integer as today_count
    from matching
  ),
  page_candidates as materialized (
    select matching.*
    from matching
    where p_after_start_at is null
       or (matching.start_at, matching.id) > (p_after_start_at, p_after_id)
    order by matching.start_at asc, matching.id asc
    limit v_limit + 1
  ),
  page_items as materialized (
    select page_candidates.*
    from page_candidates
    order by page_candidates.start_at asc, page_candidates.id asc
    limit v_limit
  ),
  page_cursor as (
    select page_items.start_at, page_items.id
    from page_items
    order by page_items.start_at desc, page_items.id desc
    limit 1
  )
  select jsonb_build_object(
    'version', 2,
    'limit', v_limit,
    'items', coalesce(
      (select jsonb_agg(to_jsonb(page_items) order by page_items.start_at asc, page_items.id asc) from page_items),
      '[]'::jsonb
    ),
    'has_more', (select count(*) > v_limit from page_candidates),
    'next_cursor', case
      when (select count(*) > v_limit from page_candidates) then (
        select jsonb_build_object('start_at', page_cursor.start_at, 'id', page_cursor.id)
        from page_cursor
      )
      else null
    end,
    'summary', jsonb_build_object(
      'results', summary.result_count,
      'total_minutes', summary.total_minutes,
      'customers', summary.customer_count,
      'today', summary.today_count
    )
  )
  into v_result
  from summary;

  return v_result;
end;
$$;

revoke execute on function public.admin_search_bookings(date, date, text, text, text, integer, timestamp, uuid)
from public, anon;
grant execute on function public.admin_search_bookings(date, date, text, text, text, integer, timestamp, uuid)
to authenticated;

notify pgrst, 'reload schema';
