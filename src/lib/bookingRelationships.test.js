import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBookingRelationship, canLinkBookings } from './bookingRelationships.js'

const booking = (overrides = {}) => ({
  id: crypto.randomUUID(),
  booking_group_id: crypto.randomUUID(),
  booking_link_id: null,
  court_id: crypto.randomUUID(),
  customer_name: 'Guest',
  start_at: '2026-08-20T10:00:00',
  end_at: '2026-08-20T11:00:00',
  status: 'confirmed',
  payment_status: 'pay_at_venue',
  total_amount: 28,
  currency: 'CAD',
  ...overrides,
})

test('linked relationship keeps group subtotals and exposes one linked total', () => {
  const linkId = crypto.randomUUID()
  const firstGroup = crypto.randomUUID()
  const secondGroup = crypto.randomUUID()
  const rows = [
    booking({ booking_group_id: firstGroup, booking_link_id: linkId, total_amount: 28 }),
    booking({ booking_group_id: firstGroup, booking_link_id: linkId, total_amount: 28 }),
    booking({ booking_group_id: secondGroup, booking_link_id: linkId, total_amount: 32, start_at: '2026-08-20T11:30:00', end_at: '2026-08-20T12:30:00' }),
  ]

  const relationship = buildBookingRelationship(rows, rows[0])

  assert.equal(relationship.group_count, 2)
  assert.deepEqual(relationship.groups.map((group) => group.subtotal), [56, 32])
  assert.equal(relationship.linked_total, 88)
})

test('relationship payment summary distinguishes partial and fully paid groups', () => {
  const linkId = crypto.randomUUID()
  const groupId = crypto.randomUUID()
  const rows = [
    booking({ booking_group_id: groupId, booking_link_id: linkId, payment_status: 'paid' }),
    booking({ booking_group_id: groupId, booking_link_id: linkId }),
    booking({ booking_link_id: linkId, payment_status: 'paid', start_at: '2026-08-20T12:00:00', end_at: '2026-08-20T13:00:00' }),
  ]

  const relationship = buildBookingRelationship(rows, rows[0])

  assert.equal(relationship.partially_paid, true)
  assert.equal(relationship.paid_group_count, 1)
  assert.deepEqual(relationship.groups.map((group) => group.payment_summary), ['partial', 'paid'])
})

test('link target rejects the same group, inactive rows and an existing relationship', () => {
  const source = booking({ booking_link_id: crypto.randomUUID() })

  assert.equal(canLinkBookings(source, booking()), true)
  assert.equal(canLinkBookings(source, booking({ booking_group_id: source.booking_group_id })), false)
  assert.equal(canLinkBookings(source, booking({ status: 'cancelled' })), false)
  assert.equal(canLinkBookings(source, booking({ booking_link_id: source.booking_link_id })), false)
})


