const MINERAL_PALETTE = [
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

// Low-saturation warmth keeps large booking cards comfortable to scan while
// terracotta, caramel, ochre, sage and stone remain easy to distinguish.
const WARM_PALETTE = [
  { name: 'terracotta', start: '#A85D48', end: '#7E4435', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(63,34,27,.28)' },
  { name: 'caramel', start: '#C48A5A', end: '#A8754C', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.18)' },
  { name: 'ochre', start: '#9A8A57', end: '#817449', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.16)' },
  { name: 'sage', start: '#687A61', end: '#4D5B48', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(30,38,28,.28)' },
  { name: 'stone', start: '#66717A', end: '#4B545B', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(25,31,36,.28)' },
]

const TEAHOUSE_PALETTE = [
  { name: 'clay', start: '#8C4F3D', end: '#693A2E', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(56,29,23,.3)' },
  { name: 'tea', start: '#B06F4A', end: '#9B613F', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.16)' },
  { name: 'straw', start: '#A48A56', end: '#877144', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.16)' },
  { name: 'olive', start: '#6F7758', end: '#535A42', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(30,35,24,.28)' },
  { name: 'plum', start: '#69586A', end: '#4E414F', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(28,22,29,.28)' },
]

const AUTUMN_PALETTE = [
  { name: 'cranberry', start: '#924A4D', end: '#6D383A', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(53,24,25,.3)' },
  { name: 'copper', start: '#B76E50', end: '#8E553E', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(62,35,25,.28)' },
  { name: 'wheat', start: '#B39A61', end: '#94804F', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.16)' },
  { name: 'moss', start: '#6F7B5A', end: '#535C43', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(29,35,24,.28)' },
  { name: 'mulberry', start: '#725D73', end: '#554556', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(30,23,31,.28)' },
]

const CREAM_PALETTE = [
  { name: 'rose-clay', start: '#C98268', end: '#AC6D57', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.18)' },
  { name: 'apricot', start: '#D9A66F', end: '#BC8F60', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.18)' },
  { name: 'sand', start: '#B5A06F', end: '#98875E', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.18)' },
  { name: 'soft-sage', start: '#879075', end: '#7B826A', foreground: '#211D17', textShadow: '0 1px 1px rgba(255,249,241,.16)' },
  { name: 'dusty-mauve', start: '#847083', end: '#6F5E6E', foreground: '#FFF9F1', textShadow: '0 1px 1px rgba(34,27,34,.26)' },
]

const PALETTES = {
  mineral: MINERAL_PALETTE,
  signal: WARM_PALETTE,
  teahouse: TEAHOUSE_PALETTE,
  autumn: AUTUMN_PALETTE,
  cream: CREAM_PALETTE,
}

export const DEFAULT_BOOKING_COLOR_SCHEME = 'mineral'

export const BOOKING_COLOR_SCHEMES = [
  {
    id: 'mineral',
    nameKey: 'settings.bookingColorsMineral',
    noteKey: 'settings.bookingColorsMineralNote',
    swatches: MINERAL_PALETTE.slice(0, 5).map(({ start }) => start),
  },
  {
    id: 'signal',
    nameKey: 'settings.bookingColorsSignal',
    noteKey: 'settings.bookingColorsSignalNote',
    swatches: ['#A85D48', '#C48A5A', '#9A8A57', '#687A61', '#66717A'],
  },
  {
    id: 'teahouse',
    nameKey: 'settings.bookingColorsTeahouse',
    noteKey: 'settings.bookingColorsTeahouseNote',
    swatches: ['#8C4F3D', '#B06F4A', '#A48A56', '#6F7758', '#69586A'],
  },
  {
    id: 'autumn',
    nameKey: 'settings.bookingColorsAutumn',
    noteKey: 'settings.bookingColorsAutumnNote',
    swatches: ['#924A4D', '#B76E50', '#B39A61', '#6F7B5A', '#725D73'],
  },
  {
    id: 'cream',
    nameKey: 'settings.bookingColorsCream',
    noteKey: 'settings.bookingColorsCreamNote',
    swatches: ['#C98268', '#D9A66F', '#B5A06F', '#879075', '#847083'],
  },
]

const paletteFor = (scheme) => PALETTES[scheme] || PALETTES[DEFAULT_BOOKING_COLOR_SCHEME]

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
export const createCustomerColorMap = (bookings, scheme = DEFAULT_BOOKING_COLOR_SCHEME) => {
  const palette = paletteFor(scheme)
  const identities = [...new Set(bookings.map(customerIdentityForBooking))]
    .sort((left, right) => stableHash(left) - stableHash(right) || left.localeCompare(right))
  const occupied = new Set()
  const colorMap = new Map()

  identities.forEach((identity, position) => {
    const preferred = stableHash(identity) % palette.length
    let paletteIndex = preferred

    if (occupied.size < palette.length) {
      for (let offset = 0; offset < palette.length; offset += 1) {
        const candidate = (preferred + offset) % palette.length
        if (!occupied.has(candidate)) {
          paletteIndex = candidate
          break
        }
      }
      occupied.add(paletteIndex)
    } else {
      paletteIndex = (preferred + Math.floor(position / palette.length)) % palette.length
    }

    colorMap.set(identity, paletteIndex)
  })

  return colorMap
}

export const customerColorForBooking = (booking, colorMap, scheme = DEFAULT_BOOKING_COLOR_SCHEME) => {
  const palette = paletteFor(scheme)
  const identity = customerIdentityForBooking(booking)
  const paletteIndex = colorMap?.get(identity) ?? stableHash(identity) % palette.length
  return {
    index: paletteIndex + 1,
    foreground: '#FFFDF8',
    textShadow: '0 1px 1px rgba(24,25,23,.2)',
    ...palette[paletteIndex],
  }
}
