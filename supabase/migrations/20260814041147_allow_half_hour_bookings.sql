create or replace function private.assert_booking_window(
  p_start_at timestamp,
  p_end_at timestamp,
  p_max_duration interval
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '30 minutes' then raise exception 'Minimum booking length is 30 minutes'; end if;
  if p_end_at > p_start_at + p_max_duration then raise exception 'Maximum booking length exceeded'; end if;
  if p_start_at::time < time '10:00'
     or p_end_at > date_trunc('day', p_start_at) + interval '1 day' then
    raise exception 'Booking must be within opening hours';
  end if;
end;
$$;

create or replace function private.enforce_future_booking_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamp := timezone('America/Toronto', clock_timestamp());
begin
  if new.status not in ('held', 'confirmed') then
    return new;
  end if;

  if tg_op = 'INSERT' or old.status not in ('held', 'confirmed') then
    if new.start_at <= v_now then
      raise exception using errcode = '22007', message = 'Booking start time must be in the future';
    end if;
    return new;
  end if;

  if old.end_at <= v_now then
    if new.court_id is distinct from old.court_id
       or new.start_at is distinct from old.start_at
       or new.end_at is distinct from old.end_at then
      raise exception using errcode = '22007', message = 'Booking has already ended';
    end if;
    return new;
  end if;

  if old.start_at <= v_now then
    if new.court_id is distinct from old.court_id
       or new.start_at is distinct from old.start_at then
      raise exception using errcode = '22007', message = 'Booking has already started; its start time and court are locked';
    end if;
    if new.end_at is distinct from old.end_at and new.end_at <= v_now then
      raise exception using errcode = '22007', message = 'In-progress booking must end after the current time';
    end if;
    return new;
  end if;

  if new.start_at <= v_now then
    raise exception using errcode = '22007', message = 'Booking start time must be in the future';
  end if;
  return new;
end;
$$;

comment on function private.assert_booking_window(timestamp, timestamp, interval) is
  'Validates 30-minute minimum bookings, the supplied maximum duration, and Tiger opening hours.';

comment on function private.enforce_future_booking_schedule() is
  'Locks started booking court/start fields, permits end-only changes after venue now, and keeps ended schedules immutable.';

notify pgrst, 'reload schema';
