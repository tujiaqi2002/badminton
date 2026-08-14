create index app_audit_events_actor_occurred_idx
  on private.app_audit_events (actor_id, occurred_at desc)
  where actor_id is not null;

create policy app_audit_events_no_direct_access
  on private.app_audit_events
  for all
  to public
  using (false)
  with check (false);

revoke execute on function private.reject_audit_event_mutation()
  from public, anon, authenticated;
revoke execute on function private.capture_booking_audit_event()
  from public, anon, authenticated;
revoke execute on function private.audit_operation_undo_reason(text)
  from public, anon, authenticated;
