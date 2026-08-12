create or replace function public.create_booking(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_phone text,
  p_customer_notes text default null,
  p_party_size smallint default 2,
  p_payment_method public.payment_method default 'venue'
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  select created.* into v_booking
  from public.create_multi_booking(
    array[p_court_id], p_start_at, p_end_at, p_customer_phone,
    p_customer_notes, p_party_size, p_payment_method
  ) as created
  limit 1;
  return v_booking;
end;
$$;

create or replace function public.admin_create_booking(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  select created.* into v_booking
  from public.admin_create_multi_booking(
    array[p_court_id], p_start_at, p_end_at, p_customer_name,
    p_customer_email, p_party_size, p_customer_phone, p_customer_notes
  ) as created
  limit 1;
  return v_booking;
end;
$$;

revoke execute on function public.create_booking(uuid,timestamp,timestamp,text,text,smallint,public.payment_method) from public,anon,authenticated;
revoke execute on function public.admin_create_booking(uuid,timestamp,timestamp,text,text,smallint,text,text) from public,anon,authenticated;
grant execute on function public.create_booking(uuid,timestamp,timestamp,text,text,smallint,public.payment_method) to authenticated;
grant execute on function public.admin_create_booking(uuid,timestamp,timestamp,text,text,smallint,text,text) to authenticated;
notify pgrst, 'reload schema';
