-- Emergency rollback artifact for Reservation Phase 3B.2.
--
-- This file is intentionally outside supabase/migrations and must never be
-- applied automatically. It restores the exact 17 public legacy definitions
-- captured during activation, revokes the new explicit-primary entry point,
-- and retains every Reservation transition, Payment, allocation, membership,
-- Session-assignment, operation, and audit row.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

lock table private.reservation_phase3b_activation_state in exclusive mode;
lock table private.reservation_phase3b_writer_baseline in share mode;

do $preflight$
begin
  if not exists (
    select 1
    from private.reservation_phase3b_activation_state as state
    where state.singleton and state.status = 'activated'
  ) then
    raise exception 'Phase 3B.2 activation is not active';
  end if;
  if (select count(*) from private.reservation_phase3b_writer_baseline) <> 17 then
    raise exception 'Phase 3B.2 writer baseline is incomplete';
  end if;
  perform private.assert_reservation_phase3b_activation();
end;
$preflight$;

do $restore_writers$
declare
  v_baseline private.reservation_phase3b_writer_baseline%rowtype;
  v_signature regprocedure;
begin
  for v_baseline in
    select baseline.*
    from private.reservation_phase3b_writer_baseline as baseline
    order by baseline.signature
  loop
    execute v_baseline.original_definition;
    v_signature := to_regprocedure(v_baseline.signature);
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_signature
    );
    execute format(
      'grant execute on function %s to authenticated, service_role',
      v_signature
    );
  end loop;
end;
$restore_writers$;

revoke all on function
  public.admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)
from public, anon, authenticated, service_role;

update private.reservation_phase3b_activation_state
   set status = 'legacy_writer_rollback',
       rolled_back_at = statement_timestamp()
 where singleton;

-- Legacy schedule writers do not dual-write Session projections. In rollback
-- mode those checks become observation-only so the exact pre-activation writer
-- behavior is recoverable. The Phase 3B history stays intact for a forward fix.
create or replace function private.enforce_booking_session_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text := 'America/Toronto';
  v_activation_context text := current_setting(
    'app.reservation_phase3b_activation_operation',
    true
  );
begin
  if new.session_id is null and new.reservation_id is null then return new; end if;
  if current_user = 'postgres'
     and (
       nullif(v_activation_context, '') is not null
       or exists (
         select 1 from private.reservation_phase3b_activation_state as state
         where state.singleton and state.status = 'legacy_writer_rollback'
       )
     ) then
    return new;
  end if;

  select session.starts_at, session.ends_at
    into v_starts_at, v_ends_at
  from public.reservation_sessions as session
  where session.id = new.session_id
    and session.reservation_id = new.reservation_id;
  if not found then
    raise exception using
      errcode = '23503',
      constraint = 'bookings_session_reservation_fkey',
      message = 'Booking Session must belong to the same Reservation';
  end if;

  select coalesce(nullif(trim(settings.timezone), ''), v_timezone)
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;
  if new.start_at is distinct from pg_catalog.timezone(v_timezone, v_starts_at)
     or new.end_at is distinct from pg_catalog.timezone(v_timezone, v_ends_at) then
    raise exception using
      errcode = '23514',
      constraint = 'bookings_session_time_projection_check',
      message = 'Booking allocation time must match its Session in the venue timezone';
  end if;
  return new;
end;
$function$;

create or replace function private.assert_booking_session_projection_at_commit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1 from private.reservation_phase3b_activation_state as state
    where state.singleton and state.status = 'legacy_writer_rollback'
  ) then
    return null;
  end if;
  if exists (
    select 1
    from public.bookings as booking
    cross join public.venue_settings as settings
    left join public.reservation_sessions as session
      on session.id = booking.session_id
     and session.reservation_id = booking.reservation_id
    where booking.id = new.id
      and booking.reservation_id is not null
      and (
        session.id is null
        or booking.start_at is distinct from
          pg_catalog.timezone(settings.timezone, session.starts_at)
        or booking.end_at is distinct from
          pg_catalog.timezone(settings.timezone, session.ends_at)
      )
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'bookings_phase3b_projection_commit_check',
      message = 'Phase 3B writer left a Booking/Session projection mismatch';
  end if;
  return null;
end;
$function$;

revoke all on function
  private.enforce_booking_session_projection(),
  private.assert_booking_session_projection_at_commit()
from public, anon, authenticated, service_role;

select private.assert_reservation_phase3b_writer_inventory();
select private.assert_reservation_phase3b_activation();

notify pgrst, 'reload schema';

commit;
