create or replace function private.enforce_future_booking_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamp := timezone('America/Toronto', clock_timestamp());
begin
  -- Cancelled rows may retain their historical schedule.
  if new.status not in ('held', 'confirmed') then
    return new;
  end if;

  -- New or reactivated bookings must always begin in the future.
  if tg_op = 'INSERT' or old.status not in ('held', 'confirmed') then
    if new.start_at <= v_now then
      raise exception using
        errcode = '22007',
        message = 'Booking start time must be in the future';
    end if;
    return new;
  end if;

  -- Historical bookings remain visible, but their schedule is immutable.
  if old.end_at <= v_now then
    if new.court_id is distinct from old.court_id
       or new.start_at is distinct from old.start_at
       or new.end_at is distinct from old.end_at then
      raise exception using
        errcode = '22007',
        message = 'Booking has already ended';
    end if;
    return new;
  end if;

  -- Once play begins, only the ending time may change.
  if old.start_at <= v_now then
    if new.court_id is distinct from old.court_id
       or new.start_at is distinct from old.start_at then
      raise exception using
        errcode = '22007',
        message = 'Booking has already started; its start time and court are locked';
    end if;
    if new.end_at is distinct from old.end_at
       and new.end_at < v_now + interval '30 minutes' then
      raise exception using
        errcode = '22007',
        message = 'In-progress booking must end at least 30 minutes from now';
    end if;
    return new;
  end if;

  -- Future bookings can be moved, but never into the past.
  if new.start_at <= v_now then
    raise exception using
      errcode = '22007',
      message = 'Booking start time must be in the future';
  end if;
  return new;
end;
$$;

comment on function private.enforce_future_booking_schedule() is
  'Locks started booking court/start fields, permits end-only extensions or reductions at least 30 minutes beyond venue now, and keeps ended schedules immutable.';

notify pgrst, 'reload schema';
