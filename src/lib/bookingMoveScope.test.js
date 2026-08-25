import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeBookingGroup,
  BOOKING_MOVE_SCOPE_GROUP,
  BOOKING_MOVE_SCOPE_SINGLE,
  bookingMoveScope,
  resizeAppliesToBooking,
} from './bookingMoveScope.js'

const bookings = [
  { id: 'a', booking_group_id: 'group-1', status: 'confirmed' },
  { id: 'b', booking_group_id: 'group-1', status: 'held' },
  { id: 'c', booking_group_id: 'group-2', status: 'confirmed' },
  { id: 'd', booking_group_id: 'group-1', status: 'cancelled' },
]

test('activeBookingGroup includes only active members of the selected reservation', () => {
  assert.deepEqual(activeBookingGroup(bookings, bookings[0]).map((booking) => booking.id), ['a', 'b'])
})

test('a grouped booking moves together by default', () => {
  assert.equal(bookingMoveScope({
    booking: bookings[0],
    groupSize: 2,
    selectedBookingId: bookings[0].id,
    moveTogether: true,
  }), BOOKING_MOVE_SCOPE_GROUP)
})

test('unlocking a selected grouped booking limits the next move to that booking', () => {
  assert.equal(bookingMoveScope({
    booking: bookings[0],
    groupSize: 2,
    selectedBookingId: bookings[0].id,
    moveTogether: false,
  }), BOOKING_MOVE_SCOPE_SINGLE)
})

test('an unlocked selection never leaks to a different booking', () => {
  assert.equal(bookingMoveScope({
    booking: bookings[1],
    groupSize: 2,
    selectedBookingId: bookings[0].id,
    moveTogether: false,
  }), BOOKING_MOVE_SCOPE_GROUP)
})

test('individual resize preview changes only the dragged booking', () => {
  const resizeDrag = { booking: bookings[0], moveScope: BOOKING_MOVE_SCOPE_SINGLE }
  assert.equal(resizeAppliesToBooking(resizeDrag, bookings[0]), true)
  assert.equal(resizeAppliesToBooking(resizeDrag, bookings[1]), false)
})

test('group resize preview changes every active member of the group', () => {
  const resizeDrag = { booking: bookings[0], moveScope: BOOKING_MOVE_SCOPE_GROUP }
  assert.equal(resizeAppliesToBooking(resizeDrag, bookings[0]), true)
  assert.equal(resizeAppliesToBooking(resizeDrag, bookings[1]), true)
  assert.equal(resizeAppliesToBooking(resizeDrag, bookings[2]), false)
})

test('canonical effective Session takes precedence over legacy group source', () => {
  const effectiveSessionId = crypto.randomUUID()
  const rows = [
    { id: 'one', effective_session_id: effectiveSessionId, booking_group_id: crypto.randomUUID(), status: 'confirmed' },
    { id: 'two', effective_session_id: effectiveSessionId, booking_group_id: crypto.randomUUID(), status: 'held' },
  ]
  assert.deepEqual(activeBookingGroup(rows, rows[0]).map((booking) => booking.id), ['one', 'two'])
})
