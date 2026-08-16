import { addDays, toDateKey } from './booking.js'

const ACTIVE_STATUSES = new Set(['held', 'confirmed'])

const timestampAtMinute = (dateKey, minute) => {
  if (minute < 24 * 60) {
    const hours = String(Math.floor(minute / 60)).padStart(2, '0')
    const minutes = String(minute % 60).padStart(2, '0')
    return `${dateKey}T${hours}:${minutes}:00`
  }
  return `${toDateKey(addDays(new Date(`${dateKey}T12:00:00`), 1))}T00:00:00`
}

const overlaps = (leftStart, leftEnd, rightStart, rightEnd) => (
  leftStart < rightEnd && leftEnd > rightStart
)

export const bookingSwapPreview = ({
  bookings,
  sourceBooking,
  targetCourtId,
  targetDate,
  targetStartMinute,
  duration,
}) => {
  const targetStartAt = timestampAtMinute(targetDate, targetStartMinute)
  const targetEndAt = timestampAtMinute(targetDate, targetStartMinute + duration)

  if (
    sourceBooking.court_id === targetCourtId
    && sourceBooking.start_at === targetStartAt
    && sourceBooking.end_at === targetEndAt
  ) {
    return { mode: 'unchanged', targetStartAt, targetEndAt, bookings: [] }
  }

  const occupied = bookings
    .filter((booking) => (
      booking.id !== sourceBooking.id
      && booking.court_id === targetCourtId
      && ACTIVE_STATUSES.has(booking.status)
      && overlaps(booking.start_at, booking.end_at, targetStartAt, targetEndAt)
    ))
    .sort((left, right) => left.start_at.localeCompare(right.start_at) || left.id.localeCompare(right.id))

  if (!occupied.length) return { mode: 'move', targetStartAt, targetEndAt, bookings: [] }

  let cursor = targetStartAt
  for (const booking of occupied) {
    if (booking.start_at !== cursor || booking.end_at <= booking.start_at || booking.end_at > targetEndAt) {
      return { mode: 'invalid', reason: 'coverage_mismatch', targetStartAt, targetEndAt, bookings: occupied }
    }
    cursor = booking.end_at
  }

  if (cursor !== targetEndAt) {
    return { mode: 'invalid', reason: 'coverage_mismatch', targetStartAt, targetEndAt, bookings: occupied }
  }

  return { mode: 'swap', targetStartAt, targetEndAt, bookings: occupied }
}
