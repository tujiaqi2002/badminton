const LIGHTNESS_STEPS = [-7, -5, -3, -1, 1, 3, 5]
const HUE_STEPS = [-12, -8, -4, 0, 4, 8, 12]
const SATURATION_STEPS = [-6, -3, 0, 3, 6]

const stableHash = (value) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const customerIdentity = (booking) => [
  booking.customer_email,
  booking.customer_phone,
  booking.customer_name,
  booking.user_id,
  booking.booking_group_id,
  booking.id,
].find((value) => String(value || '').trim())

export const customerToneForBooking = (booking) => {
  const identity = String(customerIdentity(booking) || 'guest').trim().toLocaleLowerCase()
  const hash = stableHash(identity)
  const lightnessIndex = hash % LIGHTNESS_STEPS.length
  const hueIndex = Math.floor(hash / LIGHTNESS_STEPS.length) % HUE_STEPS.length
  const saturationIndex = Math.floor(hash / (LIGHTNESS_STEPS.length * HUE_STEPS.length)) % SATURATION_STEPS.length
  return {
    index: (lightnessIndex * HUE_STEPS.length * SATURATION_STEPS.length) + (hueIndex * SATURATION_STEPS.length) + saturationIndex + 1,
    hue: HUE_STEPS[hueIndex],
    lightness: LIGHTNESS_STEPS[lightnessIndex],
    saturation: SATURATION_STEPS[saturationIndex],
  }
}
