-- Phase 1 of the Reservation migration is additive only.
--
-- The new aggregate and ledger tables remain empty after this migration.
-- Existing booking reads, writes, RPCs, overlap enforcement, Realtime slots,
-- and legacy group/link/recurrence/payment fields continue unchanged.

create table public.recurrence_series (
  id uuid primary key default gen_random_uuid(),
  timezone text not null default 'America/Toronto',
  frequency text not null default 'weekly',
  interval_count smallint not null default 1,
  day_of_week smallint,
  starts_on date not null,
  ends_on date,
  occurrence_count integer,
  source text not null default 'manager',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint recurrence_series_timezone_nonempty_check
    check (nullif(trim(timezone), '') is not null),
  constraint recurrence_series_frequency_check
    check (frequency in ('weekly')),
  constraint recurrence_series_interval_count_check
    check (interval_count between 1 and 52),
  constraint recurrence_series_day_of_week_check
    check (day_of_week is null or day_of_week between 0 and 6),
  constraint recurrence_series_end_check
    check (ends_on is null or ends_on >= starts_on),
  constraint recurrence_series_occurrence_count_check
    check (occurrence_count is null or occurrence_count > 0),
  constraint recurrence_series_end_shape_check
    check (ends_on is null or occurrence_count is null),
  constraint recurrence_series_source_check
    check (source in ('manager', 'customer', 'legacy_migration', 'system'))
);

comment on table public.recurrence_series is
  'A recurrence template that relates otherwise independent Reservations. It is not itself a cross-week Reservation.';

create index recurrence_series_created_by_idx
  on public.recurrence_series (created_by)
  where created_by is not null;

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  reference_number bigint generated always as identity (start with 1000),
  recurrence_series_id uuid references public.recurrence_series(id) on delete restrict,
  recurrence_sequence integer,
  currency character(3) not null default 'CAD',
  notes text,
  payment_plan text not null default 'single_payer',
  source text not null default 'manager',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reservations_reference_number_key unique (reference_number),
  constraint reservations_id_currency_key unique (id, currency),
  constraint reservations_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint reservations_notes_length_check
    check (notes is null or length(notes) <= 4000),
  constraint reservations_payment_plan_check
    check (payment_plan in ('single_payer', 'split_equal', 'split_custom')),
  constraint reservations_source_check
    check (source in ('manager', 'customer', 'legacy_migration', 'system')),
  constraint reservations_recurrence_shape_check
    check (
      (recurrence_series_id is null and recurrence_sequence is null)
      or
      (recurrence_series_id is not null and recurrence_sequence > 0)
    )
);

comment on table public.reservations is
  'Aggregate root for one business reservation. Amount and lifecycle/payment statuses are derived from allocations and the payment ledger.';
comment on column public.reservations.reference_number is
  'Stable manager/customer-facing sequence. The UUID remains the API and relationship identifier.';

create unique index reservations_recurrence_sequence_idx
  on public.reservations (recurrence_series_id, recurrence_sequence)
  where recurrence_series_id is not null;
create index reservations_created_idx
  on public.reservations (created_at desc, id);
create index reservations_created_by_idx
  on public.reservations (created_by)
  where created_by is not null;

create table public.reservation_legacy_sources (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  source_type text not null,
  source_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_legacy_sources_source_check
    check (source_type in ('booking_group', 'booking_link', 'recurrence_series')),
  constraint reservation_legacy_sources_source_key
    unique (source_type, source_id)
);

comment on table public.reservation_legacy_sources is
  'Durable mapping from legacy group/link/recurrence identifiers to a Reservation. Rows may be reassigned during an audited merge but are never physically deleted.';

create index reservation_legacy_sources_reservation_idx
  on public.reservation_legacy_sources (reservation_id, id);
create index reservation_legacy_sources_created_by_idx
  on public.reservation_legacy_sources (created_by)
  where created_by is not null;

create table public.reservation_parties (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  party_type text not null default 'person',
  display_name text not null,
  email text,
  phone text,
  auth_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'manager',
  legacy_booking_group_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reservation_parties_id_reservation_key unique (id, reservation_id),
  constraint reservation_parties_type_check
    check (party_type in ('person', 'organization')),
  constraint reservation_parties_display_name_check
    check (nullif(trim(display_name), '') is not null and length(display_name) <= 200),
  constraint reservation_parties_email_length_check
    check (email is null or length(email) <= 320),
  constraint reservation_parties_phone_length_check
    check (phone is null or length(phone) <= 40),
  constraint reservation_parties_source_check
    check (source in ('manager', 'customer', 'legacy_booking_group', 'import', 'system')),
  constraint reservation_parties_legacy_source_shape_check
    check (
      (source = 'legacy_booking_group' and legacy_booking_group_id is not null)
      or
      (source <> 'legacy_booking_group' and legacy_booking_group_id is null)
    )
);

comment on table public.reservation_parties is
  'Booking-time person or organization snapshots. Matching contact text never implies automatic identity merging.';

create index reservation_parties_reservation_idx
  on public.reservation_parties (reservation_id, created_at, id);
create index reservation_parties_auth_user_idx
  on public.reservation_parties (auth_user_id)
  where auth_user_id is not null;
create index reservation_parties_created_by_idx
  on public.reservation_parties (created_by)
  where created_by is not null;
create unique index reservation_parties_legacy_group_idx
  on public.reservation_parties (reservation_id, legacy_booking_group_id)
  where legacy_booking_group_id is not null;

create table public.reservation_party_roles (
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  party_id uuid not null,
  role text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_party_roles_pkey
    primary key (reservation_id, party_id, role),
  constraint reservation_party_roles_party_fkey
    foreign key (party_id, reservation_id)
    references public.reservation_parties(id, reservation_id)
    on delete restrict,
  constraint reservation_party_roles_role_check
    check (role in ('primary_contact', 'participant', 'original_booker', 'payer'))
);

comment on table public.reservation_party_roles is
  'Reservation-scoped roles. One Party may be a contact, participant, original booker, and/or payer.';

create unique index reservation_party_roles_primary_contact_idx
  on public.reservation_party_roles (reservation_id)
  where role = 'primary_contact';
create index reservation_party_roles_party_idx
  on public.reservation_party_roles (party_id, reservation_id);
create index reservation_party_roles_created_by_idx
  on public.reservation_party_roles (created_by)
  where created_by is not null;

create table public.reservation_sessions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  party_size smallint not null default 2,
  notes text,
  source text not null default 'manager',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reservation_sessions_id_reservation_key unique (id, reservation_id),
  constraint reservation_sessions_interval_check
    check (ends_at > starts_at),
  constraint reservation_sessions_duration_check
    check (ends_at <= starts_at + interval '12 hours'),
  constraint reservation_sessions_party_size_check
    check (party_size between 1 and 8),
  constraint reservation_sessions_notes_length_check
    check (notes is null or length(notes) <= 2000),
  constraint reservation_sessions_source_check
    check (source in ('manager', 'customer', 'legacy_migration', 'system'))
);

comment on table public.reservation_sessions is
  'One actual visit/play session. Sessions in the same Reservation may occur on different dates and have different durations.';

create index reservation_sessions_reservation_start_idx
  on public.reservation_sessions (reservation_id, starts_at, id);
create index reservation_sessions_created_by_idx
  on public.reservation_sessions (created_by)
  where created_by is not null;

-- Keep public.bookings as the physical Court-allocation table during the
-- compatibility phases. Nullable columns avoid a table rewrite or immediate
-- backfill and leave every legacy mutation path unchanged.
alter table public.bookings
  add column reservation_id uuid,
  add column session_id uuid;

alter table public.bookings
  add constraint bookings_id_reservation_key unique (id, reservation_id),
  add constraint bookings_reservation_ownership_shape_check
    check (
      (reservation_id is null and session_id is null)
      or
      (reservation_id is not null and session_id is not null)
    ) not valid,
  add constraint bookings_reservation_currency_fkey
    foreign key (reservation_id, currency)
    references public.reservations(id, currency)
    on delete restrict
    not valid,
  add constraint bookings_session_reservation_fkey
    foreign key (session_id, reservation_id)
    references public.reservation_sessions(id, reservation_id)
    on delete restrict
    not valid;

create index bookings_reservation_start_idx
  on public.bookings (reservation_id, start_at, id)
  where reservation_id is not null;
create index bookings_reservation_currency_idx
  on public.bookings (reservation_id, currency)
  where reservation_id is not null;
create index bookings_session_reservation_idx
  on public.bookings (session_id, reservation_id)
  where session_id is not null;

alter table public.bookings
  validate constraint bookings_reservation_ownership_shape_check;
alter table public.bookings
  validate constraint bookings_reservation_currency_fkey;
alter table public.bookings
  validate constraint bookings_session_reservation_fkey;

comment on column public.bookings.reservation_id is
  'Phase 1 nullable ownership link. Populated only by the later deterministic backfill/dual-write phases.';
comment on column public.bookings.session_id is
  'Phase 1 nullable Session link. This booking row remains the physical Court allocation and overlap projection.';

create table public.reservation_payment_shares (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  party_id uuid not null,
  share_type text not null,
  target_amount numeric(12,2),
  target_percentage numeric(7,4),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reservation_payment_shares_party_fkey
    foreign key (party_id, reservation_id)
    references public.reservation_parties(id, reservation_id)
    on delete restrict,
  constraint reservation_payment_shares_party_key
    unique (reservation_id, party_id),
  constraint reservation_payment_shares_shape_check
    check (
      (share_type = 'equal' and target_amount is null and target_percentage is null)
      or
      (share_type = 'amount' and target_amount > 0 and target_percentage is null)
      or
      (share_type = 'percentage' and target_amount is null
        and target_percentage > 0 and target_percentage <= 100)
    )
);

comment on table public.reservation_payment_shares is
  'Editable payer intent only. These rows never prove that money was received.';

create index reservation_payment_shares_party_idx
  on public.reservation_payment_shares (party_id, reservation_id);
create index reservation_payment_shares_created_by_idx
  on public.reservation_payment_shares (created_by)
  where created_by is not null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  payer_party_id uuid,
  kind text not null default 'payment',
  amount numeric(12,2) not null,
  currency character(3) not null,
  method text not null,
  status text not null default 'pending',
  provider text,
  provider_reference text,
  idempotency_key text not null,
  reverses_payment_id uuid,
  source text not null default 'manager',
  notes text,
  occurred_at timestamptz,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint payments_id_reservation_key unique (id, reservation_id),
  constraint payments_reservation_currency_fkey
    foreign key (reservation_id, currency)
    references public.reservations(id, currency)
    on delete restrict,
  constraint payments_payer_party_fkey
    foreign key (payer_party_id, reservation_id)
    references public.reservation_parties(id, reservation_id)
    on delete restrict,
  constraint payments_reverses_payment_fkey
    foreign key (reverses_payment_id, reservation_id)
    references public.payments(id, reservation_id)
    on delete restrict,
  constraint payments_kind_check
    check (kind in ('payment', 'refund')),
  constraint payments_amount_check
    check (amount > 0),
  constraint payments_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint payments_method_check
    check (method ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint payments_status_check
    check (status in ('pending', 'succeeded', 'failed', 'voided')),
  constraint payments_provider_shape_check
    check (
      (provider is null and provider_reference is null)
      or
      (nullif(trim(provider), '') is not null
        and nullif(trim(provider_reference), '') is not null)
    ),
  constraint payments_idempotency_key_check
    check (length(trim(idempotency_key)) between 1 and 200),
  constraint payments_refund_shape_check
    check (
      (kind = 'refund' and reverses_payment_id is not null)
      or
      (kind = 'payment' and reverses_payment_id is null)
    ),
  constraint payments_source_check
    check (source in ('manager', 'stripe', 'legacy_reconciliation', 'system')),
  constraint payments_occurred_at_shape_check
    check (occurred_at is not null or source = 'legacy_reconciliation'),
  constraint payments_notes_length_check
    check (notes is null or length(notes) <= 2000),
  constraint payments_idempotency_key_key unique (idempotency_key)
);

comment on table public.payments is
  'One real receipt or refund fact. Successful rows are not overwritten by later receipts or refunds.';
comment on column public.payments.occurred_at is
  'Actual payment time when known. Only legacy reconciliation rows may leave it null rather than inventing a historical timestamp.';

create unique index payments_provider_reference_idx
  on public.payments (provider, provider_reference)
  where provider_reference is not null;
create index payments_reservation_occurred_idx
  on public.payments (reservation_id, occurred_at, id);
create index payments_reservation_currency_idx
  on public.payments (reservation_id, currency);
create index payments_payer_party_idx
  on public.payments (payer_party_id, reservation_id)
  where payer_party_id is not null;
create index payments_reverses_payment_idx
  on public.payments (reverses_payment_id, reservation_id)
  where reverses_payment_id is not null;
create index payments_recorded_by_idx
  on public.payments (recorded_by)
  where recorded_by is not null;

create table public.payment_allocation_entries (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  payment_id uuid not null,
  booking_id uuid not null,
  entry_kind text not null default 'allocation',
  amount numeric(12,2) not null,
  reverses_entry_id bigint,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint payment_allocation_entries_id_scope_key
    unique (id, reservation_id, booking_id),
  constraint payment_allocation_entries_payment_fkey
    foreign key (payment_id, reservation_id)
    references public.payments(id, reservation_id)
    on delete restrict,
  constraint payment_allocation_entries_booking_fkey
    foreign key (booking_id, reservation_id)
    references public.bookings(id, reservation_id)
    on delete restrict,
  constraint payment_allocation_entries_reversal_fkey
    foreign key (reverses_entry_id, reservation_id, booking_id)
    references public.payment_allocation_entries(id, reservation_id, booking_id)
    on delete restrict,
  constraint payment_allocation_entries_shape_check
    check (
      (entry_kind = 'allocation' and amount > 0 and reverses_entry_id is null)
      or
      (entry_kind in ('reversal', 'refund') and amount < 0 and reverses_entry_id is not null)
    ),
  constraint payment_allocation_entries_idempotency_key_check
    check (length(trim(idempotency_key)) between 1 and 240),
  constraint payment_allocation_entries_idempotency_key_key
    unique (idempotency_key)
);

comment on table public.payment_allocation_entries is
  'Append-only signed ledger allocating payment value to physical Court allocations. Reversals/refunds add negative entries instead of changing history.';

create index payment_allocation_entries_payment_idx
  on public.payment_allocation_entries (payment_id, reservation_id, id);
create index payment_allocation_entries_booking_idx
  on public.payment_allocation_entries (booking_id, reservation_id, id);
create index payment_allocation_entries_reservation_created_idx
  on public.payment_allocation_entries (reservation_id, created_at, id);
create index payment_allocation_entries_reverses_idx
  on public.payment_allocation_entries (reverses_entry_id, reservation_id, booking_id)
  where reverses_entry_id is not null;
create index payment_allocation_entries_created_by_idx
  on public.payment_allocation_entries (created_by)
  where created_by is not null;

-- If a booking is connected to the target model, keep its legacy local
-- timestamp projection exactly aligned with the Session timestamptz in the
-- configured venue timezone. Rows with null Phase 1 links are untouched.
create function private.enforce_booking_session_projection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text := 'America/Toronto';
begin
  if new.session_id is null and new.reservation_id is null then
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

  if new.start_at is distinct from timezone(v_timezone, v_starts_at)
     or new.end_at is distinct from timezone(v_timezone, v_ends_at) then
    raise exception using
      errcode = '23514',
      constraint = 'bookings_session_time_projection_check',
      message = 'Booking allocation time must match its Session in the venue timezone';
  end if;

  return new;
end;
$$;

create trigger bookings_enforce_session_projection
before insert or update of reservation_id, session_id, start_at, end_at
on public.bookings
for each row execute function private.enforce_booking_session_projection();

-- Legacy mappings and ledger allocations are durable history. Payments allow
-- only a pending -> terminal status transition; refunds are separate rows.
create function private.reject_reservation_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I rows are append-only and cannot be %s', tg_table_name, lower(tg_op));
end;
$$;

create trigger reservation_legacy_sources_no_delete
before delete on public.reservation_legacy_sources
for each row execute function private.reject_reservation_history_mutation();

create trigger payment_allocation_entries_immutable
before update or delete on public.payment_allocation_entries
for each row execute function private.reject_reservation_history_mutation();

create function private.enforce_payment_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Payments cannot be physically deleted';
  end if;

  if new.id is distinct from old.id
     or new.reservation_id is distinct from old.reservation_id
     or new.payer_party_id is distinct from old.payer_party_id
     or new.kind is distinct from old.kind
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.method is distinct from old.method
     or new.provider is distinct from old.provider
     or new.provider_reference is distinct from old.provider_reference
     or new.idempotency_key is distinct from old.idempotency_key
     or new.reverses_payment_id is distinct from old.reverses_payment_id
     or new.source is distinct from old.source
     or new.notes is distinct from old.notes
     or new.occurred_at is distinct from old.occurred_at
     or new.recorded_by is distinct from old.recorded_by
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'Payment facts are immutable; record a compensating payment instead';
  end if;

  if new.status is distinct from old.status
     and not (
       old.status = 'pending'
       and new.status in ('succeeded', 'failed', 'voided')
     ) then
    raise exception using
      errcode = '55000',
      message = 'Invalid payment status transition';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger payments_enforce_immutability
before update or delete on public.payments
for each row execute function private.enforce_payment_immutability();

-- Reuse the existing generic updated_at trigger for mutable non-financial
-- target rows. Payment timestamps are maintained by the stricter trigger.
create trigger recurrence_series_set_updated_at
before update on public.recurrence_series
for each row execute function public.set_updated_at();
create trigger reservations_set_updated_at
before update on public.reservations
for each row execute function public.set_updated_at();
create trigger reservation_parties_set_updated_at
before update on public.reservation_parties
for each row execute function public.set_updated_at();
create trigger reservation_sessions_set_updated_at
before update on public.reservation_sessions
for each row execute function public.set_updated_at();
create trigger reservation_payment_shares_set_updated_at
before update on public.reservation_payment_shares
for each row execute function public.set_updated_at();

-- Every new table is in the exposed public schema, so RLS and privileges are
-- explicit. Authenticated users receive manager-only reads and no generic DML.
alter table public.recurrence_series enable row level security;
alter table public.recurrence_series force row level security;
alter table public.reservations enable row level security;
alter table public.reservations force row level security;
alter table public.reservation_legacy_sources enable row level security;
alter table public.reservation_legacy_sources force row level security;
alter table public.reservation_parties enable row level security;
alter table public.reservation_parties force row level security;
alter table public.reservation_party_roles enable row level security;
alter table public.reservation_party_roles force row level security;
alter table public.reservation_sessions enable row level security;
alter table public.reservation_sessions force row level security;
alter table public.reservation_payment_shares enable row level security;
alter table public.reservation_payment_shares force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.payment_allocation_entries enable row level security;
alter table public.payment_allocation_entries force row level security;

create policy "managers read recurrence series"
on public.recurrence_series for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservations"
on public.reservations for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation legacy sources"
on public.reservation_legacy_sources for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation parties"
on public.reservation_parties for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation party roles"
on public.reservation_party_roles for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation sessions"
on public.reservation_sessions for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation payment shares"
on public.reservation_payment_shares for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read payments"
on public.payments for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read payment allocation entries"
on public.payment_allocation_entries for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));

revoke all on table
  public.recurrence_series,
  public.reservations,
  public.reservation_legacy_sources,
  public.reservation_parties,
  public.reservation_party_roles,
  public.reservation_sessions,
  public.reservation_payment_shares,
  public.payments,
  public.payment_allocation_entries
from public, anon, authenticated, service_role;

grant select on table
  public.recurrence_series,
  public.reservations,
  public.reservation_legacy_sources,
  public.reservation_parties,
  public.reservation_party_roles,
  public.reservation_sessions,
  public.reservation_payment_shares,
  public.payments,
  public.payment_allocation_entries
to authenticated;

revoke all on sequence
  public.reservations_reference_number_seq,
  public.reservation_legacy_sources_id_seq,
  public.payment_allocation_entries_id_seq
from public, anon, authenticated, service_role;

revoke all on function private.enforce_booking_session_projection()
from public, anon, authenticated, service_role;
revoke all on function private.reject_reservation_history_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.enforce_payment_immutability()
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
