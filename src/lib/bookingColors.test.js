import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOKING_COLOR_SCHEMES,
  createCustomerColorMap,
  customerColorForBooking,
  customerIdentityForBooking,
} from './bookingColors.js'

const bookingFor = (index, court = 1) => ({
  id: `booking-${index}`,
  customer_name: `Customer ${index}`,
  customer_email: `customer-${index}@example.invalid`,
  court_id: `10000000-0000-0000-0000-00000000000${court}`,
})

const relativeLuminance = (hex) => {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

const contrastRatio = (first, second) => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

test('default schedule palette stays deterministic with a bounded visual vocabulary', () => {
  const bookings = Array.from({ length: 24 }, (_, index) => bookingFor(index + 1))
  const forward = createCustomerColorMap(bookings)
  const reversed = createCustomerColorMap([...bookings].reverse())

  bookings.forEach((booking) => {
    const identity = customerIdentityForBooking(booking)
    assert.equal(forward.get(identity), reversed.get(identity))
  })

  assert.equal(new Set(forward.values()).size, 12)
  const fills = bookings.map((booking) => customerColorForBooking(booking, forward))
  assert.ok(new Set(fills.map(({ start }) => start)).size <= 12)
  fills.forEach((color) => {
    assert.equal(color.start, color.end)
    assert.equal(color.textShadow, 'none')
    assert.ok(contrastRatio(color.start, color.foreground) >= 4.5)
  })
})

test('court origin mode uses one flat colour per court', () => {
  const firstCustomer = bookingFor(1, 1)
  const secondCustomer = bookingFor(2, 1)
  const otherCourt = bookingFor(3, 2)
  const bookings = [firstCustomer, secondCustomer, otherCourt]
  const colorMap = createCustomerColorMap(bookings, 'court-origins')
  const first = customerColorForBooking(firstCustomer, colorMap, 'court-origins')
  const second = customerColorForBooking(secondCustomer, colorMap, 'court-origins')
  const other = customerColorForBooking(otherCourt, colorMap, 'court-origins')

  assert.equal(first.start, second.start)
  assert.equal(first.start, first.end)
  assert.notEqual(first.start, other.start)
})

test('every selectable palette keeps flat fills and readable text', () => {
  const bookings = Array.from({ length: 12 }, (_, index) => bookingFor(index + 1, index % 5 + 1))

  BOOKING_COLOR_SCHEMES.forEach(({ id }) => {
    const colorMap = createCustomerColorMap(bookings, id)
    bookings.forEach((booking) => {
      const color = customerColorForBooking(booking, colorMap, id)
      assert.equal(color.start, color.end, id)
      assert.ok(contrastRatio(color.start, color.foreground) >= 4.5, id)
    })
  })
})
