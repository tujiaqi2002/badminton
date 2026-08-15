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

// Court-first spectrum inspired by the five elemental pigments in the venue
// artwork. These are only hue anchors: party size controls the visible depth
// band, while the stable customer slot creates small variations inside that
// court's colour family. It therefore scales far beyond five customers without
// losing the instant "which court is this?" cue.
const COURT_ORIGIN_BASES = [
  { name: 'ivory', hex: '#C9BFA8', saturation: [12, 30], lightness: [44, 82] },
  { name: 'cyan', hex: '#3B8A91', saturation: [32, 58], lightness: [28, 68] },
  { name: 'ink', hex: '#3D4142', saturation: [3, 32], lightness: [17, 62] },
  { name: 'cinnabar', hex: '#A84A3F', saturation: [38, 64], lightness: [27, 68] },
  { name: 'amber', hex: '#B88A36', saturation: [38, 68], lightness: [30, 72] },
]

const COURT_ORIGIN_SCHEME = 'court-origins'

const PALETTES = {
  mineral: MINERAL_PALETTE,
  signal: WARM_PALETTE,
  teahouse: TEAHOUSE_PALETTE,
  autumn: AUTUMN_PALETTE,
  cream: CREAM_PALETTE,
}

// A theme's swatches are anchors, not a hard limit. The schedule derives a
// large, deterministic colour field from them so busy days are not reduced to
// five repeating cards. 4093 is prime, which makes the probing sequence visit
// every slot before it repeats.
const GENERATED_COLOR_SLOTS = 4093
const COLOR_CANDIDATES_PER_CUSTOMER = 32
const COLOR_PROBE_STEP = 1597
const LIGHT_INK = '#FFF9F1'
const DARK_INK = '#211D17'
// Leave a small margin because the final HSL values are rounded to 8-bit hex.
const MINIMUM_TEXT_CONTRAST = 4.6

export const DEFAULT_BOOKING_COLOR_SCHEME = 'mineral'

export const BOOKING_COLOR_SCHEMES = [
  {
    id: COURT_ORIGIN_SCHEME,
    nameKey: 'settings.bookingColorsCourtOrigins',
    noteKey: 'settings.bookingColorsCourtOriginsNote',
    swatches: COURT_ORIGIN_BASES.map(({ hex }) => hex),
  },
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

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))

const hexToRgb = (hex) => {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

const rgbToHex = ({ r, g, b }) => `#${[r, g, b]
  .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0'))
  .join('')}`.toUpperCase()

const rgbToHsl = ({ r, g, b }) => {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const lightness = (maximum + minimum) / 2
  const delta = maximum - minimum

  if (delta === 0) return { h: 0, s: 0, l: lightness * 100 }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6)
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2)
  else hue = 60 * ((red - green) / delta + 4)

  return { h: (hue + 360) % 360, s: saturation * 100, l: lightness * 100 }
}

const hslToRgb = ({ h, s, l }) => {
  const saturation = s / 100
  const lightness = l / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const section = ((h % 360) + 360) % 360 / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary]
  const match = lightness - chroma / 2

  return { r: (red + match) * 255, g: (green + match) * 255, b: (blue + match) * 255 }
}

const radicalInverse = (index, base) => {
  let value = 0
  let denominator = 1
  let remaining = index
  while (remaining > 0) {
    denominator *= base
    value += (remaining % base) / denominator
    remaining = Math.floor(remaining / base)
  }
  return value
}

const relativeLuminance = (rgb) => {
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const contrastRatio = (first, second) => {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

// OKLab is used only for spacing colours. Unlike raw RGB/HSL distance, it
// tracks how different two colours actually look to a person.
const rgbToOklab = ({ r, g, b }) => {
  const linearize = (channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const red = linearize(r)
  const green = linearize(g)
  const blue = linearize(b)
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

const oklabDistance = (left, right) => Math.sqrt(
  ((left.l - right.l) * 1.35) ** 2
  + (left.a - right.a) ** 2
  + (left.b - right.b) ** 2,
)

const readableCardPair = (startRgb, endRgb) => {
  const variants = [
    { foreground: LIGHT_INK, direction: -1 },
    { foreground: DARK_INK, direction: 1 },
  ].map(({ foreground, direction }) => {
    const foregroundRgb = hexToRgb(foreground)
    const startHsl = rgbToHsl(startRgb)
    const endHsl = rgbToHsl(endRgb)
    let adjustment = 0
    let adjustedStart = startRgb
    let adjustedEnd = endRgb
    let minimumContrast = Math.min(contrastRatio(adjustedStart, foregroundRgb), contrastRatio(adjustedEnd, foregroundRgb))

    while (minimumContrast < MINIMUM_TEXT_CONTRAST && adjustment < 36) {
      adjustment += 1
      adjustedStart = hslToRgb({ ...startHsl, l: clamp(startHsl.l + adjustment * direction, 18, 78) })
      adjustedEnd = hslToRgb({ ...endHsl, l: clamp(endHsl.l + adjustment * direction, 18, 78) })
      minimumContrast = Math.min(contrastRatio(adjustedStart, foregroundRgb), contrastRatio(adjustedEnd, foregroundRgb))
    }

    return { foreground, startRgb: adjustedStart, endRgb: adjustedEnd, adjustment, minimumContrast }
  })

  return variants.sort((left, right) => left.adjustment - right.adjustment || right.minimumContrast - left.minimumContrast)[0]
}

const generatedColorForSlot = (palette, slot) => {
  const anchorIndex = slot % palette.length
  const tier = Math.floor(slot / palette.length)
  const anchor = palette[anchorIndex]

  if (tier === 0) {
    const readable = readableCardPair(hexToRgb(anchor.start), hexToRgb(anchor.end))
    return {
      name: anchor.name,
      start: rgbToHex(readable.startRgb),
      end: rgbToHex(readable.endRgb),
      foreground: readable.foreground,
      textShadow: readable.foreground === LIGHT_INK ? '0 1px 1px rgba(24,25,23,.24)' : '0 1px 1px rgba(255,249,241,.18)',
      lab: rgbToOklab(readable.startRgb),
    }
  }

  const anchorHsl = rgbToHsl(hexToRgb(anchor.start))
  const sequenceIndex = tier + 1
  const hueShift = (radicalInverse(sequenceIndex, 2) * 2 - 1) * 15
  const saturationShift = (radicalInverse(sequenceIndex, 3) * 2 - 1) * 14
  const lightnessShift = (radicalInverse(sequenceIndex, 5) * 2 - 1) * 13
  const startHsl = {
    h: (anchorHsl.h + hueShift + 360) % 360,
    s: clamp(anchorHsl.s + saturationShift, 24, 58),
    l: clamp(anchorHsl.l + lightnessShift, 35, 62),
  }
  const endHsl = {
    h: (startHsl.h + (radicalInverse(sequenceIndex, 7) * 4 - 2) + 360) % 360,
    s: clamp(startHsl.s + 2, 24, 60),
    l: clamp(startHsl.l - 10, 27, 52),
  }
  const startRgb = hslToRgb(startHsl)
  const endRgb = hslToRgb(endHsl)
  const readable = readableCardPair(startRgb, endRgb)

  return {
    name: `${anchor.name}-${tier}`,
    start: rgbToHex(readable.startRgb),
    end: rgbToHex(readable.endRgb),
    foreground: readable.foreground,
    textShadow: readable.foreground === LIGHT_INK ? '0 1px 1px rgba(24,25,23,.24)' : '0 1px 1px rgba(255,249,241,.18)',
    lab: rgbToOklab(readable.startRgb),
  }
}

const stableHash = (value) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const courtIndexForBooking = (booking) => {
  const match = String(booking?.court_id || '').match(/([1-5])$/)
  if (match) return Number(match[1]) - 1
  return stableHash(String(booking?.court_id || 'court')) % COURT_ORIGIN_BASES.length
}

const partyDepthForBooking = (booking) => {
  const people = Math.max(1, Number(booking?.party_size || 2))
  if (people <= 1) return 0
  if (people <= 2) return 1
  if (people <= 4) return 2
  if (people <= 6) return 3
  return 4
}

const generatedCourtOriginColor = (booking, slot) => {
  const base = COURT_ORIGIN_BASES[courtIndexForBooking(booking)]
  const baseHsl = rgbToHsl(hexToRgb(base.hex))
  const depth = partyDepthForBooking(booking)
  // Large, ordered lightness bands make party size readable at a glance.
  // Low-discrepancy customer offsets then create thousands of stable variants
  // without allowing neighbouring bands to collapse into one another.
  const depthShift = [15, 8, 1, -6, -13][depth]
  const sequence = slot + 1
  // Neutral ink needs a wider chroma window than the coloured families;
  // otherwise many generated HSL values round to the same RGB swatch.
  const hueWindow = base.name === 'ink' ? 16 : 8
  const saturationWindow = base.name === 'ink' ? 14 : 8
  const lightnessWindow = base.name === 'ink' ? 5.8 : 2.8
  const hueJitter = (radicalInverse(sequence, 2) * 2 - 1) * hueWindow
  const saturationJitter = (radicalInverse(sequence, 3) * 2 - 1) * saturationWindow
  const lightnessJitter = (radicalInverse(sequence, 5) * 2 - 1) * lightnessWindow
  const startHsl = {
    h: (baseHsl.h + hueJitter + 360) % 360,
    s: clamp(baseHsl.s + saturationJitter, base.saturation[0], base.saturation[1]),
    l: clamp(baseHsl.l + depthShift + lightnessJitter, base.lightness[0], base.lightness[1]),
  }
  const endHsl = {
    h: (startHsl.h + (radicalInverse(sequence, 7) * 3 - 1.5) + 360) % 360,
    s: clamp(startHsl.s + 2, base.saturation[0], base.saturation[1]),
    l: clamp(startHsl.l - 8, base.lightness[0] - 2, base.lightness[1] - 3),
  }
  const readable = readableCardPair(hslToRgb(startHsl), hslToRgb(endHsl))
  return {
    name: `${base.name}-people-${depth + 1}-${slot}`,
    start: rgbToHex(readable.startRgb),
    end: rgbToHex(readable.endRgb),
    foreground: readable.foreground,
    textShadow: readable.foreground === LIGHT_INK
      ? '0 1px 1px rgba(24,25,23,.24)'
      : '0 1px 1px rgba(255,249,241,.18)',
  }
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
  if (scheme === COURT_ORIGIN_SCHEME) {
    const identities = [...new Set(bookings.map(customerIdentityForBooking))]
      .sort((left, right) => stableHash(left) - stableHash(right) || left.localeCompare(right))
    const occupied = new Set()
    return new Map(identities.map((identity) => {
      let slot = stableHash(identity) % GENERATED_COLOR_SLOTS
      while (occupied.has(slot)) slot = (slot + COLOR_PROBE_STEP) % GENERATED_COLOR_SLOTS
      occupied.add(slot)
      return [identity, slot]
    }))
  }
  const palette = paletteFor(scheme)
  const identities = [...new Set(bookings.map(customerIdentityForBooking))]
    .sort((left, right) => stableHash(left) - stableHash(right) || left.localeCompare(right))
  const occupiedSlots = new Set()
  const occupiedColors = new Set()
  const selectedColors = []
  const colorMap = new Map()

  identities.forEach((identity) => {
    const preferred = stableHash(identity) % GENERATED_COLOR_SLOTS
    let bestCandidate = null

    for (let attempt = 0; attempt < COLOR_CANDIDATES_PER_CUSTOMER; attempt += 1) {
      const slot = (preferred + attempt * COLOR_PROBE_STEP) % GENERATED_COLOR_SLOTS
      if (occupiedSlots.has(slot)) continue
      const color = generatedColorForSlot(palette, slot)
      const colorKey = `${color.start}-${color.end}`
      if (occupiedColors.has(colorKey)) continue
      const minimumDistance = selectedColors.length
        ? Math.min(...selectedColors.map((selected) => oklabDistance(color.lab, selected.lab)))
        : Number.POSITIVE_INFINITY
      // A tiny probe penalty keeps the stable, identity-derived slot when it is
      // already sufficiently distinct, while still resolving close neighbours.
      const score = minimumDistance - attempt * 0.00015
      if (!bestCandidate || score > bestCandidate.score) bestCandidate = { slot, color, colorKey, score }
    }

    if (!bestCandidate) {
      for (let offset = 0; offset < GENERATED_COLOR_SLOTS; offset += 1) {
        const slot = (preferred + offset) % GENERATED_COLOR_SLOTS
        if (occupiedSlots.has(slot)) continue
        const color = generatedColorForSlot(palette, slot)
        const colorKey = `${color.start}-${color.end}`
        if (!occupiedColors.has(colorKey)) {
          bestCandidate = { slot, color, colorKey }
          break
        }
      }
    }

    const assigned = bestCandidate || { slot: preferred, color: generatedColorForSlot(palette, preferred) }
    occupiedSlots.add(assigned.slot)
    occupiedColors.add(assigned.colorKey || `${assigned.color.start}-${assigned.color.end}`)
    selectedColors.push(assigned.color)
    colorMap.set(identity, assigned.slot)
  })

  return colorMap
}

export const customerColorForBooking = (booking, colorMap, scheme = DEFAULT_BOOKING_COLOR_SCHEME) => {
  const identity = customerIdentityForBooking(booking)
  const colorSlot = colorMap?.get(identity) ?? stableHash(identity) % GENERATED_COLOR_SLOTS
  if (scheme === COURT_ORIGIN_SCHEME) {
    return { index: colorSlot + 1, ...generatedCourtOriginColor(booking, colorSlot) }
  }
  const palette = paletteFor(scheme)
  const generated = generatedColorForSlot(palette, colorSlot)
  return {
    index: colorSlot + 1,
    ...generated,
    lab: undefined,
  }
}
