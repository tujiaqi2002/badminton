export const COURTS = [
  { id: '10000000-0000-0000-0000-000000000001', name: '壹', english: 'Court 1', note: '壹号场地', noteEn: 'Court one', tone: 'wind' },
  { id: '10000000-0000-0000-0000-000000000002', name: '贰', english: 'Court 2', note: '贰号场地', noteEn: 'Court two', tone: 'forest' },
  { id: '10000000-0000-0000-0000-000000000003', name: '叁', english: 'Court 3', note: '叁号场地', noteEn: 'Court three', tone: 'fire' },
  { id: '10000000-0000-0000-0000-000000000004', name: '肆', english: 'Court 4', note: '肆号场地', noteEn: 'Court four', tone: 'mountain' },
  { id: '10000000-0000-0000-0000-000000000005', name: '伍', english: 'Court 5', note: '伍号场地', noteEn: 'Court five', tone: 'thunder' },
]

export const SLOTS = Array.from({ length: 14 }, (_, index) => `${String(index + 10).padStart(2, '0')}:00`)

let activeVenueTimezone = 'America/Toronto'

export const setVenueTimezone = (timezone) => {
  if (typeof timezone === 'string' && timezone.trim()) activeVenueTimezone = timezone.trim()
}

export const toDateKey = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const addDays = (date, amount) => {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + amount)
  return copy
}

export const slotDateTime = (dateKey, time) => `${dateKey}T${time}:00`

export const venueNow = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: activeVenueTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`
  const time = `${parts.hour}:${parts.minute}`
  return {
    dateKey,
    time,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dateTime: `${dateKey}T${time}:${parts.second}`,
  }
}

export const isPastSlot = (dateKey, time, date = new Date()) => slotDateTime(dateKey, time) <= venueNow(date).dateTime

export const addMinutes = (dateTime, minutes) => {
  const date = new Date(dateTime)
  date.setMinutes(date.getMinutes() + minutes)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

export const timeFromDateTime = (dateTime) => dateTime.slice(11, 16)

export const endTimeFromDateTime = (startAt, endAt) => (
  endAt.slice(0, 10) !== startAt.slice(0, 10) && endAt.slice(11, 16) === '00:00'
    ? '24:00'
    : endAt.slice(11, 16)
)

export const mondayOfWeek = (dateKey) => {
  const date = new Date(`${dateKey}T12:00:00`)
  const day = date.getDay() || 7
  return toDateKey(addDays(date, 1 - day))
}

export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart

export const formatMoney = (amount, locale = 'zh-CN', currency = 'CAD') => new Intl.NumberFormat(locale, {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(amount)

export const priceFor = (time, duration) => {
  const hour = Number(time.slice(0, 2))
  const hourly = hour >= 17 ? 36 : 28
  return Math.round(hourly * duration / 60)
}

export const slotsFromConfiguration = (configuration) => {
  const hours = configuration?.opening_hours
  if (!hours || hours.is_closed) return hours?.is_closed ? [] : SLOTS
  const first = hours.open_minute
  const last = hours.close_minute
  const step = Number(configuration?.settings?.slot_minutes || 30)
  const slots = []
  for (let minute = first; minute + step <= last; minute += step) {
    slots.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)
  }
  return slots.length ? slots : SLOTS
}

export const openingHoursForDate = (configuration, dateKey) => {
  if (!configuration) return { day_of_week: new Date(`${dateKey}T12:00:00`).getDay(), open_minute: 600, close_minute: 1440, is_closed: false }
  if (configuration.opening_hours && !Array.isArray(configuration.opening_hours)) return configuration.opening_hours
  const hours = configuration.hours || configuration.opening_hours || []
  const dayOfWeek = new Date(`${dateKey}T12:00:00`).getDay()
  return hours.find((item) => Number(item.day_of_week) === dayOfWeek)
    || { day_of_week: dayOfWeek, open_minute: 600, close_minute: 1440, is_closed: false }
}

export const bookingDurations = (configuration, manager = false) => {
  const settings = configuration?.settings || configuration || {}
  const maximum = Number(manager ? settings.manager_max_minutes : settings.customer_max_minutes) || (manager ? 240 : 120)
  const step = Number(settings.slot_minutes || 30)
  const minimum = Math.ceil(30 / step) * step
  const durations = []
  for (let minutes = minimum; minutes <= maximum; minutes += step) durations.push(minutes)
  return [...new Set(durations)].sort((left, right) => left - right)
}

export const priceFromConfiguration = (configuration, courtIds, time, duration) => {
  if (!configuration?.pricing_rules?.length) return priceFor(time, duration) * courtIds.length
  const startMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
  const step = configuration.settings?.slot_minutes || 30
  const tier = configuration.member?.tier || null
  const discount = Math.min(100, Math.max(0, Number(configuration.member?.discount_percent || 0)))
  const amount = courtIds.reduce((courtTotal, courtId) => {
    let courtAmount = 0
    for (let offset = 0; offset < duration; offset += step) {
      const minute = startMinute + offset
      const rule = configuration.pricing_rules
        .filter((item) => (!item.court_id || item.court_id === courtId)
          && (!item.member_tier || item.member_tier === tier)
          && minute >= item.start_minute && minute < item.end_minute)
        .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0)
          || Number(Boolean(right.court_id)) - Number(Boolean(left.court_id))
          || Number(Boolean(right.member_tier)) - Number(Boolean(left.member_tier)))[0]
      if (!rule) return courtTotal + priceFor(time, duration)
      courtAmount += Number(rule.hourly_rate) * Math.min(step, duration - offset) / 60
    }
    return courtTotal + courtAmount
  }, 0)
  return Math.round(amount * (1 - discount / 100) * 100) / 100
}

export const demoSchedule = (dateKey) => [
  { id: 'demo-1', booking_group_id: 'demo-1', court_id: COURTS[0].id, start_at: slotDateTime(dateKey, '10:00'), end_at: slotDateTime(dateKey, '12:00'), status: 'confirmed' },
  { id: 'demo-2', court_id: COURTS[1].id, start_at: slotDateTime(dateKey, '13:00'), end_at: slotDateTime(dateKey, '14:30'), status: 'confirmed' },
  { id: 'demo-3', court_id: COURTS[2].id, start_at: slotDateTime(dateKey, '18:00'), end_at: slotDateTime(dateKey, '20:00'), status: 'confirmed' },
  { id: 'demo-4', court_id: COURTS[3].id, start_at: slotDateTime(dateKey, '20:00'), end_at: slotDateTime(dateKey, '21:00'), status: 'held' },
]
