export const BOOKING_MOVE_SCOPE_GROUP = 'group'
export const BOOKING_MOVE_SCOPE_SINGLE = 'single'

const ACTIVE_BOOKING_STATUSES = new Set(['held', 'confirmed'])

export const bookingGroupKey = (booking) => (
  booking?.effective_session_id || booking?.booking_group_id || booking?.id || null
)

export const activeBookingGroup = (bookings, booking) => {
  const groupKey = bookingGroupKey(booking)
  if (!groupKey) return []
  return bookings.filter((item) => (
    bookingGroupKey(item) === groupKey && ACTIVE_BOOKING_STATUSES.has(item.status)
  ))
}

export const activeBookingGroupSize = (bookings, booking) => activeBookingGroup(bookings, booking).length

export const bookingMoveScope = ({ booking, groupSize, selectedBookingId, moveTogether }) => (
  groupSize > 1 && (selectedBookingId !== booking.id || moveTogether)
    ? BOOKING_MOVE_SCOPE_GROUP
    : BOOKING_MOVE_SCOPE_SINGLE
)

export const resizeAppliesToBooking = (resizeDrag, booking) => {
  if (!resizeDrag) return false
  if (resizeDrag.moveScope === BOOKING_MOVE_SCOPE_SINGLE) return resizeDrag.booking.id === booking.id
  return bookingGroupKey(resizeDrag.booking) === bookingGroupKey(booking)
}
