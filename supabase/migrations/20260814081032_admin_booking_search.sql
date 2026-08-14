create or replace function public.admin_search_bookings(
  p_start_date date,
  p_end_date date,
  p_query text default '',
  p_booking_status text default 'not_cancelled',
  p_payment_status text default 'all',
  p_limit integer default 50
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
    select booking.*
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
  limited as (
    select matching.*
    from matching
    order by matching.start_at asc, matching.id asc
    limit v_limit
  )
  select jsonb_build_object(
    'version', 1,
    'limit', v_limit,
    'items', coalesce(
      (select jsonb_agg(to_jsonb(limited) order by limited.start_at asc, limited.id asc) from limited),
      '[]'::jsonb
    ),
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

revoke execute on function public.admin_search_bookings(date, date, text, text, text, integer)
  from public, anon;
grant execute on function public.admin_search_bookings(date, date, text, text, text, integer)
  to authenticated;
