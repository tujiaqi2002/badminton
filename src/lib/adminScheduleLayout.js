const DEFAULT_SLOT_MINUTES = 30
const PIXELS_PER_MINUTE = 1

export const normalizeAdminScheduleSlotMinutes = (value) => {
  const minutes = Number(value)
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SLOT_MINUTES
}

export const adminScheduleSlotHeightPx = (slotMinutes) => (
  normalizeAdminScheduleSlotMinutes(slotMinutes) * PIXELS_PER_MINUTE
)

export const adminScheduleOffsetPx = (slotOffset, slotMinutes) => {
  const offset = Number(slotOffset)
  return Number.isFinite(offset) ? offset * adminScheduleSlotHeightPx(slotMinutes) : 0
}
