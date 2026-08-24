-- Reservation migration Phase 3A: inactive compatibility foundation.
--
-- This migration adds deterministic, bounded catch-up helpers and a
-- manager-only shadow reconciliation read model. It intentionally does not
-- replace or wrap any current booking mutation RPC, install a dual-write
-- trigger, execute catch-up, change the frontend read path, or remove legacy
-- fields. Phase 3B remains a separate activation and production gate.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

-- Reuse the exact UUIDv5 namespaces from Phase 2 so a legacy source always
-- resolves to the same target identifier, including rows created after the
-- frozen Phase 2 snapshot.
create function private.reservation_phase3_uuid(
  p_entity text,
  p_source_key text
)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_namespace_url text;
  v_namespace_id uuid;
begin
  v_namespace_url := case p_entity
    when 'recurrence_series' then
      'https://tiger-badminton.example/reservation-migration/recurrence-series/v1'
    when 'reservation' then
      'https://tiger-badminton.example/reservation-migration/reservation/v1'
    when 'party' then
      'https://tiger-badminton.example/reservation-migration/party/v1'
    when 'session' then
      'https://tiger-badminton.example/reservation-migration/session/v1'
    when 'payment' then
      'https://tiger-badminton.example/reservation-migration/payment/v1'
    else null
  end;

  if v_namespace_url is null then
    raise exception using
      errcode = '22023',
      message = format('Unsupported Reservation UUID entity: %s', p_entity);
  end if;

  v_namespace_id := extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    v_namespace_url
  );
  return extensions.uuid_generate_v5(v_namespace_id, p_source_key);
end;
$function$;

-- Legacy wall-clock timestamps are only accepted when they round-trip to one
-- unique instant in the configured venue timezone. This preserves Phase 2's
-- fail-closed behavior for nonexistent and ambiguous DST values.
create function private.reservation_legacy_timestamp_to_timestamptz(
  p_local_value timestamp,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
strict
security invoker
set search_path = ''
as $function$
declare
  v_instant timestamptz;
begin
  v_instant := p_local_value at time zone p_timezone;

  if pg_catalog.timezone(p_timezone, v_instant) is distinct from p_local_value
     or pg_catalog.timezone(p_timezone, v_instant - interval '1 hour') = p_local_value
     or pg_catalog.timezone(p_timezone, v_instant + interval '1 hour') = p_local_value then
    raise exception using
      errcode = '22007',
      message = format(
        'Legacy booking time %s is nonexistent or ambiguous in %s',
        p_local_value,
        p_timezone
      );
  end if;

  return v_instant;
end;
$function$;

-- Ownership-only updates are a compatibility projection, not a new booking
-- business fact. Preserve the legacy operational updated_at timestamp when no
-- field other than Reservation/Session ownership changed.
create function private.preserve_booking_ownership_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (to_jsonb(new) - 'reservation_id' - 'session_id' - 'updated_at')
       is not distinct from
     (to_jsonb(old) - 'reservation_id' - 'session_id' - 'updated_at') then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_bookings_preserve_ownership_timestamp
  on public.bookings;
create trigger zz_bookings_preserve_ownership_timestamp
before update on public.bookings
for each row execute function private.preserve_booking_ownership_timestamp();

-- Avoid emitting a court_slots Realtime update for contact, payment, price, or
-- ownership-only changes. Schedule/hold/status changes retain the exact legacy
-- projection behavior.
create or replace function public.sync_public_court_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.court_slots where id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and new.court_id is not distinct from old.court_id
     and new.start_at is not distinct from old.start_at
     and new.end_at is not distinct from old.end_at
     and new.status is not distinct from old.status
     and new.hold_expires_at is not distinct from old.hold_expires_at then
    return new;
  end if;

  if new.status in ('held', 'confirmed')
     and (
       new.status <> 'held'
       or new.hold_expires_at is null
       or new.hold_expires_at > now()
     ) then
    insert into public.court_slots (
      id, court_id, start_at, end_at, status, updated_at
    ) values (
      new.id, new.court_id, new.start_at, new.end_at, new.status, now()
    )
    on conflict (id) do update set
      court_id = excluded.court_id,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      status = excluded.status,
      updated_at = now();
  else
    delete from public.court_slots where id = new.id;
  end if;
  return new;
end;
$function$;

-- Reconcile one complete legacy recurrence series. Calls are serialized by a
-- transaction advisory lock and are deterministic/idempotent.
create function private.reconcile_legacy_recurrence_series(
  p_legacy_series_id uuid,
  p_actor_id uuid default null,
  p_source text default 'system'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_target_id uuid;
  v_timezone text;
  v_minimum_week integer;
  v_maximum_week integer;
  v_week_count integer;
  v_group_count integer;
  v_starts_on date;
  v_day_of_week smallint;
  v_invalid_count integer;
  v_existing public.recurrence_series;
begin
  if p_source not in ('manager', 'customer', 'system') then
    raise exception using errcode = '22023', message = 'Invalid recurrence source';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'reservation-recurrence:' || p_legacy_series_id::text,
      20260824052629
    )
  );

  select settings.timezone
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;

  if nullif(trim(v_timezone), '') is null then
    raise exception 'Venue timezone is unavailable';
  end if;

  with occurrences as (
    select
      booking.recurrence_week,
      booking.booking_group_id,
      min(booking.start_at::date) as occurrence_date,
      count(distinct booking.start_at::date) as date_count,
      count(distinct extract(dow from booking.start_at)) as weekday_count
    from public.bookings as booking
    where booking.recurrence_series_id = p_legacy_series_id
    group by booking.recurrence_week, booking.booking_group_id
  ), anchor as (
    select
      min(occurrence.recurrence_week)::integer as minimum_week,
      max(occurrence.recurrence_week)::integer as maximum_week,
      count(distinct occurrence.recurrence_week)::integer as week_count,
      count(*)::integer as group_count,
      min(occurrence.occurrence_date) as starts_on,
      count(distinct extract(dow from occurrence.occurrence_date))::integer
        as series_weekday_count
    from occurrences as occurrence
  )
  select
    anchor.minimum_week,
    anchor.maximum_week,
    anchor.week_count,
    anchor.group_count,
    anchor.starts_on,
    extract(dow from anchor.starts_on)::smallint,
    count(*) filter (
      where occurrence.date_count <> 1
         or occurrence.weekday_count <> 1
         or occurrence.occurrence_date <> (
           anchor.starts_on
           + ((occurrence.recurrence_week - anchor.minimum_week) * 7)
         )
    )::integer
  into
    v_minimum_week,
    v_maximum_week,
    v_week_count,
    v_group_count,
    v_starts_on,
    v_day_of_week,
    v_invalid_count
  from anchor
  join occurrences as occurrence on true
  group by
    anchor.minimum_week,
    anchor.maximum_week,
    anchor.week_count,
    anchor.group_count,
    anchor.starts_on,
    anchor.series_weekday_count;

  if v_group_count is null or v_group_count = 0 then
    raise exception 'Legacy recurrence series not found';
  end if;

  if v_minimum_week <> 1
     or v_maximum_week <> v_week_count
     or v_group_count <> v_week_count
     or v_invalid_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Legacy recurrence series is incomplete or not weekly';
  end if;

  v_target_id := private.reservation_phase3_uuid(
    'recurrence_series',
    'legacy-series:' || p_legacy_series_id::text
  );

  insert into public.recurrence_series (
    id, timezone, frequency, interval_count, day_of_week,
    starts_on, ends_on, occurrence_count, source, created_by
  ) values (
    v_target_id, v_timezone, 'weekly', 1, v_day_of_week,
    v_starts_on, null, v_week_count, p_source, p_actor_id
  )
  on conflict (id) do nothing;

  select *
    into v_existing
  from public.recurrence_series as series
  where series.id = v_target_id
  for update;

  if v_existing.id is null
     or v_existing.timezone is distinct from v_timezone
     or v_existing.frequency <> 'weekly'
     or v_existing.interval_count <> 1
     or v_existing.day_of_week is distinct from v_day_of_week
     or v_existing.starts_on is distinct from v_starts_on
     or v_existing.ends_on is not null
     or v_existing.occurrence_count is distinct from v_week_count then
    raise exception using
      errcode = '23514',
      message = 'Target recurrence series conflicts with its legacy source';
  end if;

  return v_target_id;
end;
$function$;

-- Safely reconcile one current legacy relationship scope. If the scope would
-- require merging or splitting already-owned Reservations, the helper fails
-- closed. Phase 3B must express that transition through the audited append-only
-- relationship/financial path instead of rewriting history.
create function private.reconcile_legacy_booking_group(
  p_booking_group_id uuid,
  p_actor_id uuid default null,
  p_source text default 'system'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_link_id uuid;
  v_scope_group_ids uuid[];
  v_candidate_count integer;
  v_reservation_id uuid;
  v_currency character(3);
  v_currency_count integer;
  v_created_at timestamptz;
  v_recurrence_legacy_id uuid;
  v_recurrence_count integer;
  v_recurrence_sequence integer;
  v_recurrence_sequence_count integer;
  v_recurrence_target_id uuid;
  v_timezone text;
  v_reservation public.reservations;
  v_group record;
  v_session record;
  v_party_id uuid;
  v_expected_party_id uuid;
  v_session_id uuid;
  v_primary_group_id uuid;
  v_primary_party_id uuid;
  v_other_group_count integer;
begin
  if p_source not in ('manager', 'customer', 'system') then
    raise exception using errcode = '22023', message = 'Invalid Reservation source';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'reservation-group:' || p_booking_group_id::text,
      20260824052629
    )
  );

  select
    (array_agg(booking.booking_link_id order by booking.id))[1]
  into v_link_id
  from public.bookings as booking
  where booking.booking_group_id = p_booking_group_id;

  if not found or not exists (
    select 1 from public.bookings
    where booking_group_id = p_booking_group_id
  ) then
    raise exception 'Legacy booking group not found';
  end if;

  if exists (
    select 1
    from public.bookings as booking
    where booking.booking_group_id = p_booking_group_id
    group by booking.booking_group_id
    having count(distinct jsonb_build_array(booking.booking_link_id)) <> 1
  ) then
    raise exception 'Legacy booking group contains conflicting link identifiers';
  end if;

  if v_link_id is not null then
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'reservation-link:' || v_link_id::text,
        20260824052629
      )
    );
  end if;

  select array_agg(scope.booking_group_id order by scope.booking_group_id)
    into v_scope_group_ids
  from (
    select distinct booking.booking_group_id
    from public.bookings as booking
    where booking.booking_group_id = p_booking_group_id
       or (v_link_id is not null and booking.booking_link_id = v_link_id)
  ) as scope;

  perform 1
  from public.bookings as booking
  where booking.booking_group_id = any(v_scope_group_ids)
  order by booking.id
  for update;

  if exists (
    select 1
    from public.bookings as booking
    where booking.booking_group_id = any(v_scope_group_ids)
    group by booking.booking_group_id
    having count(distinct jsonb_build_array(
      booking.customer_name,
      booking.customer_email,
      booking.customer_phone
    )) <> 1
       or count(distinct booking.user_id) > 1
       or count(distinct jsonb_build_array(
         booking.booking_link_id,
         booking.recurrence_series_id,
         booking.recurrence_week,
         booking.currency
       )) <> 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'Legacy booking group contains conflicting aggregate facts';
  end if;

  with candidates as (
    select booking.reservation_id
    from public.bookings as booking
    where booking.booking_group_id = any(v_scope_group_ids)
      and booking.reservation_id is not null
    union
    select source.reservation_id
    from public.reservation_legacy_sources as source
    where source.source_type = 'booking_group'
      and source.source_id = any(v_scope_group_ids)
    union
    select source.reservation_id
    from public.reservation_legacy_sources as source
    where v_link_id is not null
      and source.source_type = 'booking_link'
      and source.source_id = v_link_id
  )
  select
    count(distinct candidates.reservation_id)::integer,
    (array_agg(distinct candidates.reservation_id
      order by candidates.reservation_id))[1]
  into v_candidate_count, v_reservation_id
  from candidates;

  if v_candidate_count > 1 then
    raise exception using
      errcode = '55000',
      message = 'Reservation relationship transition required: scope has multiple owned Reservations';
  end if;

  if v_candidate_count = 0 then
    v_reservation_id := private.reservation_phase3_uuid(
      'reservation',
      case when v_link_id is null
        then 'group:' || p_booking_group_id::text
        else 'link:' || v_link_id::text
      end
    );
  end if;

  select count(distinct booking.currency)::integer,
         min(booking.currency)::character(3),
         min(booking.created_at)
    into v_currency_count, v_currency, v_created_at
  from public.bookings as booking
  where booking.booking_group_id = any(v_scope_group_ids);

  if v_currency_count <> 1 then
    raise exception 'Reservation relationship transition cannot mix currencies';
  end if;

  select
    (count(distinct booking.recurrence_series_id)
      filter (where booking.recurrence_series_id is not null))::integer,
    (array_agg(booking.recurrence_series_id order by booking.recurrence_series_id)
      filter (where booking.recurrence_series_id is not null))[1],
    (count(distinct booking.recurrence_week)
      filter (where booking.recurrence_week is not null))::integer,
    (min(booking.recurrence_week)
      filter (where booking.recurrence_week is not null))::integer
  into
    v_recurrence_count,
    v_recurrence_legacy_id,
    v_recurrence_sequence_count,
    v_recurrence_sequence
  from public.bookings as booking
  where booking.booking_group_id = any(v_scope_group_ids);

  if v_recurrence_count > 1 or v_recurrence_sequence_count > 1 then
    raise exception 'Reservation relationship transition has incompatible recurrence sources';
  end if;

  if v_recurrence_legacy_id is not null then
    v_recurrence_target_id := private.reconcile_legacy_recurrence_series(
      v_recurrence_legacy_id,
      p_actor_id,
      p_source
    );
  end if;

  select settings.timezone
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;

  if nullif(trim(v_timezone), '') is null then
    raise exception 'Venue timezone is unavailable';
  end if;

  -- A current scope may only adopt a Reservation that has no owned booking
  -- groups outside this scope. Otherwise a merge/split event is required.
  select count(distinct booking.booking_group_id)::integer
    into v_other_group_count
  from public.bookings as booking
  where booking.reservation_id = v_reservation_id
    and not (booking.booking_group_id = any(v_scope_group_ids));

  if v_other_group_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'Reservation relationship transition required: canonical Reservation contains another current scope';
  end if;

  insert into public.reservations (
    id, recurrence_series_id, recurrence_sequence, currency,
    notes, payment_plan, source, created_by, created_at, updated_at
  ) values (
    v_reservation_id,
    v_recurrence_target_id,
    v_recurrence_sequence,
    v_currency,
    null,
    'legacy_unspecified',
    p_source,
    p_actor_id,
    v_created_at,
    v_created_at
  )
  on conflict (id) do nothing;

  select *
    into v_reservation
  from public.reservations as reservation
  where reservation.id = v_reservation_id
  for update;

  if v_reservation.id is null
     or v_reservation.currency is distinct from v_currency
     or v_reservation.recurrence_series_id is distinct from v_recurrence_target_id
     or v_reservation.recurrence_sequence is distinct from v_recurrence_sequence then
    raise exception using
      errcode = '23514',
      message = 'Target Reservation conflicts with its legacy relationship scope';
  end if;

  for v_group in
    select
      booking.booking_group_id,
      min(booking.customer_name) as customer_name,
      min(booking.customer_email) as customer_email,
      min(booking.customer_phone) as customer_phone,
      (array_agg(booking.user_id order by booking.user_id))[1] as auth_user_id,
      min(booking.created_at) as created_at,
      max(booking.updated_at) as updated_at,
      bool_or(
        booking.status in ('held', 'confirmed')
        and (
          booking.status <> 'held'
          or booking.hold_expires_at is null
          or booking.hold_expires_at > statement_timestamp()
        )
      ) as has_active_booking
    from public.bookings as booking
    where booking.booking_group_id = any(v_scope_group_ids)
    group by booking.booking_group_id
    order by min(booking.created_at), booking.booking_group_id
  loop
    insert into public.reservation_legacy_sources (
      reservation_id, source_type, source_id, created_by, created_at
    ) values (
      v_reservation_id,
      'booking_group',
      v_group.booking_group_id,
      p_actor_id,
      v_group.created_at
    )
    on conflict (source_type, source_id) do nothing;

    if not exists (
      select 1
      from public.reservation_legacy_sources as source
      where source.source_type = 'booking_group'
        and source.source_id = v_group.booking_group_id
        and source.reservation_id = v_reservation_id
    ) then
      raise exception 'Legacy booking group is already mapped to another Reservation';
    end if;

    v_expected_party_id := private.reservation_phase3_uuid(
      'party',
      'booking-group:' || v_group.booking_group_id::text
    );

    insert into public.reservation_parties (
      id, reservation_id, party_type, display_name, email, phone,
      auth_user_id, source, legacy_booking_group_id, created_by,
      created_at, updated_at
    ) values (
      v_expected_party_id,
      v_reservation_id,
      'person',
      v_group.customer_name,
      v_group.customer_email,
      v_group.customer_phone,
      v_group.auth_user_id,
      'legacy_booking_group',
      v_group.booking_group_id,
      p_actor_id,
      v_group.created_at,
      v_group.updated_at
    )
    on conflict do nothing;

    update public.reservation_parties as party
       set display_name = v_group.customer_name,
           email = v_group.customer_email,
           phone = v_group.customer_phone,
           auth_user_id = v_group.auth_user_id
     where party.reservation_id = v_reservation_id
       and party.legacy_booking_group_id = v_group.booking_group_id
       and (
         party.display_name,
         party.email,
         party.phone,
         party.auth_user_id
       ) is distinct from (
         v_group.customer_name,
         v_group.customer_email,
         v_group.customer_phone,
         v_group.auth_user_id
       );

    select party.id
      into v_party_id
    from public.reservation_parties as party
    where party.reservation_id = v_reservation_id
      and party.legacy_booking_group_id = v_group.booking_group_id;

    if v_party_id is distinct from v_expected_party_id then
      raise exception 'Legacy Party UUID conflicts with its booking group';
    end if;

    insert into public.reservation_party_roles (
      reservation_id, party_id, role, created_by, created_at
    ) values (
      v_reservation_id,
      v_party_id,
      'original_booker',
      p_actor_id,
      v_group.created_at
    )
    on conflict do nothing;

    for v_session in
      select
        booking.start_at,
        booking.end_at,
        min(booking.party_size)::smallint as party_size,
        min(booking.customer_notes) as notes,
        min(booking.created_at) as created_at,
        max(booking.updated_at) as updated_at,
        count(distinct jsonb_build_array(
          booking.party_size,
          booking.customer_notes
        ))::integer as fact_count
      from public.bookings as booking
      where booking.booking_group_id = v_group.booking_group_id
      group by booking.start_at, booking.end_at
      order by booking.start_at, booking.end_at
    loop
      if v_session.fact_count <> 1 then
        raise exception 'Legacy Session contains conflicting party facts';
      end if;

      v_session_id := private.reservation_phase3_uuid(
        'session',
        'booking-group:' || v_group.booking_group_id::text
          || '|start:' || to_char(v_session.start_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
          || '|end:' || to_char(v_session.end_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
      );

      insert into public.reservation_sessions (
        id, reservation_id, starts_at, ends_at, party_size, notes,
        source, created_by, created_at, updated_at
      ) values (
        v_session_id,
        v_reservation_id,
        private.reservation_legacy_timestamp_to_timestamptz(
          v_session.start_at,
          v_timezone
        ),
        private.reservation_legacy_timestamp_to_timestamptz(
          v_session.end_at,
          v_timezone
        ),
        v_session.party_size,
        v_session.notes,
        p_source,
        p_actor_id,
        v_session.created_at,
        v_session.updated_at
      )
      on conflict (id) do nothing;

      update public.reservation_sessions as session
         set party_size = v_session.party_size,
             notes = v_session.notes
       where session.id = v_session_id
         and session.reservation_id = v_reservation_id
         and session.starts_at = private.reservation_legacy_timestamp_to_timestamptz(
           v_session.start_at,
           v_timezone
         )
         and session.ends_at = private.reservation_legacy_timestamp_to_timestamptz(
           v_session.end_at,
           v_timezone
         )
         and (session.party_size, session.notes)
           is distinct from (v_session.party_size, v_session.notes);

      if not exists (
        select 1
        from public.reservation_sessions as session
        where session.id = v_session_id
          and session.reservation_id = v_reservation_id
          and session.starts_at = private.reservation_legacy_timestamp_to_timestamptz(
            v_session.start_at,
            v_timezone
          )
          and session.ends_at = private.reservation_legacy_timestamp_to_timestamptz(
            v_session.end_at,
            v_timezone
          )
      ) then
        raise exception 'Target Session conflicts with its legacy booking interval';
      end if;

      update public.bookings as booking
         set reservation_id = v_reservation_id,
             session_id = v_session_id
       where booking.booking_group_id = v_group.booking_group_id
         and booking.start_at = v_session.start_at
         and booking.end_at = v_session.end_at
         and (
           booking.reservation_id is null
           or booking.reservation_id = v_reservation_id
         )
         and (booking.reservation_id, booking.session_id)
           is distinct from (v_reservation_id, v_session_id);
    end loop;
  end loop;

  if v_link_id is not null then
    insert into public.reservation_legacy_sources (
      reservation_id, source_type, source_id, created_by, created_at
    ) values (
      v_reservation_id,
      'booking_link',
      v_link_id,
      p_actor_id,
      v_created_at
    )
    on conflict (source_type, source_id) do nothing;

    if not exists (
      select 1
      from public.reservation_legacy_sources as source
      where source.source_type = 'booking_link'
        and source.source_id = v_link_id
        and source.reservation_id = v_reservation_id
    ) then
      raise exception 'Legacy booking link is already mapped to another Reservation';
    end if;
  end if;

  if not exists (
    select 1
    from public.reservation_party_roles as role
    where role.reservation_id = v_reservation_id
      and role.role = 'primary_contact'
  ) then
    select ranked.booking_group_id
      into v_primary_group_id
    from (
      select
        booking.booking_group_id,
        bool_or(
          booking.status in ('held', 'confirmed')
          and (
            booking.status <> 'held'
            or booking.hold_expires_at is null
            or booking.hold_expires_at > statement_timestamp()
          )
        ) as has_active_booking,
        min(booking.created_at) as first_created_at
      from public.bookings as booking
      where booking.booking_group_id = any(v_scope_group_ids)
      group by booking.booking_group_id
    ) as ranked
    order by
      ranked.has_active_booking desc,
      ranked.first_created_at,
      ranked.booking_group_id
    limit 1;

    select party.id
      into v_primary_party_id
    from public.reservation_parties as party
    where party.reservation_id = v_reservation_id
      and party.legacy_booking_group_id = v_primary_group_id;

    insert into public.reservation_party_roles (
      reservation_id, party_id, role, created_by
    ) values (
      v_reservation_id,
      v_primary_party_id,
      'primary_contact',
      p_actor_id
    )
    on conflict do nothing;
  end if;

  if exists (
    select 1
    from public.bookings as booking
    where booking.booking_group_id = any(v_scope_group_ids)
      and (
        booking.reservation_id is distinct from v_reservation_id
        or booking.session_id is null
      )
  ) then
    raise exception 'Reservation catch-up left an incomplete ownership scope';
  end if;

  return v_reservation_id;
end;
$function$;

-- Bounded cursor-based catch-up. It is intentionally private and is not called
-- by this migration. A later activation preflight may run reviewed batches and
-- stop on any relationship or financial mismatch.
create function private.catch_up_reservation_aggregates(
  p_after_group_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_group_id uuid;
  v_last_group_id uuid;
  v_processed integer := 0;
  v_has_more boolean;
  v_operation_id text := 'reservation_phase_3a_catchup:' || txid_current()::text;
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'Catch-up limit must be between 1 and 200';
  end if;

  perform set_config('app.audit_operation_id', v_operation_id, true);
  perform set_config('app.audit_event_type', 'booking.reservation_caught_up', true);
  perform set_config('app.audit_source', 'reservation_phase_3a_catchup', true);

  for v_group_id in
    select source.booking_group_id
    from (
      select distinct booking.booking_group_id
      from public.bookings as booking
      where p_after_group_id is null
         or booking.booking_group_id > p_after_group_id
    ) as source
    order by source.booking_group_id
    limit p_limit
  loop
    perform private.reconcile_legacy_booking_group(
      v_group_id,
      null,
      'system'
    );
    v_processed := v_processed + 1;
    v_last_group_id := v_group_id;
  end loop;

  select exists (
    select 1
    from public.bookings as booking
    where v_last_group_id is not null
      and booking.booking_group_id > v_last_group_id
  ) into v_has_more;

  return jsonb_build_object(
    'schema_version', 1,
    'operation_id', v_operation_id,
    'processed_group_count', v_processed,
    'last_group_id', v_last_group_id,
    'has_more', coalesce(v_has_more, false)
  );
end;
$function$;

-- No customer contact values are exposed. The view contains only internal IDs,
-- mismatch codes, counts, states, and amounts. security_invoker makes all
-- underlying RLS policies apply to the caller; the actor CTE additionally
-- returns zero rows for authenticated non-managers.
create view public.reservation_shadow_mismatches
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
), group_rollup as (
  select
    booking.booking_group_id,
    count(*)::integer as booking_count,
    (count(*) filter (
      where booking.reservation_id is null or booking.session_id is null
    ))::integer as unowned_count,
    (count(distinct booking.reservation_id)
      filter (where booking.reservation_id is not null))::integer
      as reservation_count,
    (array_agg(booking.reservation_id order by booking.reservation_id)
      filter (where booking.reservation_id is not null))[1] as reservation_id,
    count(distinct jsonb_build_array(
      booking.customer_name,
      booking.customer_email,
      booking.customer_phone,
      booking.user_id
    ))::integer as contact_fact_count,
    count(distinct jsonb_build_array(
      booking.booking_link_id,
      booking.recurrence_series_id,
      booking.recurrence_week,
      booking.currency
    ))::integer as relationship_fact_count,
    (array_agg(booking.booking_link_id order by booking.booking_link_id)
      filter (where booking.booking_link_id is not null))[1] as booking_link_id,
    (array_agg(booking.recurrence_series_id order by booking.recurrence_series_id)
      filter (where booking.recurrence_series_id is not null))[1]
      as legacy_recurrence_series_id,
    (min(booking.recurrence_week)
      filter (where booking.recurrence_week is not null))::integer
      as recurrence_week,
    min(booking.customer_name) as customer_name,
    min(booking.customer_email) as customer_email,
    min(booking.customer_phone) as customer_phone,
    (array_agg(booking.user_id order by booking.user_id))[1] as auth_user_id,
    min(booking.currency)::character(3) as currency
  from public.bookings as booking
  cross join actor
  where actor.allowed
  group by booking.booking_group_id
), link_rollup as (
  select
    booking.booking_link_id,
    count(distinct booking.booking_group_id)::integer as group_count,
    (count(*) filter (
      where booking.reservation_id is null or booking.session_id is null
    ))::integer as unowned_count,
    (count(distinct booking.reservation_id)
      filter (where booking.reservation_id is not null))::integer
      as reservation_count,
    (array_agg(booking.reservation_id order by booking.reservation_id)
      filter (where booking.reservation_id is not null))[1] as reservation_id
  from public.bookings as booking
  cross join actor
  where actor.allowed
    and booking.booking_link_id is not null
  group by booking.booking_link_id
), reservation_relationship_rollup as (
  select
    booking.reservation_id,
    count(distinct booking.booking_group_id)::integer as group_count,
    count(distinct jsonb_build_array(booking.booking_link_id))::integer
      as link_fact_count,
    (count(*) filter (where booking.booking_link_id is not null))::integer
      as linked_booking_count
  from public.bookings as booking
  cross join actor
  where actor.allowed
    and booking.reservation_id is not null
  group by booking.reservation_id
), booking_balance as (
  select
    booking.id as booking_id,
    coalesce(sum(entry.amount), 0)::numeric(12,2) as allocated_amount
  from public.bookings as booking
  cross join actor
  left join public.payment_allocation_entries as entry
    on entry.booking_id = booking.id
  where actor.allowed
  group by booking.id
), payment_balance as (
  select
    payment.id as payment_id,
    payment.reservation_id,
    payment.kind,
    payment.status,
    payment.amount,
    coalesce(sum(entry.amount), 0)::numeric(12,2) as allocated_amount
  from public.payments as payment
  cross join actor
  left join public.payment_allocation_entries as entry
    on entry.payment_id = payment.id
  where actor.allowed
  group by
    payment.id,
    payment.reservation_id,
    payment.kind,
    payment.status,
    payment.amount
)
select
  'booking_unowned'::text as mismatch_code,
  booking.reservation_id,
  booking.booking_group_id,
  booking.id as booking_id,
  booking.session_id,
  null::uuid as payment_id,
  jsonb_build_object('ownership_shape', 'missing') as details
from public.bookings as booking
cross join actor
where actor.allowed
  and (booking.reservation_id is null or booking.session_id is null)

union all

select
  'group_aggregate_facts_inconsistent',
  groups.reservation_id,
  groups.booking_group_id,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'booking_count', groups.booking_count,
    'contact_fact_count', groups.contact_fact_count,
    'relationship_fact_count', groups.relationship_fact_count
  )
from group_rollup as groups
where groups.contact_fact_count <> 1
   or groups.relationship_fact_count <> 1

union all

select
  'group_ownership_mismatch',
  groups.reservation_id,
  groups.booking_group_id,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'reservation_count', groups.reservation_count,
    'unowned_count', groups.unowned_count
  )
from group_rollup as groups
where groups.reservation_count <> 1
   or groups.unowned_count <> 0

union all

select
  case when source.id is null
    then 'group_source_missing'
    else 'group_source_mismatch'
  end,
  groups.reservation_id,
  groups.booking_group_id,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object('mapped_reservation_id', source.reservation_id)
from group_rollup as groups
left join public.reservation_legacy_sources as source
  on source.source_type = 'booking_group'
 and source.source_id = groups.booking_group_id
where groups.reservation_count = 1
  and (
    source.id is null
    or source.reservation_id is distinct from groups.reservation_id
  )

union all

select
  case
    when links.reservation_count <> 1 or links.unowned_count <> 0
      then 'link_scope_mismatch'
    when source.id is null
      then 'link_source_missing'
    else 'link_source_mismatch'
  end,
  links.reservation_id,
  null::uuid,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'booking_link_id', links.booking_link_id,
    'group_count', links.group_count,
    'reservation_count', links.reservation_count,
    'unowned_count', links.unowned_count,
    'mapped_reservation_id', source.reservation_id
  )
from link_rollup as links
left join public.reservation_legacy_sources as source
  on source.source_type = 'booking_link'
 and source.source_id = links.booking_link_id
where source.id is null
   or links.reservation_count <> 1
   or links.unowned_count <> 0
   or source.reservation_id is distinct from links.reservation_id

union all

select
  'reservation_relationship_scope_mismatch',
  relationship.reservation_id,
  null::uuid,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'group_count', relationship.group_count,
    'link_fact_count', relationship.link_fact_count,
    'linked_booking_count', relationship.linked_booking_count
  )
from reservation_relationship_rollup as relationship
where relationship.group_count > 1
  and (
    relationship.link_fact_count <> 1
    or relationship.linked_booking_count = 0
  )

union all

select
  'session_projection_mismatch',
  booking.reservation_id,
  booking.booking_group_id,
  booking.id,
  booking.session_id,
  null::uuid,
  jsonb_build_object(
    'session_found', session.id is not null,
    'party_size_matches', session.party_size is not distinct from booking.party_size,
    'notes_match', session.notes is not distinct from booking.customer_notes
  )
from public.bookings as booking
cross join actor
cross join public.venue_settings as settings
left join public.reservation_sessions as session
  on session.id = booking.session_id
 and session.reservation_id = booking.reservation_id
where actor.allowed
  and booking.reservation_id is not null
  and (
    session.id is null
    or booking.start_at is distinct from pg_catalog.timezone(settings.timezone, session.starts_at)
    or booking.end_at is distinct from pg_catalog.timezone(settings.timezone, session.ends_at)
    or booking.party_size is distinct from session.party_size
    or booking.customer_notes is distinct from session.notes
  )

union all

select
  'session_contains_multiple_legacy_groups',
  booking.reservation_id,
  null::uuid,
  null::uuid,
  booking.session_id,
  null::uuid,
  jsonb_build_object(
    'group_count', count(distinct booking.booking_group_id)::integer
  )
from public.bookings as booking
cross join actor
where actor.allowed
  and booking.session_id is not null
group by booking.reservation_id, booking.session_id
having count(distinct booking.booking_group_id) <> 1

union all

select
  'party_snapshot_mismatch',
  groups.reservation_id,
  groups.booking_group_id,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'matching_party_count', count(party.id)::integer
  )
from group_rollup as groups
left join public.reservation_parties as party
  on party.reservation_id = groups.reservation_id
 and party.legacy_booking_group_id = groups.booking_group_id
 and party.display_name is not distinct from groups.customer_name
 and party.email is not distinct from groups.customer_email
 and party.phone is not distinct from groups.customer_phone
 and party.auth_user_id is not distinct from groups.auth_user_id
where groups.reservation_count = 1
group by groups.reservation_id, groups.booking_group_id
having count(party.id) <> 1

union all

select
  'primary_contact_count_mismatch',
  reservation.id,
  null::uuid,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'primary_contact_count', count(role.party_id)::integer
  )
from public.reservations as reservation
cross join actor
join public.bookings as booking
  on booking.reservation_id = reservation.id
left join public.reservation_party_roles as role
  on role.reservation_id = reservation.id
 and role.role = 'primary_contact'
where actor.allowed
group by reservation.id
having count(distinct role.party_id) <> 1

union all

select
  'reservation_currency_mismatch',
  groups.reservation_id,
  groups.booking_group_id,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'legacy_currency', groups.currency,
    'reservation_currency', reservation.currency
  )
from group_rollup as groups
join public.reservations as reservation
  on reservation.id = groups.reservation_id
where reservation.currency is distinct from groups.currency

union all

select
  'reservation_recurrence_mismatch',
  groups.reservation_id,
  groups.booking_group_id,
  null::uuid,
  null::uuid,
  null::uuid,
  jsonb_build_object(
    'legacy_recurrence_series_id', groups.legacy_recurrence_series_id,
    'legacy_recurrence_week', groups.recurrence_week,
    'target_recurrence_series_id', reservation.recurrence_series_id,
    'target_recurrence_sequence', reservation.recurrence_sequence
  )
from group_rollup as groups
join public.reservations as reservation
  on reservation.id = groups.reservation_id
where groups.legacy_recurrence_series_id is not null
  and (
    reservation.recurrence_series_id is null
    or reservation.recurrence_sequence is distinct from groups.recurrence_week
  )

union all

select
  'booking_payment_balance_mismatch',
  booking.reservation_id,
  booking.booking_group_id,
  booking.id,
  booking.session_id,
  null::uuid,
  jsonb_build_object(
    'legacy_payment_status', booking.payment_status,
    'expected_allocated_amount',
      case when booking.payment_status = 'paid'
        then booking.total_amount
        else 0::numeric
      end,
    'actual_allocated_amount', balance.allocated_amount
  )
from public.bookings as booking
cross join actor
join booking_balance as balance on balance.booking_id = booking.id
where actor.allowed
  and balance.allocated_amount is distinct from (
    case when booking.payment_status = 'paid'
      then booking.total_amount
      else 0::numeric
    end
  )

union all

select
  'payment_allocation_balance_mismatch',
  balance.reservation_id,
  null::uuid,
  null::uuid,
  null::uuid,
  balance.payment_id,
  jsonb_build_object(
    'kind', balance.kind,
    'status', balance.status,
    'expected_allocated_amount',
      case
        when balance.status <> 'succeeded' then 0::numeric
        when balance.kind = 'payment' then balance.amount
        else -balance.amount
      end,
    'actual_allocated_amount', balance.allocated_amount
  )
from payment_balance as balance
where balance.allocated_amount is distinct from (
  case
    when balance.status <> 'succeeded' then 0::numeric
    when balance.kind = 'payment' then balance.amount
    else -balance.amount
  end
);

comment on view public.reservation_shadow_mismatches is
  'Phase 3A manager-only, zero-PII shadow comparison. It does not switch any product read path.';

create function public.admin_get_reservation_shadow_status(
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
    'generated_at', statement_timestamp(),
    'status', case when mismatch.total_count = 0 then 'clean' else 'mismatch' end,
    'mismatch_count', mismatch.total_count,
    'mismatch_counts', mismatch.counts,
    'samples', samples.rows,
    'totals', jsonb_build_object(
      'bookings', (select count(*) from public.bookings),
      'owned_bookings', (
        select count(*) from public.bookings
        where reservation_id is not null and session_id is not null
      ),
      'reservations', (select count(*) from public.reservations),
      'sessions', (select count(*) from public.reservation_sessions),
      'parties', (select count(*) from public.reservation_parties),
      'payments', (select count(*) from public.payments),
      'allocation_entries', (
        select count(*) from public.payment_allocation_entries
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
      select mismatch_code, count(*)::integer as mismatch_count
      from public.reservation_shadow_mismatches
      group by mismatch_code
    ) as summary
  ) as mismatch
  cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(sample)), '[]'::jsonb) as rows
    from (
      select
        mismatch_code,
        reservation_id,
        booking_group_id,
        booking_id,
        session_id,
        payment_id,
        details
      from public.reservation_shadow_mismatches
      order by
        mismatch_code,
        reservation_id,
        booking_group_id,
        booking_id,
        session_id,
        payment_id
      limit p_sample_limit
    ) as sample
  ) as samples;

  return v_result;
end;
$function$;

create function private.assert_reservation_shadow_clean()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_count integer;
  v_codes text;
begin
  select count(*)::integer,
         string_agg(distinct mismatch.mismatch_code, ', ' order by mismatch.mismatch_code)
    into v_count, v_codes
  from public.reservation_shadow_mismatches as mismatch;

  if v_count <> 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Reservation shadow reconciliation found %s mismatch rows: %s',
        v_count,
        coalesce(v_codes, '<unknown>')
      );
  end if;
end;
$function$;

-- Explicit exposure is required independently of RLS. The view/function are
-- read-only and manager-gated; all mutation helpers remain private.
revoke all on table public.reservation_shadow_mismatches
  from public, anon, authenticated, service_role;
grant select on table public.reservation_shadow_mismatches
  to authenticated;

revoke all on function public.admin_get_reservation_shadow_status(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_reservation_shadow_status(integer)
  to authenticated;

revoke all on function private.reservation_phase3_uuid(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.reservation_legacy_timestamp_to_timestamptz(timestamp, text)
  from public, anon, authenticated, service_role;
revoke all on function private.preserve_booking_ownership_timestamp()
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_legacy_recurrence_series(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_legacy_booking_group(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.catch_up_reservation_aggregates(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_reservation_shadow_clean()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
