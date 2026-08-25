-- Staging-only hosted writer matrix for Reservation Phase 3B.2.
-- All identities and contact values are synthetic. Every mutation is rolled
-- back, so the deterministic 192-row staging baseline remains unchanged.

begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '60s';
set local timezone = 'UTC';

do $stage_guard$
begin
  if not exists (
    select 1 from auth.users
    where id = '00000000-0000-0000-0000-000000017701'::uuid
      and email like '%@example.invalid'
  )
     or (select count(*) from public.bookings) <> 192
     or not exists (
       select 1 from private.reservation_phase3b_activation_state
       where singleton and status = 'activated'
     ) then
    raise exception 'Phase 3B.2 hosted matrix requires the synthetic activated staging baseline';
  end if;
end;
$stage_guard$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000017701',
  true
);

do $writer_matrix$
declare
  v_booking uuid;
  v_other_booking uuid;
  v_primary_party uuid;
  v_start timestamp;
  v_end timestamp;
  v_payment_count integer;
  v_retry_payment_count integer;
  v_booking_count integer;
begin
  -- 1. Customer multi-court create.
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-create-customer"}', true);
  perform * from public.create_multi_booking(
    array['10000000-0000-0000-0000-000000000001']::uuid[],
    '2026-09-01 14:00'::timestamp,
    '2026-09-01 15:00'::timestamp,
    '5550000000',
    'synthetic hosted matrix',
    2::smallint,
    'venue'::public.payment_method
  );

  -- 2-5. Manager multi/zero-price override/weekly/weekly-override creates.
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-create-admin"}', true);
  perform * from public.admin_create_multi_booking(
    array[
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    ]::uuid[],
    '2026-09-02 14:00'::timestamp,
    '2026-09-02 15:00'::timestamp,
    'Synthetic activation',
    'activation@example.invalid',
    2::smallint,
    '5550000001',
    'synthetic hosted matrix'
  );
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-create-price"}', true);
  perform * from public.admin_create_multi_booking_with_price(
    array['10000000-0000-0000-0000-000000000001']::uuid[],
    '2026-09-03 14:00'::timestamp,
    '2026-09-03 15:00'::timestamp,
    'Synthetic activation',
    'activation@example.invalid',
    2::smallint,
    '5550000001',
    null,
    0::numeric
  );
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-create-weekly"}', true);
  perform * from public.admin_create_weekly_booking(
    array['10000000-0000-0000-0000-000000000001']::uuid[],
    '2026-09-04 14:00'::timestamp,
    '2026-09-04 15:00'::timestamp,
    2::smallint,
    'Synthetic activation',
    'activation@example.invalid',
    2::smallint,
    '5550000001',
    null
  );
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-create-weekly-price"}', true);
  perform * from public.admin_create_weekly_booking_with_price(
    array['10000000-0000-0000-0000-000000000002']::uuid[],
    '2026-09-05 14:00'::timestamp,
    '2026-09-05 15:00'::timestamp,
    2::smallint,
    'Synthetic activation',
    'activation@example.invalid',
    2::smallint,
    '5550000001',
    null,
    33::numeric
  );

  -- 6. Single-allocation reschedule.
  select id, start_at + interval '5 hours', end_at + interval '5 hours'
    into v_booking, v_start, v_end
  from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e3e'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-reschedule-single"}', true);
  perform public.admin_reschedule_booking(
    v_booking,
    '10000000-0000-0000-0000-000000000003'::uuid,
    v_start,
    v_end
  );

  -- 7. Whole-group reschedule.
  select id, start_at + interval '5 hours', end_at + interval '5 hours'
    into v_booking, v_start, v_end
  from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e3f'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-reschedule-group"}', true);
  perform * from public.admin_reschedule_booking_group(v_booking, v_start, v_end);

  -- 8. Contiguous group move.
  select id, start_at + interval '5 hours', end_at + interval '5 hours'
    into v_booking, v_start, v_end
  from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e40'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-move-group"}', true);
  perform * from public.admin_move_booking_group(
    v_booking,
    '10000000-0000-0000-0000-000000000003'::uuid,
    v_start,
    v_end
  );

  -- 9. Atomic schedule swap.
  select id into v_booking
  from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e41'::uuid
  order by id limit 1;
  select start_at into v_start
  from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e42'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-swap"}', true);
  perform * from public.admin_swap_booking_schedule(
    v_booking,
    '10000000-0000-0000-0000-000000000001'::uuid,
    v_start
  );

  -- 10. Details and unpaid projection.
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e43'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-details"}', true);
  perform public.admin_update_booking_details(
    v_booking,
    'Synthetic revised',
    'revised@example.invalid',
    '5550000099',
    'synthetic revised note',
    'pay_at_venue'::public.payment_status
  );

  -- 11. Append-only mark-paid and idempotent retry.
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e44'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-mark-paid"}', true);
  perform * from public.admin_mark_booking_paid(v_booking, 'group');
  select count(*)::integer into v_payment_count from public.payments;
  perform * from public.admin_mark_booking_paid(v_booking, 'group');
  select count(*)::integer into v_retry_payment_count from public.payments;
  if v_retry_payment_count <> v_payment_count then
    raise exception 'Idempotent mark-paid retry created another Payment';
  end if;

  -- 12-13. Customer and manager cancellation.
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e45'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-customer-cancel"}', true);
  perform public.cancel_booking(v_booking);
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e46'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-admin-cancel"}', true);
  perform public.admin_cancel_booking(v_booking);

  -- 14. Explicit-primary merge for distinct contact snapshots.
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e49'::uuid
  order by id limit 1;
  select id into v_other_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e4a'::uuid
  order by id limit 1;
  select party.id into v_primary_party
  from public.reservation_allocation_memberships as membership
  join public.reservation_parties as party
    on party.reservation_id = membership.effective_reservation_id
  where membership.booking_id = v_booking
  order by party.id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-link-explicit"}', true);
  perform * from public.admin_link_booking_groups_with_primary(
    v_booking,
    v_other_booking,
    v_primary_party,
    'split_equal'
  );

  -- 15. Split one legacy group from an existing linked Reservation.
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e21'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-unlink"}', true);
  perform * from public.admin_unlink_booking_group(v_booking);

  -- 16. Compatibility undo through the same schedule kernel.
  select id, start_at + interval '5 hours', end_at + interval '5 hours'
    into v_booking, v_start, v_end
  from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e4b'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-undo-source"}', true);
  perform public.admin_reschedule_booking(
    v_booking,
    '10000000-0000-0000-0000-000000000003'::uuid,
    v_start,
    v_end
  );
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-undo"}', true);
  perform * from public.admin_undo_booking_change(v_booking);

  -- 17. Auditable detail revert.
  select id into v_booking from public.bookings
  where booking_group_id = '00000000-0000-0000-0000-000000004e4c'::uuid
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-revert-source"}', true);
  perform public.admin_update_booking_details(
    v_booking,
    'Synthetic changed',
    'changed@example.invalid',
    '5550000098',
    'synthetic changed note',
    'pay_at_venue'::public.payment_status
  );
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-revert"}', true);
  perform * from public.admin_revert_audit_operation(
    'rpc:hosted-revert-source:details'
  );

  -- Permission rejection occurs before a journal row can commit.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000099999',
    true
  );
  begin
    perform public.admin_cancel_booking(v_booking);
    raise exception 'Manager permission rejection did not occur';
  exception when others then
    if sqlerrm not like '%Manager access required%' then raise; end if;
  end;
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000017701',
    true
  );

  -- A late overlap failure leaves no Booking or operation residue.
  select count(*)::integer into v_booking_count from public.bookings;
  select court_id, start_at, end_at
    into v_primary_party, v_start, v_end
  from public.bookings
  where status in ('held', 'confirmed')
  order by id limit 1;
  perform set_config('request.headers', '{"x-idempotency-key":"hosted-overlap-reject"}', true);
  begin
    perform * from public.admin_create_multi_booking(
      array[v_primary_party]::uuid[],
      v_start,
      v_end,
      'Synthetic rejection',
      'rejection@example.invalid',
      2::smallint,
      null,
      null
    );
    raise exception 'Overlap rejection did not occur';
  exception when others then
    if sqlerrm not like '%already booked%' then raise; end if;
  end;
  if (select count(*) from public.bookings) <> v_booking_count
     or exists (
       select 1 from private.reservation_phase3b_operations
       where operation_id = 'rpc:hosted-overlap-reject'
     ) then
    raise exception 'Rejected writer left partial Booking or operation state';
  end if;
end;
$writer_matrix$;

select jsonb_build_object(
  'status', 'phase_3b_hosted_writer_matrix_passed',
  'direct_writer_count', 17,
  'explicit_primary_rpc_checked', true,
  'permission_rejection_checked', true,
  'idempotent_retry_checked', true,
  'late_rollback_checked', true,
  'activation', private.assert_reservation_phase3b_activation()
) as phase_3b_hosted_writer_matrix;

rollback;
