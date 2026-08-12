alter table private.booking_admin_actions drop constraint if exists booking_admin_actions_action_check;
alter table private.booking_admin_actions add constraint booking_admin_actions_action_check
check (action in ('cancelled', 'created', 'rescheduled'));
alter table private.booking_admin_actions add column if not exists previous_court_id uuid references public.courts(id);
alter table private.booking_admin_actions add column if not exists new_court_id uuid references public.courts(id);
alter table private.booking_admin_actions add column if not exists previous_start_at timestamp;
alter table private.booking_admin_actions add column if not exists previous_end_at timestamp;
alter table private.booking_admin_actions add column if not exists new_start_at timestamp;
alter table private.booking_admin_actions add column if not exists new_end_at timestamp;

create or replace function public.hook_allow_manager_accounts(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_email text := lower(trim(event->'user'->>'email'));
begin
  if v_email in ('321756623tu@gmail.com','zhangk7@gmail.com') then return '{}'::jsonb; end if;
  return jsonb_build_object('error',jsonb_build_object('message','This Tiger workspace is restricted to approved manager accounts.','http_code',403));
end; $$;
grant execute on function public.hook_allow_manager_accounts(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_allow_manager_accounts(jsonb) from public,anon,authenticated;

create or replace function public.admin_create_booking(
  p_court_id uuid, p_start_at timestamp, p_end_at timestamp,
  p_customer_name text, p_customer_email text, p_party_size smallint default 2
)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_hourly_rate numeric(10,2); v_total numeric(10,2); v_booking public.bookings;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members where user_id = v_actor_id and role = 'admin') then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is null or position('@' in p_customer_email) < 2 then raise exception 'Valid customer email is required'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at > p_start_at + interval '2 hours' then raise exception 'Maximum booking length is 2 hours'; end if;
  if p_start_at::date <> p_end_at::date then raise exception 'Booking must end on the same day'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if p_party_size not between 1 and 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;
  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);
  begin
    insert into public.bookings (user_id, court_id, customer_name, customer_email, start_at, end_at, status, payment_status, payment_method, total_amount, party_size)
    values (v_actor_id, p_court_id, trim(p_customer_name), lower(trim(p_customer_email)), p_start_at, p_end_at, 'confirmed', 'pay_at_venue', 'venue', v_total, p_party_size)
    returning * into v_booking;
  exception when exclusion_violation then raise exception using message = 'This court is already booked for that time', errcode = 'P0001'; end;
  insert into private.booking_admin_actions (booking_id, actor_id, action, previous_status, new_status, new_court_id, new_start_at, new_end_at)
  values (v_booking.id, v_actor_id, 'created', v_booking.status, v_booking.status, v_booking.court_id, v_booking.start_at, v_booking.end_at);
  return v_booking;
end; $$;

create or replace function public.admin_reschedule_booking(p_booking_id uuid, p_court_id uuid, p_start_at timestamp, p_end_at timestamp)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_booking public.bookings; v_previous public.bookings; v_hourly_rate numeric(10,2);
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members where user_id = v_actor_id and role = 'admin') then raise exception 'Manager access required'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at > p_start_at + interval '2 hours' then raise exception 'Maximum booking length is 2 hours'; end if;
  if p_start_at::date <> p_end_at::date then raise exception 'Booking must end on the same day'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;
  select * into v_previous from public.bookings where id = p_booking_id for update;
  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if v_previous.status not in ('held', 'confirmed') then raise exception 'Booking is no longer active'; end if;
  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  begin
    update public.bookings set court_id=p_court_id, start_at=p_start_at, end_at=p_end_at,
      total_amount=round(v_hourly_rate * extract(epoch from (p_end_at-p_start_at))/3600,2)
    where id=p_booking_id returning * into v_booking;
  exception when exclusion_violation then raise exception using message = 'This court is already booked for that time', errcode = 'P0001'; end;
  insert into private.booking_admin_actions (booking_id, actor_id, action, previous_status, new_status, previous_court_id, new_court_id, previous_start_at, previous_end_at, new_start_at, new_end_at)
  values (v_booking.id, v_actor_id, 'rescheduled', v_previous.status, v_booking.status, v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at, v_booking.start_at, v_booking.end_at);
  return v_booking;
end; $$;

create or replace function public.create_booking(p_court_id uuid, p_start_at timestamp, p_end_at timestamp, p_party_size smallint default 2, p_payment_method public.payment_method default 'venue')
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_customer_name text; v_customer_email text; v_hourly_rate numeric(10,2); v_total numeric(10,2); v_booking public.bookings;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members where user_id=v_user_id and role='admin') then raise exception 'Manager access required'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at > p_start_at + interval '2 hours' then raise exception 'Maximum booking length is 2 hours'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if p_start_at < timezone('America/Toronto', now()) - interval '5 minutes' then raise exception 'Cannot book a past time'; end if;
  if p_start_at > timezone('America/Toronto', now()) + interval '30 days' then raise exception 'Bookings open 30 days in advance'; end if;
  if p_party_size not between 1 and 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if not exists (select 1 from public.courts where id=p_court_id and status='open') then raise exception 'Court is unavailable'; end if;
  select coalesce(nullif(trim(profile.display_name),''), nullif(trim(auth_user.raw_user_meta_data->>'full_name'),''), nullif(split_part(auth_user.email,'@',1),''), 'Tiger guest'), coalesce(auth_user.email,'unknown@tiger.local')
  into v_customer_name,v_customer_email from auth.users auth_user left join public.profiles profile on profile.id=auth_user.id where auth_user.id=v_user_id;
  if v_customer_email is null then raise exception 'Authenticated user profile is unavailable'; end if;
  update public.bookings set status='expired' where status='held' and hold_expires_at<=now();
  v_hourly_rate := case when p_start_at::time>=time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate*extract(epoch from(p_end_at-p_start_at))/3600,2);
  begin
    insert into public.bookings(user_id,court_id,customer_name,customer_email,start_at,end_at,status,payment_status,payment_method,total_amount,party_size,hold_expires_at)
    values(v_user_id,p_court_id,v_customer_name,v_customer_email,p_start_at,p_end_at,case when p_payment_method='stripe' then 'held'::public.booking_status else 'confirmed'::public.booking_status end,case when p_payment_method='stripe' then 'pending'::public.payment_status else 'pay_at_venue'::public.payment_status end,p_payment_method,v_total,p_party_size,case when p_payment_method='stripe' then now()+interval '10 minutes' else null end)
    returning * into v_booking;
  exception when exclusion_violation then raise exception using message='This court is already booked for that time',errcode='P0001'; end;
  return v_booking;
end; $$;

drop policy if exists "courts are public" on public.courts;
drop policy if exists "staff read courts" on public.courts;
create policy "staff read courts" on public.courts for select to authenticated
using ((select exists(select 1 from public.staff_members where user_id=(select auth.uid()) and role='admin')));
drop policy if exists "public schedule is readable" on public.court_slots;
drop policy if exists "staff read schedule" on public.court_slots;
create policy "staff read schedule" on public.court_slots for select to authenticated
using ((select exists(select 1 from public.staff_members where user_id=(select auth.uid()) and role='admin')));
drop policy if exists "users read permitted bookings" on public.bookings;
create policy "users read permitted bookings" on public.bookings for select to authenticated
using ((select exists(select 1 from public.staff_members where user_id=(select auth.uid()) and role='admin')));

revoke all on public.courts, public.court_slots from anon;
grant select on public.courts, public.court_slots to authenticated;
revoke execute on function public.admin_create_booking(uuid,timestamp,timestamp,text,text,smallint) from public,anon,authenticated;
revoke execute on function public.admin_reschedule_booking(uuid,uuid,timestamp,timestamp) from public,anon,authenticated;
grant execute on function public.admin_create_booking(uuid,timestamp,timestamp,text,text,smallint) to authenticated;
grant execute on function public.admin_reschedule_booking(uuid,uuid,timestamp,timestamp) to authenticated;
