// A muted mineral palette assembled and checked in Coolors. Each entry keeps
// white text above WCAG AA contrast while remaining visually distinct.
const CUSTOMER_PALETTE = [
  { name: 'petrol', start: '#386A7A', end: '#284D5C' },
  { name: 'juniper', start: '#3C746B', end: '#2B564F' },
  { name: 'moss', start: '#55724A', end: '#3D5638' },
  { name: 'olive', start: '#6F713C', end: '#53552E' },
  { name: 'ochre', start: '#8B642F', end: '#684923' },
  { name: 'terracotta', start: '#99503E', end: '#74392F' },
  { name: 'garnet', start: '#94454C', end: '#6F3339' },
  { name: 'mulberry', start: '#88475F', end: '#653448' },
  { name: 'plum', start: '#724E75', end: '#553A59' },
  { name: 'indigo', start: '#5C5582', end: '#433E63' },
  { name: 'slate', start: '#465E87', end: '#34466A' },
  { name: 'umber', start: '#725A43', end: '#544230' },
]

const stableHash = (value) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const customerIdentityForBooking = (booking) => String([
  booking.customer_email,
  booking.customer_phone,
  booking.customer_name,
  booking.user_id,
  booking.booking_group_id,
  booking.id,
].find((value) => String(value || '').trim()) || 'guest').trim().toLocaleLowerCase()

// Prefer a stable hash so a regular customer normally keeps the same color.
// Resolve collisions within the visible day so two customers do not become
// visually indistinguishable just because their hashes land on the same slot.
export const createCustomerColorMap = (bookings) => {
  const identities = [...new Set(bookings.map(customerIdentityForBooking))]
    .sort((left, right) => stableHash(left) - stableHash(right) || left.localeCompare(right))
  const occupied = new Set()
  const colorMap = new Map()

  identities.forEach((identity, position) => {
    const preferred = stableHash(identity) % CUSTOMER_PALETTE.length
    let paletteIndex = preferred

    if (occupied.size < CUSTOMER_PALETTE.length) {
      for (let offset = 0; offset < CUSTOMER_PALETTE.length; offset += 1) {
        const candidate = (preferred + offset) % CUSTOMER_PALETTE.length
        if (!occupied.has(candidate)) {
          paletteIndex = candidate
          break
        }
      }
      occupied.add(paletteIndex)
    } else {
      paletteIndex = (preferred + Math.floor(position / CUSTOMER_PALETTE.length)) % CUSTOMER_PALETTE.length
    }

    colorMap.set(identity, paletteIndex)
  })

  return colorMap
}

export const customerColorForBooking = (booking, colorMap) => {
  const identity = customerIdentityForBooking(booking)
  const paletteIndex = colorMap?.get(identity) ?? stableHash(identity) % CUSTOMER_PALETTE.length
  return {
    index: paletteIndex + 1,
    ...CUSTOMER_PALETTE[paletteIndex],
  }
}
