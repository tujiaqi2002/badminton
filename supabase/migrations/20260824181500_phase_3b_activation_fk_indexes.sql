-- Cover every Phase 3B composite foreign key in its declared column order.
-- This is a performance-only hardening follow-up; writer activation and all
-- business behavior remain in the preceding atomic migration.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index reservation_memberships_effective_session_fkey_idx
  on public.reservation_allocation_memberships (
    effective_session_id,
    effective_reservation_id
  );

create index reservation_memberships_origin_fkey_idx
  on public.reservation_allocation_memberships (
    booking_id,
    origin_reservation_id
  );

create index reservation_session_assignments_projection_from_fkey_idx
  on public.reservation_session_assignments (
    from_projection_session_id,
    origin_reservation_id
  );

create index reservation_session_assignments_projection_to_fkey_idx
  on public.reservation_session_assignments (
    to_projection_session_id,
    origin_reservation_id
  );

create index reservation_session_assignments_effective_from_fkey_idx
  on public.reservation_session_assignments (
    from_effective_session_id,
    effective_reservation_id
  );

create index reservation_session_assignments_effective_to_fkey_idx
  on public.reservation_session_assignments (
    to_effective_session_id,
    effective_reservation_id
  );

create index reservation_transition_allocations_from_session_fkey_idx
  on public.reservation_transition_allocations (
    from_session_id,
    from_reservation_id
  );

create index reservation_transition_allocations_to_session_fkey_idx
  on public.reservation_transition_allocations (
    to_session_id,
    to_reservation_id
  );

commit;
