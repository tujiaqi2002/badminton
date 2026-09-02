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
// artwork. This mode intentionally uses one learned colour per court so the
// grid remains an information map instead of creating another customer shade
// inside every court family.
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

// A manager only needs to distinguish the bookings visible together, not learn
// thousands of one-off colours. Twelve stable slots cover a busy five-court
// day while keeping the palette small enough to become familiar. Colours are
// deliberately reused after the visible vocabulary is exhausted.
const GENERATED_COLOR_SLOTS = 12
const COLOR_CANDIDATES_PER_CUSTOMER = GENERATED_COLOR_SLOTS
const COLOR_PROBE_STEP = 5
const LIGHT_INK = '#FFF9F1'
const DARK_INK = '#211D17'
// Every generated booking card sits on the same perceptual brightness plane.
// Hue and chroma may vary, but OKLab lightness does not. This avoids yellow or
// cyan cards appearing much brighter than plum, blue or brown cards.
const CARD_START_OKLAB_LIGHTNESS = 0.50
const CARD_END_OKLAB_LIGHTNESS = 0.43
// Leave a small margin because the final HSL values are rounded to 8-bit hex.
const MINIMUM_TEXT_CONTRAST = 4.6

export const DEFAULT_BOOKING_COLOR_SCHEME = 'mineral'

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

const oklabToRgb = ({ l, a, b }) => {
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = {
    r: 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    g: -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    b: -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  }
  const encode = (channel) => 255 * (channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * channel ** (1 / 2.4) - 0.055)
  return { r: encode(linear.r), g: encode(linear.g), b: encode(linear.b) }
}

const isRgbInGamut = ({ r, g, b }) => [r, g, b].every((channel) => channel >= 0 && channel <= 255)

const rgbAtPerceptualLightness = (rgb, targetLightness) => {
  const lab = rgbToOklab(rgb)
  // Preserve hue while gently reducing chroma only when the target lightness
  // would otherwise put the colour outside the displayable sRGB gamut.
  for (let chromaScale = 1; chromaScale >= 0; chromaScale -= 0.025) {
    const candidate = oklabToRgb({
      l: targetLightness,
      a: lab.a * chromaScale,
      b: lab.b * chromaScale,
    })
    if (isRgbInGamut(candidate)) return candidate
  }
  return oklabToRgb({ l: targetLightness, a: 0, b: 0 })
}

const uniformCardPair = (startRgb, endRgb) => {
  const normalizedStart = rgbAtPerceptualLightness(startRgb, CARD_START_OKLAB_LIGHTNESS)
  const normalizedEnd = rgbAtPerceptualLightness(endRgb, CARD_END_OKLAB_LIGHTNESS)
  const candidates = [LIGHT_INK, DARK_INK].map((foreground) => {
    const foregroundRgb = hexToRgb(foreground)
    return {
      foreground,
      minimumContrast: Math.min(
        contrastRatio(normalizedStart, foregroundRgb),
        contrastRatio(normalizedEnd, foregroundRgb),
      ),
    }
  })
  const bestForeground = candidates.sort((left, right) => right.minimumContrast - left.minimumContrast)[0]

  return {
    startRgb: normalizedStart,
    endRgb: normalizedEnd,
    foreground: bestForeground.foreground,
    minimumContrast: bestForeground.minimumContrast,
  }
}

const previewSwatch = (hex) => rgbToHex(rgbAtPerceptualLightness(hexToRgb(hex), CARD_START_OKLAB_LIGHTNESS))

export const BOOKING_COLOR_SCHEMES = [
  {
    id: COURT_ORIGIN_SCHEME,
    nameKey: 'settings.bookingColorsCourtOrigins',
    noteKey: 'settings.bookingColorsCourtOriginsNote',
    swatches: COURT_ORIGIN_BASES.map(({ hex }) => previewSwatch(hex)),
  },
  {
    id: 'mineral',
    nameKey: 'settings.bookingColorsMineral',
    noteKey: 'settings.bookingColorsMineralNote',
    swatches: MINERAL_PALETTE.slice(0, 5).map(({ start }) => previewSwatch(start)),
  },
  {
    id: 'signal',
    nameKey: 'settings.bookingColorsSignal',
    noteKey: 'settings.bookingColorsSignalNote',
    swatches: WARM_PALETTE.map(({ start }) => previewSwatch(start)),
  },
  {
    id: 'teahouse',
    nameKey: 'settings.bookingColorsTeahouse',
    noteKey: 'settings.bookingColorsTeahouseNote',
    swatches: TEAHOUSE_PALETTE.map(({ start }) => previewSwatch(start)),
  },
  {
    id: 'autumn',
    nameKey: 'settings.bookingColorsAutumn',
    noteKey: 'settings.bookingColorsAutumnNote',
    swatches: AUTUMN_PALETTE.map(({ start }) => previewSwatch(start)),
  },
  {
    id: 'cream',
    nameKey: 'settings.bookingColorsCream',
    noteKey: 'settings.bookingColorsCreamNote',
    swatches: CREAM_PALETTE.map(({ start }) => previewSwatch(start)),
  },
]

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
    const uniform = uniformCardPair(readable.startRgb, readable.endRgb)
    return {
      name: anchor.name,
      start: rgbToHex(uniform.startRgb),
      end: rgbToHex(uniform.endRgb),
      foreground: uniform.foreground,
      textShadow: uniform.foreground === LIGHT_INK ? '0 1px 1px rgba(24,25,23,.24)' : '0 1px 1px rgba(255,249,241,.18)',
      lab: rgbToOklab(uniform.startRgb),
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
  const uniform = uniformCardPair(readable.startRgb, readable.endRgb)

  return {
    name: `${anchor.name}-${tier}`,
    start: rgbToHex(uniform.startRgb),
    end: rgbToHex(uniform.endRgb),
    foreground: uniform.foreground,
    textShadow: uniform.foreground === LIGHT_INK ? '0 1px 1px rgba(24,25,23,.24)' : '0 1px 1px rgba(255,249,241,.18)',
    lab: rgbToOklab(uniform.startRgb),
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

const generatedCourtOriginColor = (booking) => {
  const base = COURT_ORIGIN_BASES[courtIndexForBooking(booking)]
  const uniform = uniformCardPair(hexToRgb(base.hex), hexToRgb(base.hex))
  const fill = rgbToHex(uniform.startRgb)
  return {
    name: base.name,
    start: fill,
    end: fill,
    foreground: uniform.foreground,
    textShadow: 'none',
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

// Stable hashes let regular customers normally keep the same color. The
// default schemes probe unused slots while the bounded 12-color vocabulary has
// room, then intentionally reuse those slots once the vocabulary is exhausted.
export const createCustomerColorMap = (bookings, scheme = DEFAULT_BOOKING_COLOR_SCHEME) => {
  if (scheme === COURT_ORIGIN_SCHEME) {
    const identities = [...new Set(bookings.map(customerIdentityForBooking))]
      .sort((left, right) => stableHash(left) - stableHash(right) || left.localeCompare(right))
    return new Map(identities.map((identity) => [identity, stableHash(identity) % GENERATED_COLOR_SLOTS]))
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
    return { index: colorSlot + 1, ...generatedCourtOriginColor(booking) }
  }
  const palette = paletteFor(scheme)
  const generated = generatedColorForSlot(palette, colorSlot)
  return {
    index: colorSlot + 1,
    ...generated,
    end: generated.start,
    textShadow: 'none',
    lab: undefined,
  }
}
