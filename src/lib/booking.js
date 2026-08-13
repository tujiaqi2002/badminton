export const COURTS = [
  { id: '10000000-0000-0000-0000-000000000001', name: '壹', english: 'Court 1', note: '壹号场地', noteEn: 'Court one', tone: 'wind' },
  { id: '10000000-0000-0000-0000-000000000002', name: '贰', english: 'Court 2', note: '贰号场地', noteEn: 'Court two', tone: 'forest' },
  { id: '10000000-0000-0000-0000-000000000003', name: '叁', english: 'Court 3', note: '叁号场地', noteEn: 'Court three', tone: 'fire' },
  { id: '10000000-0000-0000-0000-000000000004', name: '肆', english: 'Court 4', note: '肆号场地', noteEn: 'Court four', tone: 'mountain' },
  { id: '10000000-0000-0000-0000-000000000005', name: '伍', english: 'Court 5', note: '伍号场地', noteEn: 'Court five', tone: 'thunder' },
]

export const SLOTS = Array.from({ length: 14 }, (_, index) => `${String(index + 10).padStart(2, '0')}:00`)

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
    timeZone: 'America/Toronto',
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

export const formatMoney = (amount, locale = 'zh-CN') => new Intl.NumberFormat(locale, {
  style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
}).format(amount)

export const priceFor = (time, duration) => {
  const hour = Number(time.slice(0, 2))
  const hourly = hour >= 17 ? 36 : 28
  return Math.round(hourly * duration / 60)
}

export const demoSchedule = (dateKey) => [
  { id: 'demo-1', booking_group_id: 'demo-1', court_id: COURTS[0].id, start_at: slotDateTime(dateKey, '10:00'), end_at: slotDateTime(dateKey, '12:00'), status: 'confirmed' },
  { id: 'demo-2', court_id: COURTS[1].id, start_at: slotDateTime(dateKey, '13:00'), end_at: slotDateTime(dateKey, '14:30'), status: 'confirmed' },
  { id: 'demo-3', court_id: COURTS[2].id, start_at: slotDateTime(dateKey, '18:00'), end_at: slotDateTime(dateKey, '20:00'), status: 'confirmed' },
  { id: 'demo-4', court_id: COURTS[3].id, start_at: slotDateTime(dateKey, '20:00'), end_at: slotDateTime(dateKey, '21:00'), status: 'held' },
]
