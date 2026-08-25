-- Reservation migration Phase 3B.1: inactive transactional kernel.
--
-- This migration is deliberately NOT an activation migration. It adds the
-- append-only relationship lineage, current allocation membership projection,
-- idempotency journal, private mutation primitives, writer inventory guard,
-- and supporting constraints needed by a later Phase 3B.2 activation.
--
-- It does not replace any public writer, invoke catch-up, mutate existing
-- Reservation/booking/payment rows, change the product read path, publish a
-- Realtime table, or retire a legacy field/RPC.

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.reservations') is null
     or to_regclass('public.reservation_sessions') is null
     or to_regclass('public.payment_allocation_entries') is null
     or to_regclass('public.bookings') is null then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.1 requires the Phase 1 Reservation aggregate schema';
  end if;

  if to_regprocedure('private.reconcile_legacy_booking_group(uuid,uuid,text)') is null
     or to_regprocedure('private.reservation_phase3_uuid(text,text)') is null then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.1 requires the Phase 3A compatibility foundation';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid =
      'public.payment_allocation_entries'::regclass
      and constraint_row.conname =
        'payment_allocation_entries_booking_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.bookings'::regclass
      and constraint_row.convalidated
      and constraint_row.conkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = constraint_row.conrelid
            and attribute.attname = 'booking_id'
        ),
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = constraint_row.conrelid
            and attribute.attname = 'reservation_id'
        )
      ]::smallint[]
      and constraint_row.confkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = constraint_row.confrelid
            and attribute.attname = 'id'
        ),
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = constraint_row.confrelid
            and attribute.attname = 'reservation_id'
        )
      ]::smallint[]
  ) then
    raise exception using
      errcode = '55000',
      message = 'Unexpected payment allocation booking scope constraint';
  end if;
end;
$preflight$;

-- One idempotency record covers one logical mutation. A failed mutation rolls
-- this row back with the rest of its transaction, so committed `started` rows
-- are treated as corruption rather than silently resumed.
create table private.reservation_phase3b_operations (
  operation_id text primary key,
  operation_type text not null,
  request_fingerprint text not null,
  status text not null default 'started',
  actor_id uuid references auth.users(id) on delete set null,
  result_entity_id uuid,
  result_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint reservation_phase3b_operations_id_check
    check (
      operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
    ),
  constraint reservation_phase3b_operations_type_check
    check (operation_type in (
      'attach_legacy_groups',
      'reschedule_session',
      'set_booking_status',
      'update_booking_details',
      'record_payment',
      'refund_payment',
      'merge',
      'split',
      'reverse_transition'
    )),
  constraint reservation_phase3b_operations_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  constraint reservation_phase3b_operations_status_check
    check (status in ('started', 'completed')),
  constraint reservation_phase3b_operations_completion_check
    check (
      (status = 'started' and completed_at is null)
      or
      (status = 'completed' and completed_at is not null)
    )
);

comment on table private.reservation_phase3b_operations is
  'Private idempotency journal for the inactive Phase 3B transaction kernel. It is not a client API or a product read model.';

create index reservation_phase3b_operations_actor_idx
  on private.reservation_phase3b_operations (actor_id, created_at)
  where actor_id is not null;

revoke all on table private.reservation_phase3b_operations
from public, anon, authenticated, service_role;

-- Immutable transition headers and normalized edges retain every commercial
-- merge/split/undo fact. The physical booking ownership and old financial rows
-- remain untouched; current effective ownership is a separate projection.
create table public.reservation_transitions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity,
  operation_id text not null,
  transition_type text not null,
  reverses_transition_id uuid references public.reservation_transitions(id)
    on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_transitions_sequence_key unique (sequence),
  constraint reservation_transitions_operation_key unique (operation_id),
  constraint reservation_transitions_operation_fkey
    foreign key (operation_id)
    references private.reservation_phase3b_operations(operation_id)
    on delete restrict,
  constraint reservation_transitions_type_check
    check (transition_type in ('merge', 'split', 'reverse_transition')),
  constraint reservation_transitions_reverse_shape_check
    check (
      (transition_type = 'reverse_transition' and reverses_transition_id is not null)
      or
      (transition_type <> 'reverse_transition' and reverses_transition_id is null)
    )
);

create unique index reservation_transitions_reverse_once_idx
  on public.reservation_transitions (reverses_transition_id)
  where reverses_transition_id is not null;
create index reservation_transitions_actor_idx
  on public.reservation_transitions (actor_id, created_at, id)
  where actor_id is not null;

comment on table public.reservation_transitions is
  'Append-only commercial merge/split/undo headers. Allocation membership changes are recorded in child rows and never rewrite historical payment facts.';

create table public.reservation_transition_sources (
  transition_id uuid not null references public.reservation_transitions(id)
    on delete restrict,
  reservation_id uuid not null references public.reservations(id)
    on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_transition_sources_pkey
    primary key (transition_id, reservation_id)
);

create index reservation_transition_sources_reservation_idx
  on public.reservation_transition_sources (reservation_id, transition_id);

create table public.reservation_transition_targets (
  transition_id uuid not null references public.reservation_transitions(id)
    on delete restrict,
  reservation_id uuid not null references public.reservations(id)
    on delete restrict,
  primary_party_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_transition_targets_pkey
    primary key (transition_id, reservation_id),
  constraint reservation_transition_targets_primary_party_fkey
    foreign key (primary_party_id, reservation_id)
    references public.reservation_parties(id, reservation_id)
    on delete restrict
);

create index reservation_transition_targets_reservation_idx
  on public.reservation_transition_targets (reservation_id, transition_id);
create index reservation_transition_targets_primary_party_idx
  on public.reservation_transition_targets (primary_party_id, reservation_id);

create table public.reservation_transition_allocations (
  transition_id uuid not null references public.reservation_transitions(id)
    on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  from_reservation_id uuid not null,
  from_session_id uuid not null,
  to_reservation_id uuid not null,
  to_session_id uuid not null,
  legacy_link_before uuid,
  legacy_link_after uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_transition_allocations_pkey
    primary key (transition_id, booking_id),
  constraint reservation_transition_allocations_source_fkey
    foreign key (transition_id, from_reservation_id)
    references public.reservation_transition_sources(
      transition_id,
      reservation_id
    ) on delete restrict,
  constraint reservation_transition_allocations_target_fkey
    foreign key (transition_id, to_reservation_id)
    references public.reservation_transition_targets(
      transition_id,
      reservation_id
    ) on delete restrict,
  constraint reservation_transition_allocations_from_session_fkey
    foreign key (from_session_id, from_reservation_id)
    references public.reservation_sessions(id, reservation_id)
    on delete restrict,
  constraint reservation_transition_allocations_to_session_fkey
    foreign key (to_session_id, to_reservation_id)
    references public.reservation_sessions(id, reservation_id)
    on delete restrict,
  constraint reservation_transition_allocations_move_check
    check (from_reservation_id <> to_reservation_id)
);

create index reservation_transition_allocations_booking_idx
  on public.reservation_transition_allocations (
    booking_id,
    created_at,
    transition_id
  );
create index reservation_transition_allocations_source_scope_idx
  on public.reservation_transition_allocations (
    transition_id,
    from_reservation_id,
    booking_id
  );
create index reservation_transition_allocations_target_scope_idx
  on public.reservation_transition_allocations (
    transition_id,
    to_reservation_id,
    booking_id
  );
create index reservation_transition_allocations_from_idx
  on public.reservation_transition_allocations (
    from_reservation_id,
    from_session_id,
    transition_id
  );
create index reservation_transition_allocations_to_idx
  on public.reservation_transition_allocations (
    to_reservation_id,
    to_session_id,
    transition_id
  );

comment on table public.reservation_transition_allocations is
  'Append-only mapping of each physical Court allocation from one effective Reservation/Session to another. bookings.reservation_id remains the immutable historical origin.';

create table public.reservation_transition_parties (
  transition_id uuid not null references public.reservation_transitions(id)
    on delete restrict,
  source_reservation_id uuid not null,
  source_party_id uuid not null,
  target_reservation_id uuid not null,
  target_party_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint reservation_transition_parties_pkey
    primary key (transition_id, source_party_id, target_party_id),
  constraint reservation_transition_parties_source_scope_fkey
    foreign key (transition_id, source_reservation_id)
    references public.reservation_transition_sources(
      transition_id,
      reservation_id
    ) on delete restrict,
  constraint reservation_transition_parties_target_scope_fkey
    foreign key (transition_id, target_reservation_id)
    references public.reservation_transition_targets(
      transition_id,
      reservation_id
    ) on delete restrict,
  constraint reservation_transition_parties_source_party_fkey
    foreign key (source_party_id, source_reservation_id)
    references public.reservation_parties(id, reservation_id)
    on delete restrict,
  constraint reservation_transition_parties_target_party_fkey
    foreign key (target_party_id, target_reservation_id)
    references public.reservation_parties(id, reservation_id)
    on delete restrict,
  constraint reservation_transition_parties_distinct_check
    check (source_party_id <> target_party_id)
);

create index reservation_transition_parties_source_idx
  on public.reservation_transition_parties (
    source_party_id,
    source_reservation_id,
    transition_id
  );
create index reservation_transition_parties_source_scope_idx
  on public.reservation_transition_parties (
    transition_id,
    source_reservation_id,
    source_party_id
  );
create index reservation_transition_parties_target_scope_idx
  on public.reservation_transition_parties (
    transition_id,
    target_reservation_id,
    target_party_id
  );
create index reservation_transition_parties_target_idx
  on public.reservation_transition_parties (
    target_party_id,
    target_reservation_id,
    transition_id
  );

-- This is the only mutable Phase 3B relation. It is a rebuildable current-state
-- projection backed by immutable transition rows. Rows are created lazily by
-- private helpers, so applying this migration performs no production catch-up.
create table public.reservation_allocation_memberships (
  booking_id uuid primary key,
  origin_reservation_id uuid not null,
  effective_reservation_id uuid not null,
  effective_session_id uuid not null,
  last_transition_id uuid references public.reservation_transitions(id)
    on delete restrict,
  version integer not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reservation_allocation_memberships_origin_fkey
    foreign key (booking_id, origin_reservation_id)
    references public.bookings(id, reservation_id)
    on delete restrict,
  constraint reservation_allocation_memberships_effective_session_fkey
    foreign key (effective_session_id, effective_reservation_id)
    references public.reservation_sessions(id, reservation_id)
    on delete restrict,
  constraint reservation_allocation_memberships_version_check
    check (version >= 0),
  constraint reservation_allocation_memberships_transition_shape_check
    check (
      (version = 0 and last_transition_id is null
        and origin_reservation_id = effective_reservation_id)
      or
      (version > 0 and last_transition_id is not null)
    )
);

create index reservation_allocation_memberships_effective_idx
  on public.reservation_allocation_memberships (
    effective_reservation_id,
    effective_session_id,
    booking_id
  );
create index reservation_allocation_memberships_session_idx
  on public.reservation_allocation_memberships (
    effective_session_id,
    booking_id
  );
create index reservation_allocation_memberships_origin_idx
  on public.reservation_allocation_memberships (
    origin_reservation_id,
    booking_id
  );
create index reservation_allocation_memberships_transition_idx
  on public.reservation_allocation_memberships (
    last_transition_id,
    booking_id
  ) where last_transition_id is not null;

comment on table public.reservation_allocation_memberships is
  'Rebuildable current effective Reservation/Session for a physical booking. Initial rows are lazy; immutable transition rows remain the source of relationship history.';

-- Existing ledger history stays byte-for-byte unchanged. Future allocations
-- may point at a booking whose physical origin differs from the Payment's
-- current effective Reservation; private kernel validation enforces membership.
alter table public.payment_allocation_entries
  drop constraint payment_allocation_entries_booking_fkey;

alter table public.payment_allocation_entries
  add constraint payment_allocation_entries_booking_fkey
  foreign key (booking_id)
  references public.bookings(id)
  on delete restrict
  not valid;

alter table public.payment_allocation_entries
  validate constraint payment_allocation_entries_booking_fkey;

comment on column public.payment_allocation_entries.reservation_id is
  'Commercial/effective Reservation that owns the Payment. The physical booking may retain a different immutable origin after an audited transition.';

-- Record the exact activation surface without touching it. The later guard
-- discovers direct writers from function bodies and compares them to this list.
create table private.reservation_phase3b_writer_inventory (
  signature text primary key,
  writer_kind text not null,
  category text not null,
  constraint reservation_phase3b_writer_inventory_kind_check
    check (writer_kind in ('direct', 'wrapper', 'undeployed_edge'))
);

insert into private.reservation_phase3b_writer_inventory (
  signature,
  writer_kind,
  category
) values
  ('public.admin_cancel_booking(uuid)', 'direct', 'cancel'),
  ('public.admin_create_multi_booking(uuid[],timestamp without time zone,timestamp without time zone,text,text,smallint,text,text)', 'direct', 'create'),
  ('public.admin_create_multi_booking_with_price(uuid[],timestamp without time zone,timestamp without time zone,text,text,smallint,text,text,numeric)', 'direct', 'create'),
  ('public.admin_create_weekly_booking(uuid[],timestamp without time zone,timestamp without time zone,smallint,text,text,smallint,text,text)', 'direct', 'create'),
  ('public.admin_create_weekly_booking_with_price(uuid[],timestamp without time zone,timestamp without time zone,smallint,text,text,smallint,text,text,numeric)', 'direct', 'create'),
  ('public.admin_link_booking_groups(uuid,uuid)', 'direct', 'merge_split'),
  ('public.admin_mark_booking_paid(uuid,text)', 'direct', 'payment'),
  ('public.admin_move_booking_group(uuid,uuid,timestamp without time zone,timestamp without time zone)', 'direct', 'schedule'),
  ('public.admin_reschedule_booking(uuid,uuid,timestamp without time zone,timestamp without time zone)', 'direct', 'schedule'),
  ('public.admin_reschedule_booking_group(uuid,timestamp without time zone,timestamp without time zone)', 'direct', 'schedule'),
  ('public.admin_revert_audit_operation(text)', 'direct', 'undo'),
  ('public.admin_swap_booking_schedule(uuid,uuid,timestamp without time zone)', 'direct', 'schedule'),
  ('public.admin_undo_booking_change(uuid)', 'direct', 'undo'),
  ('public.admin_unlink_booking_group(uuid)', 'direct', 'merge_split'),
  ('public.admin_update_booking_details(uuid,text,text,text,text,public.payment_status)', 'direct', 'details'),
  ('public.cancel_booking(uuid)', 'direct', 'cancel'),
  ('public.create_multi_booking(uuid[],timestamp without time zone,timestamp without time zone,text,text,smallint,public.payment_method)', 'direct', 'create'),
  ('public.admin_create_booking(uuid,timestamp without time zone,timestamp without time zone,text,text,smallint,text,text)', 'wrapper', 'create'),
  ('public.admin_undo_last_booking_action()', 'wrapper', 'undo'),
  ('public.create_booking(uuid,timestamp without time zone,timestamp without time zone,text,text,smallint,public.payment_method)', 'wrapper', 'create'),
  ('edge:create-checkout:bookings.stripe_checkout_session_id', 'undeployed_edge', 'stripe'),
  ('edge:stripe-webhook:bookings.status/payment_status/stripe_payment_intent_id/hold_expires_at', 'undeployed_edge', 'stripe');

revoke all on table private.reservation_phase3b_writer_inventory
from public, anon, authenticated, service_role;

-- Exposed-schema transition tables are manager-readable only and have no
-- generic DML grants. RLS and explicit privileges are separate controls.
alter table public.reservation_transitions enable row level security;
alter table public.reservation_transitions force row level security;
alter table public.reservation_transition_sources enable row level security;
alter table public.reservation_transition_sources force row level security;
alter table public.reservation_transition_targets enable row level security;
alter table public.reservation_transition_targets force row level security;
alter table public.reservation_transition_allocations enable row level security;
alter table public.reservation_transition_allocations force row level security;
alter table public.reservation_transition_parties enable row level security;
alter table public.reservation_transition_parties force row level security;
alter table public.reservation_allocation_memberships enable row level security;
alter table public.reservation_allocation_memberships force row level security;

create policy "managers read reservation transitions"
on public.reservation_transitions for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation transition sources"
on public.reservation_transition_sources for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation transition targets"
on public.reservation_transition_targets for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation transition allocations"
on public.reservation_transition_allocations for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation transition parties"
on public.reservation_transition_parties for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));
create policy "managers read reservation allocation memberships"
on public.reservation_allocation_memberships for select to authenticated
using ((select exists (
  select 1 from public.staff_members as staff
  where staff.user_id = (select auth.uid()) and staff.role = 'admin'
)));

revoke all on table
  public.reservation_transitions,
  public.reservation_transition_sources,
  public.reservation_transition_targets,
  public.reservation_transition_allocations,
  public.reservation_transition_parties,
  public.reservation_allocation_memberships
from public, anon, authenticated, service_role;

grant select on table
  public.reservation_transitions,
  public.reservation_transition_sources,
  public.reservation_transition_targets,
  public.reservation_transition_allocations,
  public.reservation_transition_parties,
  public.reservation_allocation_memberships
to authenticated;

revoke all on sequence public.reservation_transitions_sequence_seq
from public, anon, authenticated, service_role;

create trigger reservation_transitions_immutable
before update or delete on public.reservation_transitions
for each row execute function private.reject_reservation_history_mutation();
create trigger reservation_transition_sources_immutable
before update or delete on public.reservation_transition_sources
for each row execute function private.reject_reservation_history_mutation();
create trigger reservation_transition_targets_immutable
before update or delete on public.reservation_transition_targets
for each row execute function private.reject_reservation_history_mutation();
create trigger reservation_transition_allocations_immutable
before update or delete on public.reservation_transition_allocations
for each row execute function private.reject_reservation_history_mutation();
create trigger reservation_transition_parties_immutable
before update or delete on public.reservation_transition_parties
for each row execute function private.reject_reservation_history_mutation();

create function private.enforce_reservation_phase3b_operation_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'started'
       or new.completed_at is not null
       or new.result_entity_id is not null
       or new.result_payload <> '{}'::jsonb then
      raise exception using
        errcode = '55000',
        message = 'Phase 3B operation must begin in the started state';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B operation rows cannot be deleted';
  end if;

  if new.operation_id is distinct from old.operation_id
     or new.operation_type is distinct from old.operation_type
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.actor_id is distinct from old.actor_id
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B operation identity is immutable';
  end if;

  if old.status <> 'started'
     or new.status <> 'completed'
     or old.completed_at is not null
     or new.completed_at is null then
    raise exception using
      errcode = '55000',
      message = 'Invalid Phase 3B operation completion transition';
  end if;

  return new;
end;
$function$;

create trigger reservation_phase3b_operations_immutable
before insert or update or delete on private.reservation_phase3b_operations
for each row execute function
  private.enforce_reservation_phase3b_operation_immutability();

create function private.enforce_reservation_allocation_membership_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.version <> 0
       or new.last_transition_id is not null
       or not exists (
         select 1
         from public.bookings as booking
         where booking.id = new.booking_id
           and booking.reservation_id = new.origin_reservation_id
           and booking.reservation_id = new.effective_reservation_id
           and booking.session_id = new.effective_session_id
       ) then
      raise exception using
        errcode = '55000',
        message = 'Initial membership must match physical booking ownership';
    end if;

    new.updated_at := statement_timestamp();
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Reservation allocation membership rows cannot be deleted';
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.origin_reservation_id is distinct from old.origin_reservation_id
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'Reservation allocation origin is immutable';
  end if;

  if new.version <> old.version + 1
     or new.last_transition_id is null
     or new.last_transition_id is not distinct from old.last_transition_id
     or new.effective_reservation_id is not distinct from old.effective_reservation_id
     or not exists (
       select 1
       from public.reservation_transitions as next_transition
       where next_transition.id = new.last_transition_id
         and (
           old.last_transition_id is null
           or next_transition.sequence > (
             select previous_transition.sequence
             from public.reservation_transitions as previous_transition
             where previous_transition.id = old.last_transition_id
           )
         )
     )
     or not exists (
       select 1
       from public.reservation_transition_allocations as allocation
       where allocation.transition_id = new.last_transition_id
         and allocation.booking_id = new.booking_id
         and allocation.from_reservation_id = old.effective_reservation_id
         and allocation.from_session_id = old.effective_session_id
         and allocation.to_reservation_id = new.effective_reservation_id
         and allocation.to_session_id = new.effective_session_id
     ) then
    raise exception using
      errcode = '55000',
      message = 'Membership updates require one new immutable Reservation transition';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$function$;

create trigger reservation_allocation_memberships_guard
before insert or update or delete on public.reservation_allocation_memberships
for each row execute function
  private.enforce_reservation_allocation_membership_update();

create function private.reservation_phase3b_request_fingerprint(
  p_request jsonb
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select md5(p_request::text)
$function$;

create function private.reservation_phase3b_claim_operation(
  p_operation_id text,
  p_operation_type text,
  p_request_fingerprint text,
  p_actor_id uuid
)
returns table (
  already_completed boolean,
  result_entity_id uuid,
  result_payload jsonb
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_operation private.reservation_phase3b_operations%rowtype;
begin
  if p_operation_id is null
     or p_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' then
    raise exception using
      errcode = '22023',
      message = 'Phase 3B operation_id must be an opaque 1 to 200 character key';
  end if;

  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('statement_timeout', '30s', true);
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'reservation-phase3b-operation:' || p_operation_id,
      0
    )
  );

  insert into private.reservation_phase3b_operations (
    operation_id,
    operation_type,
    request_fingerprint,
    actor_id
  ) values (
    p_operation_id,
    p_operation_type,
    p_request_fingerprint,
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  select operation.*
    into v_operation
  from private.reservation_phase3b_operations as operation
  where operation.operation_id = p_operation_id
  for update;

  if v_operation.operation_type is distinct from p_operation_type
     or v_operation.request_fingerprint is distinct from p_request_fingerprint
     or v_operation.actor_id is distinct from p_actor_id then
    raise exception using
      errcode = '23505',
      message = 'Phase 3B idempotency key was reused with a different request';
  end if;

  if v_operation.status = 'started'
     and v_operation.created_at < statement_timestamp() then
    raise exception using
      errcode = '55000',
      message = 'Committed incomplete Phase 3B operation requires investigation';
  end if;

  return query select
    v_operation.status = 'completed',
    v_operation.result_entity_id,
    v_operation.result_payload;
end;
$function$;

create function private.reservation_phase3b_complete_operation(
  p_operation_id text,
  p_result_entity_id uuid,
  p_result_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update private.reservation_phase3b_operations
     set status = 'completed',
         result_entity_id = p_result_entity_id,
         result_payload = coalesce(p_result_payload, '{}'::jsonb),
         completed_at = statement_timestamp()
   where operation_id = p_operation_id
     and status = 'started';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B operation was not in a completable state';
  end if;
end;
$function$;

create function private.reservation_phase3b_audit(
  p_operation_id text,
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  insert into private.app_audit_events (
    operation_id,
    event_type,
    entity_type,
    entity_id,
    actor_id,
    actor_kind,
    source,
    changed_fields,
    metadata
  ) values (
    p_operation_id,
    p_event_type,
    p_entity_type,
    p_entity_id,
    p_actor_id,
    case when p_actor_id is null then 'system' else 'manager' end,
    'reservation_phase3b_kernel',
    '{}'::text[],
    jsonb_build_object('schema_version', 2, 'inactive_kernel', true)
      || coalesce(p_metadata, '{}'::jsonb)
  )
$function$;

-- Advisory locks serialize all future kernel operations that touch the same
-- physical booking. Row locks then follow the global Reservation -> Session ->
-- booking -> membership order.
create function private.reservation_phase3b_lock_allocations(
  p_booking_ids uuid[],
  p_additional_reservation_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_booking_id uuid;
  v_normalized uuid[];
  v_additional_reservation_ids uuid[];
  v_reservation_ids uuid[];
  v_session_ids uuid[];
begin
  select array_agg(distinct booking_id order by booking_id)
    into v_normalized
  from unnest(p_booking_ids) as booking_id;

  if coalesce(cardinality(v_normalized), 0) = 0
     or v_normalized is distinct from p_booking_ids
     or array_position(v_normalized, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Booking scope must be a non-empty, sorted, distinct UUID array';
  end if;

  select coalesce(array_agg(distinct reservation_id order by reservation_id), '{}'::uuid[])
    into v_additional_reservation_ids
  from unnest(p_additional_reservation_ids) as reservation_id;

  if v_additional_reservation_ids is distinct from p_additional_reservation_ids
     or array_position(v_additional_reservation_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Additional Reservation locks must be a sorted, distinct UUID array';
  end if;

  foreach v_booking_id in array v_normalized loop
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'reservation-phase3b-booking:' || v_booking_id::text,
        0
      )
    );
  end loop;

  insert into public.reservation_allocation_memberships (
    booking_id,
    origin_reservation_id,
    effective_reservation_id,
    effective_session_id
  )
  select
    booking.id,
    booking.reservation_id,
    booking.reservation_id,
    booking.session_id
  from public.bookings as booking
  where booking.id = any(v_normalized)
    and booking.reservation_id is not null
    and booking.session_id is not null
  order by booking.id
  on conflict (booking_id) do nothing;

  if (
    select count(*)
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_normalized)
  ) <> cardinality(v_normalized) then
    raise exception using
      errcode = '23503',
      message = 'Every Phase 3B booking must already have Reservation ownership';
  end if;

  select array_agg(distinct reservation_id order by reservation_id)
    into v_reservation_ids
  from (
    select membership.origin_reservation_id as reservation_id
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_normalized)
    union
    select membership.effective_reservation_id
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_normalized)
    union
    select reservation_id
    from unnest(v_additional_reservation_ids) as reservation_id
  ) as scope;

  if (
    select count(*)
    from public.reservations as reservation
    where reservation.id = any(v_reservation_ids)
  ) <> cardinality(v_reservation_ids) then
    raise exception using
      errcode = '23503',
      message = 'A Reservation requested for locking was not found';
  end if;

  perform reservation.id
  from public.reservations as reservation
  where reservation.id = any(v_reservation_ids)
  order by reservation.id
  for update;

  select array_agg(distinct session_id order by session_id)
    into v_session_ids
  from (
    select booking.session_id
    from public.bookings as booking
    where booking.id = any(v_normalized)
    union
    select membership.effective_session_id
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_normalized)
  ) as scope;

  perform session.id
  from public.reservation_sessions as session
  where session.id = any(v_session_ids)
  order by session.id
  for update;

  perform booking.id
  from public.bookings as booking
  where booking.id = any(v_normalized)
  order by booking.id
  for update;

  perform membership.booking_id
  from public.reservation_allocation_memberships as membership
  where membership.booking_id = any(v_normalized)
  order by membership.booking_id
  for update;
end;
$function$;

create function private.reservation_phase3b_attach_legacy_groups(
  p_booking_group_ids uuid[],
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_groups uuid[];
  v_group_id uuid;
  v_reservation_ids uuid[];
  v_booking_ids uuid[];
  v_request jsonb;
  v_claim record;
begin
  select array_agg(distinct group_id order by group_id)
    into v_groups
  from unnest(p_booking_group_ids) as group_id;

  if coalesce(cardinality(v_groups), 0) = 0
     or v_groups is distinct from p_booking_group_ids
     or array_position(v_groups, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Legacy booking groups must be a sorted, distinct UUID array';
  end if;

  v_request := jsonb_build_object('booking_group_ids', v_groups);
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'attach_legacy_groups',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    select array_agg(value::uuid order by value::uuid)
      into v_reservation_ids
    from jsonb_array_elements_text(
      coalesce(v_claim.result_payload -> 'reservation_ids', '[]'::jsonb)
    ) as value;
    return coalesce(v_reservation_ids, '{}'::uuid[]);
  end if;

  perform pg_catalog.set_config(
    'app.audit_operation_id',
    p_operation_id,
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  foreach v_group_id in array v_groups loop
    perform private.reconcile_legacy_booking_group(
      v_group_id,
      p_actor_id,
      'system'
    );
  end loop;

  select array_agg(booking.id order by booking.id)
    into v_booking_ids
  from public.bookings as booking
  where booking.booking_group_id = any(v_groups);

  perform private.reservation_phase3b_lock_allocations(v_booking_ids);

  select array_agg(distinct membership.effective_reservation_id
      order by membership.effective_reservation_id)
    into v_reservation_ids
  from public.reservation_allocation_memberships as membership
  where membership.booking_id = any(v_booking_ids);

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.aggregate_attached',
    'reservation',
    null,
    p_actor_id,
    jsonb_build_object(
      'booking_group_count', cardinality(v_groups),
      'reservation_count', cardinality(v_reservation_ids)
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    case when cardinality(v_reservation_ids) = 1
      then v_reservation_ids[1]
      else null
    end,
    jsonb_build_object('reservation_ids', to_jsonb(v_reservation_ids))
  );
  return v_reservation_ids;
end;
$function$;

create function private.reservation_phase3b_reschedule_session(
  p_session_id uuid,
  p_new_starts_at timestamptz,
  p_new_ends_at timestamptz,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_booking_ids uuid[];
  v_locked_booking_ids uuid[];
  v_request jsonb;
  v_claim record;
  v_session public.reservation_sessions%rowtype;
  v_origin_reservation_id uuid;
  v_projection_session_id uuid;
  v_timezone text;
begin
  if p_new_ends_at <= p_new_starts_at
     or p_new_ends_at > p_new_starts_at + interval '12 hours' then
    raise exception using
      errcode = '22023',
      message = 'Session interval must be positive and no longer than 12 hours';
  end if;

  select session.*
    into v_session
  from public.reservation_sessions as session
  where session.id = p_session_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Reservation Session was not found';
  end if;

  select array_agg(booking.id order by booking.id)
    into v_booking_ids
  from public.bookings as booking
  left join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where coalesce(membership.effective_session_id, booking.session_id) = p_session_id;

  if coalesce(cardinality(v_booking_ids), 0) = 0 then
    raise exception using
      errcode = '55000',
      message = 'Cannot reschedule a Session without effective Court allocations';
  end if;

  v_request := jsonb_build_object(
    'session_id', p_session_id,
    'new_starts_at', p_new_starts_at,
    'new_ends_at', p_new_ends_at
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'reschedule_session',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'booking_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(v_booking_ids);

  select array_agg(booking.id order by booking.id)
    into v_locked_booking_ids
  from public.bookings as booking
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where membership.effective_session_id = p_session_id;

  if v_locked_booking_ids is distinct from v_booking_ids then
    raise exception using
      errcode = '40001',
      message = 'Effective Session membership changed while acquiring locks';
  end if;

  select session.*
    into v_session
  from public.reservation_sessions as session
  where session.id = p_session_id;

  select coalesce(nullif(trim(settings.timezone), ''), 'America/Toronto')
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;

  update public.reservation_sessions
     set starts_at = p_new_starts_at,
         ends_at = p_new_ends_at
   where id = p_session_id;

  perform pg_catalog.set_config(
    'app.audit_operation_id',
    p_operation_id,
    true
  );
  perform pg_catalog.set_config(
    'app.audit_event_type',
    'booking.rescheduled',
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  for v_origin_reservation_id in
    select distinct membership.origin_reservation_id
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_booking_ids)
    order by membership.origin_reservation_id
  loop
    if v_origin_reservation_id = v_session.reservation_id
       and not exists (
         select 1
         from public.bookings as booking
         where booking.session_id = p_session_id
           and not (booking.id = any(v_booking_ids))
       ) then
      v_projection_session_id := p_session_id;
    else
      v_projection_session_id := private.reservation_phase3_uuid(
        'session',
        'phase3b-schedule:' || p_operation_id
          || ':origin-reservation:' || v_origin_reservation_id::text
      );

      insert into public.reservation_sessions (
        id,
        reservation_id,
        starts_at,
        ends_at,
        party_size,
        notes,
        source,
        created_by
      ) values (
        v_projection_session_id,
        v_origin_reservation_id,
        p_new_starts_at,
        p_new_ends_at,
        v_session.party_size,
        v_session.notes,
        'system',
        p_actor_id
      );
    end if;

    update public.bookings as booking
       set session_id = v_projection_session_id,
           start_at = pg_catalog.timezone(v_timezone, p_new_starts_at),
           end_at = pg_catalog.timezone(v_timezone, p_new_ends_at)
     where booking.id = any(v_booking_ids)
       and booking.reservation_id = v_origin_reservation_id;
  end loop;

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.session_rescheduled',
    'reservation_session',
    p_session_id::text,
    p_actor_id,
    jsonb_build_object('booking_count', cardinality(v_booking_ids))
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    p_session_id,
    jsonb_build_object('booking_count', cardinality(v_booking_ids))
  );
  return cardinality(v_booking_ids);
end;
$function$;

create function private.reservation_phase3b_set_booking_status(
  p_booking_ids uuid[],
  p_status public.booking_status,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
begin
  if p_status not in ('confirmed', 'cancelled', 'no_show') then
    raise exception using
      errcode = '22023',
      message = 'Phase 3B status primitive only supports confirmed, cancelled, or no_show';
  end if;

  v_request := jsonb_build_object(
    'booking_ids', p_booking_ids,
    'status', p_status
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'set_booking_status',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'booking_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(p_booking_ids);
  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config(
    'app.audit_event_type',
    case when p_status = 'cancelled'
      then 'booking.cancelled'
      else 'booking.status_updated'
    end,
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  update public.bookings as booking
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled'
           then coalesce(booking.cancelled_at, statement_timestamp())
           else null
         end
   where booking.id = any(p_booking_ids);

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.booking_status_updated',
    'reservation',
    null,
    p_actor_id,
    jsonb_build_object(
      'booking_count', cardinality(p_booking_ids),
      'status', p_status
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    null,
    jsonb_build_object('booking_count', cardinality(p_booking_ids))
  );
  return cardinality(p_booking_ids);
end;
$function$;

create function private.reservation_phase3b_update_booking_details(
  p_booking_ids uuid[],
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_notes text,
  p_party_size smallint,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
  v_effective_session_ids uuid[];
  v_effective_reservation_ids uuid[];
  v_group_ids uuid[];
begin
  if nullif(trim(p_customer_name), '') is null
     or length(p_customer_name) > 200
     or p_party_size not between 1 and 8 then
    raise exception using
      errcode = '22023',
      message = 'Customer name and party size are invalid';
  end if;

  v_request := jsonb_build_object(
    'booking_ids', p_booking_ids,
    'customer_name_hash', md5(p_customer_name),
    'customer_email_hash', md5(coalesce(p_customer_email, '')),
    'customer_phone_hash', md5(coalesce(p_customer_phone, '')),
    'customer_notes_hash', md5(coalesce(p_customer_notes, '')),
    'party_size', p_party_size
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'update_booking_details',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return coalesce((v_claim.result_payload ->> 'booking_count')::integer, 0);
  end if;

  perform private.reservation_phase3b_lock_allocations(p_booking_ids);

  select
    array_agg(distinct membership.effective_session_id
      order by membership.effective_session_id),
    array_agg(distinct membership.effective_reservation_id
      order by membership.effective_reservation_id),
    array_agg(distinct booking.booking_group_id
      order by booking.booking_group_id)
    into v_effective_session_ids, v_effective_reservation_ids, v_group_ids
  from public.reservation_allocation_memberships as membership
  join public.bookings as booking on booking.id = membership.booking_id
  where membership.booking_id = any(p_booking_ids);

  if exists (
    select 1
    from public.reservation_allocation_memberships as membership
    where membership.effective_session_id = any(v_effective_session_ids)
      and not (membership.booking_id = any(p_booking_ids))
  ) then
    raise exception using
      errcode = '22023',
      message = 'Booking detail scope must include every allocation in each affected Session';
  end if;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config(
    'app.audit_event_type',
    'booking.details_updated',
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  update public.reservations as reservation
     set notes = p_customer_notes
   where reservation.id = any(v_effective_reservation_ids);

  update public.reservation_sessions as session
     set party_size = p_party_size,
         notes = p_customer_notes
   where session.id = any(v_effective_session_ids);

  update public.bookings as booking
     set customer_name = trim(p_customer_name),
         customer_email = nullif(trim(p_customer_email), ''),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_notes = p_customer_notes,
         party_size = p_party_size
   where booking.id = any(p_booking_ids);

  -- Keep the original legacy Party snapshot and every current transition copy
  -- of that same person aligned. This deliberately follows explicit Party
  -- lineage instead of matching mutable contact text, so a merged spouse or
  -- teammate is not changed merely because they share one Reservation.
  with recursive affected_parties as (
    select party.id
    from public.reservation_parties as party
    where party.legacy_booking_group_id = any(v_group_ids)

    union

    select lineage.target_party_id
    from affected_parties as affected
    join public.reservation_transition_parties as lineage
      on lineage.source_party_id = affected.id
  )
  update public.reservation_parties as party
     set display_name = trim(p_customer_name),
         email = nullif(trim(p_customer_email), ''),
         phone = nullif(trim(p_customer_phone), '')
   where party.id in (
     select affected.id
     from affected_parties as affected
   )
     and (
       party.legacy_booking_group_id = any(v_group_ids)
       or party.reservation_id = any(v_effective_reservation_ids)
     );

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.details_updated',
    'reservation',
    case when cardinality(v_effective_reservation_ids) = 1
      then v_effective_reservation_ids[1]::text
      else null
    end,
    p_actor_id,
    jsonb_build_object('booking_count', cardinality(p_booking_ids))
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    case when cardinality(v_effective_reservation_ids) = 1
      then v_effective_reservation_ids[1]
      else null
    end,
    jsonb_build_object('booking_count', cardinality(p_booking_ids))
  );
  return cardinality(p_booking_ids);
end;
$function$;

create function private.reservation_phase3b_record_payment(
  p_reservation_id uuid,
  p_booking_ids uuid[],
  p_allocation_amounts numeric[],
  p_method text,
  p_operation_id text,
  p_occurred_at timestamptz,
  p_payer_party_id uuid default null,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
  v_payment_id uuid;
  v_currency character(3);
  v_payment_amount numeric(12,2);
  v_invalid_count integer;
begin
  if cardinality(p_booking_ids) is distinct from cardinality(p_allocation_amounts)
     or coalesce(cardinality(p_booking_ids), 0) = 0
     or p_occurred_at is null
     or p_method !~ '^[a-z][a-z0-9_]{0,31}$'
     or exists (
       select 1 from unnest(p_allocation_amounts) as amount
       where amount is null
          or amount <= 0
          or amount <> round(amount, 2)
     ) then
    raise exception using
      errcode = '22023',
      message = 'Payment allocations, method, and occurred_at are invalid';
  end if;

  v_request := jsonb_build_object(
    'reservation_id', p_reservation_id,
    'booking_ids', p_booking_ids,
    'allocation_amounts', p_allocation_amounts,
    'method', p_method,
    'occurred_at', p_occurred_at,
    'payer_party_id', p_payer_party_id
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'record_payment',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return v_claim.result_entity_id;
  end if;

  perform private.reservation_phase3b_lock_allocations(p_booking_ids);

  select reservation.currency
    into v_currency
  from public.reservations as reservation
  where reservation.id = p_reservation_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Payment Reservation was not found';
  end if;

  if p_payer_party_id is not null
     and not exists (
       select 1
       from public.reservation_parties as party
       where party.id = p_payer_party_id
         and party.reservation_id = p_reservation_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'Payment payer must belong to the effective Reservation';
  end if;

  select count(*)::integer
    into v_invalid_count
  from unnest(p_booking_ids, p_allocation_amounts)
    as requested(booking_id, requested_amount)
  join public.bookings as booking on booking.id = requested.booking_id
  join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  left join lateral (
    select coalesce(sum(entry.amount) filter (
      where payment.status = 'succeeded'
    ), 0)::numeric(12,2) as allocated_amount
    from public.payment_allocation_entries as entry
    join public.payments as payment on payment.id = entry.payment_id
    where entry.booking_id = booking.id
  ) as balance on true
  where membership.effective_reservation_id <> p_reservation_id
     or booking.currency <> v_currency
     or balance.allocated_amount + requested.requested_amount
        > booking.total_amount;

  if v_invalid_count <> 0
     or (
       select count(*)
       from public.reservation_allocation_memberships as membership
       where membership.booking_id = any(p_booking_ids)
     ) <> cardinality(p_booking_ids) then
    raise exception using
      errcode = '23514',
      message = 'Payment scope, currency, or remaining allocation is invalid';
  end if;

  select sum(amount)::numeric(12,2)
    into v_payment_amount
  from unnest(p_allocation_amounts) as amount;

  v_payment_id := private.reservation_phase3_uuid(
    'payment',
    'phase3b-operation:' || p_operation_id
  );

  insert into public.payments (
    id,
    reservation_id,
    payer_party_id,
    kind,
    amount,
    currency,
    method,
    status,
    idempotency_key,
    source,
    occurred_at,
    recorded_by
  ) values (
    v_payment_id,
    p_reservation_id,
    p_payer_party_id,
    'payment',
    v_payment_amount,
    v_currency,
    p_method,
    'succeeded',
    'reservation-phase3b:' || p_operation_id || ':payment',
    'manager',
    p_occurred_at,
    p_actor_id
  );

  insert into public.payment_allocation_entries (
    reservation_id,
    payment_id,
    booking_id,
    entry_kind,
    amount,
    idempotency_key,
    created_by
  )
  select
    p_reservation_id,
    v_payment_id,
    requested.booking_id,
    'allocation',
    requested.amount,
    'reservation-phase3b:' || p_operation_id
      || ':allocation:' || requested.booking_id::text,
    p_actor_id
  from unnest(p_booking_ids, p_allocation_amounts)
    as requested(booking_id, amount)
  order by requested.booking_id;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config(
    'app.audit_event_type',
    'booking.payment_updated',
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  with balances as (
    select
      booking.id,
      booking.total_amount,
      coalesce(sum(entry.amount) filter (
        where payment.status = 'succeeded'
      ), 0)::numeric(12,2) as allocated_amount
    from public.bookings as booking
    left join public.payment_allocation_entries as entry
      on entry.booking_id = booking.id
    left join public.payments as payment on payment.id = entry.payment_id
    where booking.id = any(p_booking_ids)
    group by booking.id, booking.total_amount
  )
  update public.bookings as booking
     set payment_status = case
           when balance.allocated_amount >= balance.total_amount
             then 'paid'::public.payment_status
           else 'pay_at_venue'::public.payment_status
         end,
         payment_method = case when p_method = 'stripe'
           then 'stripe'::public.payment_method
           else 'venue'::public.payment_method
         end
    from balances as balance
   where booking.id = balance.id;

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.payment_recorded',
    'payment',
    v_payment_id::text,
    p_actor_id,
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'booking_count', cardinality(p_booking_ids),
      'amount', v_payment_amount,
      'currency', v_currency
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    v_payment_id,
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'booking_count', cardinality(p_booking_ids)
    )
  );
  return v_payment_id;
end;
$function$;

create function private.reservation_phase3b_refund_payment(
  p_payment_id uuid,
  p_allocation_entry_ids bigint[],
  p_refund_amounts numeric[],
  p_operation_id text,
  p_occurred_at timestamptz,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
  v_original public.payments%rowtype;
  v_refund_id uuid;
  v_refund_amount numeric(12,2);
  v_booking_ids uuid[];
  v_normalized_entry_ids bigint[];
  v_invalid_count integer;
begin
  if cardinality(p_allocation_entry_ids) is distinct from cardinality(p_refund_amounts)
     or coalesce(cardinality(p_allocation_entry_ids), 0) = 0
     or p_occurred_at is null
     or exists (
       select 1 from unnest(p_refund_amounts) as amount
       where amount is null
          or amount <= 0
          or amount <> round(amount, 2)
     ) then
    raise exception using
      errcode = '22023',
      message = 'Refund allocations and occurred_at are invalid';
  end if;

  select array_agg(distinct entry_id order by entry_id)
    into v_normalized_entry_ids
  from unnest(p_allocation_entry_ids) as entry_id;

  if v_normalized_entry_ids is distinct from p_allocation_entry_ids then
    raise exception using
      errcode = '22023',
      message = 'Refund allocation IDs must be distinct and sorted';
  end if;

  v_request := jsonb_build_object(
    'payment_id', p_payment_id,
    'allocation_entry_ids', p_allocation_entry_ids,
    'refund_amounts', p_refund_amounts,
    'occurred_at', p_occurred_at
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'refund_payment',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return v_claim.result_entity_id;
  end if;

  select payment.*
    into v_original
  from public.payments as payment
  where payment.id = p_payment_id;

  if not found
     or v_original.kind <> 'payment'
     or v_original.status <> 'succeeded' then
    raise exception using
      errcode = '23514',
      message = 'Only a succeeded receipt may be refunded';
  end if;

  select array_agg(distinct entry.booking_id order by entry.booking_id)
    into v_booking_ids
  from public.payment_allocation_entries as entry
  where entry.id = any(p_allocation_entry_ids)
    and entry.payment_id = p_payment_id
    and entry.entry_kind = 'allocation';

  if coalesce(cardinality(v_booking_ids), 0) <> cardinality(p_allocation_entry_ids) then
    raise exception using
      errcode = '23503',
      message = 'Refund allocation entries must belong to the original Payment';
  end if;

  perform private.reservation_phase3b_lock_allocations(
    v_booking_ids,
    array[v_original.reservation_id]::uuid[]
  );

  select payment.*
    into v_original
  from public.payments as payment
  where payment.id = p_payment_id
  for update;

  if not found
     or v_original.kind <> 'payment'
     or v_original.status <> 'succeeded' then
    raise exception using
      errcode = '40001',
      message = 'Payment state changed while acquiring refund locks';
  end if;

  select count(*)::integer
    into v_invalid_count
  from unnest(p_allocation_entry_ids, p_refund_amounts)
    as requested(entry_id, requested_amount)
  join public.payment_allocation_entries as original
    on original.id = requested.entry_id
  left join lateral (
    select coalesce(sum(refund.amount), 0)::numeric(12,2) as refunded_amount
    from public.payment_allocation_entries as refund
    join public.payments as refund_payment on refund_payment.id = refund.payment_id
    where refund.reverses_entry_id = original.id
      and refund_payment.status = 'succeeded'
  ) as refunded on true
  where requested.requested_amount
    > original.amount + refunded.refunded_amount;

  if v_invalid_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Refund exceeds the remaining amount of an allocation';
  end if;

  select sum(amount)::numeric(12,2)
    into v_refund_amount
  from unnest(p_refund_amounts) as amount;

  v_refund_id := private.reservation_phase3_uuid(
    'payment',
    'phase3b-refund-operation:' || p_operation_id
  );

  insert into public.payments (
    id,
    reservation_id,
    payer_party_id,
    kind,
    amount,
    currency,
    method,
    status,
    idempotency_key,
    reverses_payment_id,
    source,
    occurred_at,
    recorded_by
  ) values (
    v_refund_id,
    v_original.reservation_id,
    v_original.payer_party_id,
    'refund',
    v_refund_amount,
    v_original.currency,
    v_original.method,
    'succeeded',
    'reservation-phase3b:' || p_operation_id || ':refund',
    p_payment_id,
    'manager',
    p_occurred_at,
    p_actor_id
  );

  insert into public.payment_allocation_entries (
    reservation_id,
    payment_id,
    booking_id,
    entry_kind,
    amount,
    reverses_entry_id,
    idempotency_key,
    created_by
  )
  select
    v_original.reservation_id,
    v_refund_id,
    original.booking_id,
    'refund',
    -requested.amount,
    original.id,
    'reservation-phase3b:' || p_operation_id
      || ':refund-allocation:' || original.id::text,
    p_actor_id
  from unnest(p_allocation_entry_ids, p_refund_amounts)
    as requested(entry_id, amount)
  join public.payment_allocation_entries as original
    on original.id = requested.entry_id
  order by original.booking_id;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config(
    'app.audit_event_type',
    'booking.payment_updated',
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  with balances as (
    select
      booking.id,
      booking.total_amount,
      coalesce(sum(entry.amount) filter (
        where payment.status = 'succeeded'
      ), 0)::numeric(12,2) as allocated_amount,
      bool_or(entry.entry_kind = 'refund') as has_refund
    from public.bookings as booking
    left join public.payment_allocation_entries as entry
      on entry.booking_id = booking.id
    left join public.payments as payment on payment.id = entry.payment_id
    where booking.id = any(v_booking_ids)
    group by booking.id, booking.total_amount
  )
  update public.bookings as booking
     set payment_status = case
       when balance.allocated_amount >= balance.total_amount
         then 'paid'::public.payment_status
       when balance.allocated_amount <= 0 and balance.has_refund
         then 'refunded'::public.payment_status
       else 'pay_at_venue'::public.payment_status
     end
    from balances as balance
   where booking.id = balance.id;

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.payment_refunded',
    'payment',
    v_refund_id::text,
    p_actor_id,
    jsonb_build_object(
      'reservation_id', v_original.reservation_id,
      'reverses_payment_id', p_payment_id,
      'amount', v_refund_amount,
      'currency', v_original.currency
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    v_refund_id,
    jsonb_build_object('reverses_payment_id', p_payment_id)
  );
  return v_refund_id;
end;
$function$;

create function private.reservation_phase3b_apply_transition(
  p_transition_type text,
  p_source_reservation_ids uuid[],
  p_target_reservation_ids uuid[],
  p_target_primary_party_ids uuid[],
  p_booking_ids uuid[],
  p_booking_target_reservation_ids uuid[],
  p_source_party_ids uuid[],
  p_target_party_ids uuid[],
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
  v_sources uuid[];
  v_targets uuid[];
  v_transition_reservation_ids uuid[];
  v_bookings uuid[];
  v_current_scope uuid[];
  v_transition_id uuid;
  v_index integer;
  v_booking public.bookings%rowtype;
  v_membership public.reservation_allocation_memberships%rowtype;
  v_source_session public.reservation_sessions%rowtype;
  v_target_session_id uuid;
  v_target_reservation_id uuid;
  v_legacy_link_after uuid;
  v_source_party_reservation_id uuid;
  v_target_party_reservation_id uuid;
  v_currency_count integer;
begin
  select array_agg(distinct reservation_id order by reservation_id)
    into v_sources
  from unnest(p_source_reservation_ids) as reservation_id;
  select array_agg(distinct reservation_id order by reservation_id)
    into v_targets
  from unnest(p_target_reservation_ids) as reservation_id;
  select array_agg(distinct booking_id order by booking_id)
    into v_bookings
  from unnest(p_booking_ids) as booking_id;

  if p_transition_type not in ('merge', 'split')
     or coalesce(cardinality(v_sources), 0) = 0
     or coalesce(cardinality(v_targets), 0) = 0
     or coalesce(cardinality(v_bookings), 0) = 0
     or v_sources is distinct from p_source_reservation_ids
     or v_targets is distinct from p_target_reservation_ids
     or v_bookings is distinct from p_booking_ids
     or exists (
       select 1 from unnest(v_sources) as source_id
       where source_id = any(v_targets)
     ) then
    raise exception using
      errcode = '22023',
      message = 'Transition sources, targets, and bookings must be disjoint sorted UUID scopes';
  end if;

  if cardinality(p_target_primary_party_ids) <> cardinality(v_targets)
     or cardinality(p_booking_target_reservation_ids) <> cardinality(v_bookings)
     or cardinality(p_source_party_ids) is distinct from cardinality(p_target_party_ids)
     or coalesce(cardinality(p_source_party_ids), 0) = 0
     or array_position(p_target_primary_party_ids, null) is not null
     or array_position(p_booking_target_reservation_ids, null) is not null
     or array_position(p_source_party_ids, null) is not null
     or array_position(p_target_party_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = 'Transition target, allocation, and Party mappings have invalid shapes';
  end if;

  if (p_transition_type = 'merge'
      and (cardinality(v_sources) < 2 or cardinality(v_targets) <> 1))
     or (p_transition_type = 'split'
      and (cardinality(v_sources) <> 1 or cardinality(v_targets) < 2)) then
    raise exception using
      errcode = '22023',
      message = 'Merge requires 2+ sources/1 target; split requires 1 source/2+ targets';
  end if;

  if exists (
    select 1
    from unnest(p_booking_target_reservation_ids) as target_id
    where not (target_id = any(v_targets))
  )
     or exists (
       select target_id
       from unnest(v_targets) as target_id
       except
       select target_id
       from unnest(p_booking_target_reservation_ids) as target_id
     ) then
    raise exception using
      errcode = '22023',
      message = 'Every transition target must receive at least one Court allocation';
  end if;

  select array_agg(reservation_id order by reservation_id)
    into v_transition_reservation_ids
  from (
    select reservation_id from unnest(v_sources) as reservation_id
    union
    select reservation_id from unnest(v_targets) as reservation_id
  ) as transition_scope;

  v_request := jsonb_build_object(
    'transition_type', p_transition_type,
    'source_reservation_ids', v_sources,
    'target_reservation_ids', v_targets,
    'target_primary_party_ids', p_target_primary_party_ids,
    'booking_ids', v_bookings,
    'booking_target_reservation_ids', p_booking_target_reservation_ids,
    'source_party_ids', p_source_party_ids,
    'target_party_ids', p_target_party_ids
  );
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    p_transition_type,
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return v_claim.result_entity_id;
  end if;

  perform private.reservation_phase3b_lock_allocations(
    v_bookings,
    v_transition_reservation_ids
  );

  select array_agg(booking.id order by booking.id)
    into v_current_scope
  from public.bookings as booking
  left join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where coalesce(
    membership.effective_reservation_id,
    booking.reservation_id
  ) = any(v_sources);

  if v_current_scope is distinct from v_bookings then
    raise exception using
      errcode = '23514',
      message = 'Merge/split must map every current Court allocation in the source scope exactly once';
  end if;

  if exists (
    select source_id
    from unnest(v_sources) as source_id
    except
    select distinct membership.effective_reservation_id
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = any(v_bookings)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every transition source must contribute at least one current Court allocation';
  end if;

  if exists (
    select 1
    from public.bookings as booking
    left join public.reservation_allocation_memberships as membership
      on membership.booking_id = booking.id
    where coalesce(
      membership.effective_reservation_id,
      booking.reservation_id
    ) = any(v_targets)
  )
     or exists (
       select 1
       from public.reservation_transition_sources as source
       where source.reservation_id = any(v_targets)
     )
     or exists (
       select 1
       from public.reservation_transition_targets as target
       where target.reservation_id = any(v_targets)
     )
     or exists (
       select 1
       from public.payments as payment
       where payment.reservation_id = any(v_targets)
     )
     or exists (
       select 1
       from public.reservation_legacy_sources as legacy_source
       where legacy_source.reservation_id = any(v_targets)
     ) then
    raise exception using
      errcode = '23514',
      message = 'Transition targets must be newly prepared empty Reservations';
  end if;

  select count(distinct reservation.currency)::integer
    into v_currency_count
  from public.reservations as reservation
  where reservation.id = any(v_sources || v_targets);

  if v_currency_count <> 1
     or exists (
       select 1
       from public.bookings as booking
       join public.reservations as target
         on target.id = p_booking_target_reservation_ids[
           array_position(v_bookings, booking.id)
         ]
       where booking.id = any(v_bookings)
         and booking.currency <> target.currency
     ) then
    raise exception using
      errcode = '23514',
      message = 'Merge/split requires one venue currency across every source and target';
  end if;

  for v_index in 1..cardinality(v_targets) loop
    if not exists (
      select 1
      from public.reservation_party_roles as role
      where role.reservation_id = v_targets[v_index]
        and role.party_id = p_target_primary_party_ids[v_index]
        and role.role = 'primary_contact'
    )
       or not (p_target_primary_party_ids[v_index] = any(p_target_party_ids)) then
      raise exception using
        errcode = '23514',
        message = 'Every transition target requires an explicit mapped primary contact';
    end if;
  end loop;

  for v_index in 1..cardinality(p_source_party_ids) loop
    select party.reservation_id
      into v_source_party_reservation_id
    from public.reservation_parties as party
    where party.id = p_source_party_ids[v_index];
    select party.reservation_id
      into v_target_party_reservation_id
    from public.reservation_parties as party
    where party.id = p_target_party_ids[v_index];

    if v_source_party_reservation_id is null
       or v_target_party_reservation_id is null
       or not (v_source_party_reservation_id = any(v_sources))
       or not (v_target_party_reservation_id = any(v_targets)) then
      raise exception using
        errcode = '23514',
        message = 'Party lineage must map a source Party to a target Party in this transition';
    end if;
  end loop;

  if exists (
    select party.id
    from public.reservation_parties as party
    where party.reservation_id = any(v_sources)
    except
    select distinct party_id
    from unnest(p_source_party_ids) as party_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every source Party requires explicit transition lineage';
  end if;

  v_transition_id := gen_random_uuid();
  insert into public.reservation_transitions (
    id,
    operation_id,
    transition_type,
    actor_id
  ) values (
    v_transition_id,
    p_operation_id,
    p_transition_type,
    p_actor_id
  );

  insert into public.reservation_transition_sources (
    transition_id,
    reservation_id
  )
  select v_transition_id, reservation_id
  from unnest(v_sources) as reservation_id
  order by reservation_id;

  insert into public.reservation_transition_targets (
    transition_id,
    reservation_id,
    primary_party_id
  )
  select
    v_transition_id,
    target.reservation_id,
    primary_party.party_id
  from unnest(v_targets) with ordinality
    as target(reservation_id, position)
  join unnest(p_target_primary_party_ids) with ordinality
    as primary_party(party_id, position) using (position)
  order by target.reservation_id;

  insert into public.reservation_transition_parties (
    transition_id,
    source_reservation_id,
    source_party_id,
    target_reservation_id,
    target_party_id
  )
  select
    v_transition_id,
    source_party.reservation_id,
    source_party.id,
    target_party.reservation_id,
    target_party.id
  from unnest(p_source_party_ids) with ordinality
    as requested_source(party_id, position)
  join unnest(p_target_party_ids) with ordinality
    as requested_target(party_id, position) using (position)
  join public.reservation_parties as source_party
    on source_party.id = requested_source.party_id
  join public.reservation_parties as target_party
    on target_party.id = requested_target.party_id
  order by target_party.id;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config(
    'app.audit_event_type',
    case when p_transition_type = 'merge'
      then 'booking.relationship_linked'
      else 'booking.relationship_unlinked'
    end,
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  for v_index in 1..cardinality(v_bookings) loop
    select booking.*
      into v_booking
    from public.bookings as booking
    where booking.id = v_bookings[v_index];

    select membership.*
      into v_membership
    from public.reservation_allocation_memberships as membership
    where membership.booking_id = v_bookings[v_index];

    select session.*
      into v_source_session
    from public.reservation_sessions as session
    where session.id = v_membership.effective_session_id
      and session.reservation_id = v_membership.effective_reservation_id;

    v_target_reservation_id := p_booking_target_reservation_ids[v_index];
    v_target_session_id := private.reservation_phase3_uuid(
      'session',
      'phase3b-transition:' || v_transition_id::text
        || ':target:' || v_target_reservation_id::text
        || ':source-session:' || v_source_session.id::text
    );

    insert into public.reservation_sessions (
      id,
      reservation_id,
      starts_at,
      ends_at,
      party_size,
      notes,
      source,
      created_by
    ) values (
      v_target_session_id,
      v_target_reservation_id,
      v_source_session.starts_at,
      v_source_session.ends_at,
      v_source_session.party_size,
      v_source_session.notes,
      'system',
      p_actor_id
    )
    on conflict (id) do nothing;

    if not exists (
      select 1
      from public.reservation_sessions as target_session
      where target_session.id = v_target_session_id
        and target_session.reservation_id = v_target_reservation_id
        and target_session.starts_at = v_source_session.starts_at
        and target_session.ends_at = v_source_session.ends_at
        and target_session.party_size = v_source_session.party_size
        and target_session.notes is not distinct from v_source_session.notes
    ) then
      raise exception using
        errcode = '23514',
        message = 'Transition Session identity collided with incompatible facts';
    end if;

    if p_transition_type = 'merge' then
      v_legacy_link_after := v_target_reservation_id;
    else
      select case when count(distinct booking.booking_group_id) > 1
        then v_target_reservation_id
        else null::uuid
      end
        into v_legacy_link_after
      from unnest(v_bookings, p_booking_target_reservation_ids)
        as assignment(booking_id, target_reservation_id)
      join public.bookings as booking on booking.id = assignment.booking_id
      where assignment.target_reservation_id = v_target_reservation_id;
    end if;

    insert into public.reservation_transition_allocations (
      transition_id,
      booking_id,
      from_reservation_id,
      from_session_id,
      to_reservation_id,
      to_session_id,
      legacy_link_before,
      legacy_link_after
    ) values (
      v_transition_id,
      v_booking.id,
      v_membership.effective_reservation_id,
      v_membership.effective_session_id,
      v_target_reservation_id,
      v_target_session_id,
      v_booking.booking_link_id,
      v_legacy_link_after
    );

    update public.reservation_allocation_memberships
       set effective_reservation_id = v_target_reservation_id,
           effective_session_id = v_target_session_id,
           last_transition_id = v_transition_id,
           version = version + 1
     where booking_id = v_booking.id;

    update public.bookings
       set booking_link_id = v_legacy_link_after
     where id = v_booking.id;
  end loop;

  insert into public.reservation_legacy_sources (
    reservation_id,
    source_type,
    source_id,
    created_by
  )
  select distinct
    allocation.to_reservation_id,
    'booking_link',
    allocation.legacy_link_after,
    p_actor_id
  from public.reservation_transition_allocations as allocation
  where allocation.transition_id = v_transition_id
    and allocation.legacy_link_after is not null
  on conflict (source_type, source_id) do nothing;

  if exists (
    select 1
    from public.reservation_transition_allocations as allocation
    join public.reservation_legacy_sources as source
      on source.source_type = 'booking_link'
     and source.source_id = allocation.legacy_link_after
    where allocation.transition_id = v_transition_id
      and allocation.legacy_link_after is not null
      and source.reservation_id <> allocation.to_reservation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Legacy link source already belongs to another Reservation';
  end if;

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.' || p_transition_type || '_recorded',
    'reservation_transition',
    v_transition_id::text,
    p_actor_id,
    jsonb_build_object(
      'source_count', cardinality(v_sources),
      'target_count', cardinality(v_targets),
      'booking_count', cardinality(v_bookings)
    )
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    v_transition_id,
    jsonb_build_object(
      'source_reservation_ids', to_jsonb(v_sources),
      'target_reservation_ids', to_jsonb(v_targets),
      'booking_count', cardinality(v_bookings)
    )
  );
  return v_transition_id;
end;
$function$;

create function private.reservation_phase3b_reverse_transition(
  p_transition_id uuid,
  p_operation_id text,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request jsonb;
  v_claim record;
  v_original public.reservation_transitions%rowtype;
  v_reverse_id uuid;
  v_booking_ids uuid[];
  v_original_source_ids uuid[];
  v_original_target_ids uuid[];
  v_allocation record;
  v_restored_session_id uuid;
  v_projection_session_id uuid;
  v_timezone text;
begin
  v_request := jsonb_build_object('transition_id', p_transition_id);
  select * into v_claim
  from private.reservation_phase3b_claim_operation(
    p_operation_id,
    'reverse_transition',
    private.reservation_phase3b_request_fingerprint(v_request),
    p_actor_id
  );

  if v_claim.already_completed then
    return v_claim.result_entity_id;
  end if;

  select transition.*
    into v_original
  from public.reservation_transitions as transition
  where transition.id = p_transition_id;

  if not found or v_original.transition_type = 'reverse_transition' then
    raise exception using
      errcode = '23514',
      message = 'Only an original merge/split transition may be reversed';
  end if;

  select array_agg(allocation.booking_id order by allocation.booking_id)
    into v_booking_ids
  from public.reservation_transition_allocations as allocation
  where allocation.transition_id = p_transition_id;
  select array_agg(source.reservation_id order by source.reservation_id)
    into v_original_source_ids
  from public.reservation_transition_sources as source
  where source.transition_id = p_transition_id;
  select array_agg(target.reservation_id order by target.reservation_id)
    into v_original_target_ids
  from public.reservation_transition_targets as target
  where target.transition_id = p_transition_id;

  perform private.reservation_phase3b_lock_allocations(
    v_booking_ids,
    v_original_source_ids
  );

  if exists (
    select 1
    from public.reservation_transition_allocations as allocation
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = allocation.booking_id
    join public.bookings as booking
      on booking.id = allocation.booking_id
    where allocation.transition_id = p_transition_id
      and (
        membership.effective_reservation_id <> allocation.to_reservation_id
        or booking.booking_link_id is distinct from allocation.legacy_link_after
      )
  ) then
    raise exception using
      errcode = '40001',
      message = 'Transition cannot be reversed while a later relationship state is active';
  end if;

  if exists (
    select 1
    from unnest(v_original_source_ids) as reservation_id
    where not exists (
      select 1
      from public.reservation_party_roles as role
      where role.reservation_id = reservation_id
        and role.role = 'primary_contact'
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every restored Reservation requires an existing primary contact';
  end if;

  v_reverse_id := gen_random_uuid();
  insert into public.reservation_transitions (
    id,
    operation_id,
    transition_type,
    reverses_transition_id,
    actor_id
  ) values (
    v_reverse_id,
    p_operation_id,
    'reverse_transition',
    p_transition_id,
    p_actor_id
  );

  insert into public.reservation_transition_sources (
    transition_id,
    reservation_id
  )
  select v_reverse_id, reservation_id
  from unnest(v_original_target_ids) as reservation_id
  order by reservation_id;

  insert into public.reservation_transition_targets (
    transition_id,
    reservation_id,
    primary_party_id
  )
  select
    v_reverse_id,
    reservation.id,
    role.party_id
  from unnest(v_original_source_ids) as reservation_id
  join public.reservations as reservation on reservation.id = reservation_id
  join public.reservation_party_roles as role
    on role.reservation_id = reservation.id
   and role.role = 'primary_contact'
  order by reservation.id;

  insert into public.reservation_transition_parties (
    transition_id,
    source_reservation_id,
    source_party_id,
    target_reservation_id,
    target_party_id
  )
  select
    v_reverse_id,
    lineage.target_reservation_id,
    lineage.target_party_id,
    lineage.source_reservation_id,
    lineage.source_party_id
  from public.reservation_transition_parties as lineage
  where lineage.transition_id = p_transition_id
  order by lineage.source_party_id;

  perform pg_catalog.set_config('app.audit_operation_id', p_operation_id, true);
  perform pg_catalog.set_config(
    'app.audit_event_type',
    'booking.relationship_reverted',
    true
  );
  perform pg_catalog.set_config(
    'app.audit_source',
    'reservation_phase3b_kernel',
    true
  );

  select coalesce(nullif(trim(settings.timezone), ''), 'America/Toronto')
    into v_timezone
  from public.venue_settings as settings
  where settings.singleton;

  -- Reverse only the relationship. Later schedule/details changes are carried
  -- into new restored Sessions instead of mutating or reviving stale Session
  -- rows. Allocations with the same original Session and current facts are
  -- deterministically recombined; divergent facts remain separate Sessions.
  for v_allocation in
    select
      original.booking_id,
      original.from_reservation_id as restored_reservation_id,
      original.from_session_id as original_session_id,
      original.legacy_link_before,
      original.legacy_link_after,
      membership.effective_reservation_id as current_reservation_id,
      membership.effective_session_id as current_session_id,
      current_session.starts_at,
      current_session.ends_at,
      current_session.party_size,
      current_session.notes,
      booking.reservation_id as physical_reservation_id
    from public.reservation_transition_allocations as original
    join public.reservation_allocation_memberships as membership
      on membership.booking_id = original.booking_id
    join public.reservation_sessions as current_session
      on current_session.id = membership.effective_session_id
     and current_session.reservation_id = membership.effective_reservation_id
    join public.bookings as booking on booking.id = original.booking_id
    where original.transition_id = p_transition_id
    order by original.booking_id
  loop
    v_restored_session_id := private.reservation_phase3_uuid(
      'session',
      'phase3b-reverse:' || v_reverse_id::text
        || ':reservation:' || v_allocation.restored_reservation_id::text
        || ':source-session:' || v_allocation.original_session_id::text
        || ':facts:' || pg_catalog.md5(
          pg_catalog.jsonb_build_object(
            'starts_at', v_allocation.starts_at,
            'ends_at', v_allocation.ends_at,
            'party_size', v_allocation.party_size,
            'notes', v_allocation.notes
          )::text
        )
    );

    insert into public.reservation_sessions (
      id,
      reservation_id,
      starts_at,
      ends_at,
      party_size,
      notes,
      source,
      created_by
    ) values (
      v_restored_session_id,
      v_allocation.restored_reservation_id,
      v_allocation.starts_at,
      v_allocation.ends_at,
      v_allocation.party_size,
      v_allocation.notes,
      'system',
      p_actor_id
    )
    on conflict (id) do nothing;

    if not exists (
      select 1
      from public.reservation_sessions as restored
      where restored.id = v_restored_session_id
        and restored.reservation_id = v_allocation.restored_reservation_id
        and restored.starts_at = v_allocation.starts_at
        and restored.ends_at = v_allocation.ends_at
        and restored.party_size = v_allocation.party_size
        and restored.notes is not distinct from v_allocation.notes
    ) then
      raise exception using
        errcode = '23514',
        message = 'Restored Session identity collided with incompatible facts';
    end if;

    if v_allocation.physical_reservation_id =
       v_allocation.restored_reservation_id then
      v_projection_session_id := v_restored_session_id;
    else
      v_projection_session_id := private.reservation_phase3_uuid(
        'session',
        'phase3b-reverse-projection:' || v_reverse_id::text
          || ':origin:' || v_allocation.physical_reservation_id::text
          || ':effective-session:' || v_restored_session_id::text
      );

      insert into public.reservation_sessions (
        id,
        reservation_id,
        starts_at,
        ends_at,
        party_size,
        notes,
        source,
        created_by
      ) values (
        v_projection_session_id,
        v_allocation.physical_reservation_id,
        v_allocation.starts_at,
        v_allocation.ends_at,
        v_allocation.party_size,
        v_allocation.notes,
        'system',
        p_actor_id
      )
      on conflict (id) do nothing;

      if not exists (
        select 1
        from public.reservation_sessions as projection
        where projection.id = v_projection_session_id
          and projection.reservation_id =
            v_allocation.physical_reservation_id
          and projection.starts_at = v_allocation.starts_at
          and projection.ends_at = v_allocation.ends_at
          and projection.party_size = v_allocation.party_size
          and projection.notes is not distinct from v_allocation.notes
      ) then
        raise exception using
          errcode = '23514',
          message = 'Physical Session projection collided with incompatible facts';
      end if;
    end if;

    insert into public.reservation_transition_allocations (
      transition_id,
      booking_id,
      from_reservation_id,
      from_session_id,
      to_reservation_id,
      to_session_id,
      legacy_link_before,
      legacy_link_after
    ) values (
      v_reverse_id,
      v_allocation.booking_id,
      v_allocation.current_reservation_id,
      v_allocation.current_session_id,
      v_allocation.restored_reservation_id,
      v_restored_session_id,
      v_allocation.legacy_link_after,
      v_allocation.legacy_link_before
    );

    update public.bookings as booking
       set session_id = v_projection_session_id,
           start_at = pg_catalog.timezone(
             v_timezone,
             v_allocation.starts_at
           ),
           end_at = pg_catalog.timezone(
             v_timezone,
             v_allocation.ends_at
           ),
           booking_link_id = v_allocation.legacy_link_before
     where booking.id = v_allocation.booking_id;
  end loop;

  update public.reservation_allocation_memberships as membership
     set effective_reservation_id = allocation.to_reservation_id,
         effective_session_id = allocation.to_session_id,
         last_transition_id = v_reverse_id,
         version = membership.version + 1
    from public.reservation_transition_allocations as allocation
   where allocation.transition_id = v_reverse_id
     and membership.booking_id = allocation.booking_id;

  perform private.reservation_phase3b_audit(
    p_operation_id,
    'reservation.transition_reversed',
    'reservation_transition',
    v_reverse_id::text,
    p_actor_id,
    jsonb_build_object('reverses_transition_id', p_transition_id)
  );
  perform private.reservation_phase3b_complete_operation(
    p_operation_id,
    v_reverse_id,
    jsonb_build_object('reverses_transition_id', p_transition_id)
  );
  return v_reverse_id;
end;
$function$;

create function private.reservation_phase3b_effective_scope(
  p_reservation_id uuid default null
)
returns table (
  booking_id uuid,
  origin_reservation_id uuid,
  effective_reservation_id uuid,
  effective_session_id uuid,
  transition_version integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    booking.id,
    booking.reservation_id,
    coalesce(membership.effective_reservation_id, booking.reservation_id),
    coalesce(membership.effective_session_id, booking.session_id),
    coalesce(membership.version, 0)
  from public.bookings as booking
  left join public.reservation_allocation_memberships as membership
    on membership.booking_id = booking.id
  where booking.reservation_id is not null
    and booking.session_id is not null
    and (
      p_reservation_id is null
      or coalesce(
        membership.effective_reservation_id,
        booking.reservation_id
      ) = p_reservation_id
    )
$function$;

create function private.assert_reservation_phase3b_writer_inventory()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_expected_direct text[];
  v_actual_direct text[];
  v_expected_wrappers text[];
  v_missing_or_unsafe text[];
  v_direct_fingerprint text;
  v_wrapper_fingerprint text;
begin
  select array_agg(inventory.signature order by inventory.signature)
    into v_expected_direct
  from private.reservation_phase3b_writer_inventory as inventory
  where inventory.writer_kind = 'direct';

  select array_agg(candidate.signature order by candidate.signature)
    into v_actual_direct
  from (
    select pg_catalog.format(
        '%I.%I(%s)',
        schema.nspname,
        routine.proname,
        coalesce(
          (
            select string_agg(
              pg_catalog.format_type(argument.argument_type, null),
              ',' order by argument.position
            )
            from unnest(routine.proargtypes::oid[]) with ordinality
              as argument(argument_type, position)
          ),
          ''
        )
      ) as signature
    from pg_proc as routine
    join pg_namespace as schema on schema.oid = routine.pronamespace
    where schema.nspname = 'public'
      and routine.prokind = 'f'
      and routine.prosrc ~* '(insert[[:space:]]+into|update([[:space:]]+only)?|delete[[:space:]]+from([[:space:]]+only)?)[[:space:]]+((public|"public")[.])?(bookings|"bookings")'
  ) as candidate;

  if v_actual_direct is distinct from v_expected_direct then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 3B writer inventory drift: expected %s, found %s',
        coalesce(array_to_string(v_expected_direct, ', '), '<none>'),
        coalesce(array_to_string(v_actual_direct, ', '), '<none>')
      );
  end if;

  select array_agg(inventory.signature order by inventory.signature)
    into v_expected_wrappers
  from private.reservation_phase3b_writer_inventory as inventory
  where inventory.writer_kind = 'wrapper';

  select array_agg(inventory.signature order by inventory.signature)
    into v_missing_or_unsafe
  from private.reservation_phase3b_writer_inventory as inventory
  left join pg_proc as routine
    on routine.oid = to_regprocedure(inventory.signature)
  where inventory.writer_kind in ('direct', 'wrapper')
    and (
      routine.oid is null
      or not routine.prosecdef
      or routine.proconfig is null
      or not (
        'search_path=' = any(routine.proconfig)
        or 'search_path=""' = any(routine.proconfig)
      )
      or has_function_privilege('anon', routine.oid, 'execute')
      or not has_function_privilege('authenticated', routine.oid, 'execute')
      or not has_function_privilege('service_role', routine.oid, 'execute')
    );

  if coalesce(cardinality(v_missing_or_unsafe), 0) <> 0 then
    raise exception using
      errcode = '55000',
      message = format(
        'Phase 3B writer security drift: %s',
        array_to_string(v_missing_or_unsafe, ', ')
      );
  end if;

  if exists (
    select 1
    from unnest(v_expected_wrappers) as signature
    join pg_proc as routine on routine.oid = to_regprocedure(signature)
    where routine.prosrc ~* '(insert[[:space:]]+into|update([[:space:]]+only)?|delete[[:space:]]+from([[:space:]]+only)?)[[:space:]]+((public|"public")[.])?(bookings|"bookings")'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B wrapper became a direct booking writer';
  end if;

  select md5(string_agg(
    pg_get_functiondef(routine.oid),
    '' order by inventory.signature
  ))
    into v_direct_fingerprint
  from private.reservation_phase3b_writer_inventory as inventory
  join pg_proc as routine
    on routine.oid = to_regprocedure(inventory.signature)
  where inventory.writer_kind = 'direct';

  select md5(string_agg(
    pg_get_functiondef(routine.oid),
    '' order by inventory.signature
  ))
    into v_wrapper_fingerprint
  from private.reservation_phase3b_writer_inventory as inventory
  join pg_proc as routine
    on routine.oid = to_regprocedure(inventory.signature)
  where inventory.writer_kind = 'wrapper';

  return jsonb_build_object(
    'direct_writer_count', cardinality(v_expected_direct),
    'wrapper_count', cardinality(v_expected_wrappers),
    'undeployed_edge_path_count', (
      select count(*)
      from private.reservation_phase3b_writer_inventory as inventory
      where inventory.writer_kind = 'undeployed_edge'
    ),
    'direct_writer_fingerprint', v_direct_fingerprint,
    'wrapper_fingerprint', v_wrapper_fingerprint
  );
end;
$function$;

create function private.assert_reservation_phase3b_kernel_inactive()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_transition_count bigint;
  v_membership_count bigint;
  v_operation_count bigint;
begin
  if exists (
    select 1
    from pg_proc as routine
    join pg_namespace as schema on schema.oid = routine.pronamespace
    where schema.nspname = 'public'
      and routine.proname like 'reservation_phase3b%'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.1 must not expose a public mutation function';
  end if;

  if exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'public.bookings'::regclass
      and not trigger.tgisinternal
      and trigger.tgname like '%phase3b%'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.1 must not install a booking dual-write trigger';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid =
      'public.payment_allocation_entries'::regclass
      and constraint_row.conname =
        'payment_allocation_entries_booking_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.bookings'::regclass
      and constraint_row.convalidated
      and constraint_row.conkey = array[(
        select attribute.attnum
        from pg_attribute as attribute
        where attribute.attrelid = constraint_row.conrelid
          and attribute.attname = 'booking_id'
      )]::smallint[]
      and constraint_row.confkey = array[(
        select attribute.attnum
        from pg_attribute as attribute
        where attribute.attrelid = constraint_row.confrelid
          and attribute.attname = 'id'
      )]::smallint[]
  ) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B cross-origin payment allocation FK is not installed';
  end if;

  select count(*) into v_transition_count
  from public.reservation_transitions;
  select count(*) into v_membership_count
  from public.reservation_allocation_memberships;
  select count(*) into v_operation_count
  from private.reservation_phase3b_operations;

  if v_transition_count <> 0
     or v_membership_count <> 0
     or v_operation_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B.1 migration unexpectedly activated or backfilled kernel state';
  end if;

  return jsonb_build_object(
    'status', 'inactive',
    'transition_count', v_transition_count,
    'membership_count', v_membership_count,
    'operation_count', v_operation_count
  );
end;
$function$;

-- No client role may call a private mutation, integrity, or inventory helper.
revoke all on function
  private.enforce_reservation_phase3b_operation_immutability(),
  private.enforce_reservation_allocation_membership_update(),
  private.reservation_phase3b_request_fingerprint(jsonb),
  private.reservation_phase3b_claim_operation(text,text,text,uuid),
  private.reservation_phase3b_complete_operation(text,uuid,jsonb),
  private.reservation_phase3b_audit(text,text,text,text,uuid,jsonb),
  private.reservation_phase3b_lock_allocations(uuid[],uuid[]),
  private.reservation_phase3b_attach_legacy_groups(uuid[],text,uuid),
  private.reservation_phase3b_reschedule_session(uuid,timestamptz,timestamptz,text,uuid),
  private.reservation_phase3b_set_booking_status(uuid[],public.booking_status,text,uuid),
  private.reservation_phase3b_update_booking_details(uuid[],text,text,text,text,smallint,text,uuid),
  private.reservation_phase3b_record_payment(uuid,uuid[],numeric[],text,text,timestamptz,uuid,uuid),
  private.reservation_phase3b_refund_payment(uuid,bigint[],numeric[],text,timestamptz,uuid),
  private.reservation_phase3b_apply_transition(text,uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],text,uuid),
  private.reservation_phase3b_reverse_transition(uuid,text,uuid),
  private.reservation_phase3b_effective_scope(uuid),
  private.assert_reservation_phase3b_writer_inventory(),
  private.assert_reservation_phase3b_kernel_inactive()
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
