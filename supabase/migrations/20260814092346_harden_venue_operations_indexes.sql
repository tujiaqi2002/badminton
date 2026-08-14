-- Finish the operations-center security/performance hardening surfaced by the
-- Supabase advisors. The private action history is never queried directly by
-- clients; manager access continues to go through guarded RPCs.

create index if not exists venue_settings_updated_by_idx
  on public.venue_settings (updated_by);

create index if not exists booking_admin_actions_actor_idx
  on private.booking_admin_actions (actor_id);

create index if not exists booking_admin_actions_previous_court_idx
  on private.booking_admin_actions (previous_court_id);

create index if not exists booking_admin_actions_new_court_idx
  on private.booking_admin_actions (new_court_id);

drop policy if exists booking_admin_actions_deny_direct
  on private.booking_admin_actions;

create policy booking_admin_actions_deny_direct
  on private.booking_admin_actions
  for all
  to public
  using (false)
  with check (false);
