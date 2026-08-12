export const COURTS = [
  { id: '10000000-0000-0000-0000-000000000001', name: '风', english: 'Wind', note: '轻盈迅捷', tone: 'wind' },
  { id: '10000000-0000-0000-0000-000000000002', name: '林', english: 'Forest', note: '沉静专注', tone: 'forest' },
  { id: '10000000-0000-0000-0000-000000000003', name: '火', english: 'Fire', note: '热烈竞技', tone: 'fire' },
  { id: '10000000-0000-0000-0000-000000000004', name: '山', english: 'Mountain', note: '稳定从容', tone: 'mountain' },
  { id: '10000000-0000-0000-0000-000000000005', name: '雷', english: 'Thunder', note: '果决凌厉', tone: 'thunder' },
]

export const SLOTS = Array.from({ length: 15 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`)

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

export const addMinutes = (dateTime, minutes) => {
  const date = new Date(dateTime)
  date.setMinutes(date.getMinutes() + minutes)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

export const timeFromDateTime = (dateTime) => dateTime.slice(11, 16)

export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart

export const formatMoney = (amount) => new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
}).format(amount)

export const priceFor = (time, duration) => {
  const hour = Number(time.slice(0, 2))
  const hourly = hour >= 17 ? 36 : 28
  return Math.round(hourly * duration / 60)
}

export const demoSchedule = (dateKey) => [
  { id: 'demo-1', court_id: COURTS[0].id, start_at: slotDateTime(dateKey, '09:00'), end_at: slotDateTime(dateKey, '11:00'), status: 'confirmed' },
  { id: 'demo-2', court_id: COURTS[1].id, start_at: slotDateTime(dateKey, '13:00'), end_at: slotDateTime(dateKey, '14:30'), status: 'confirmed' },
  { id: 'demo-3', court_id: COURTS[2].id, start_at: slotDateTime(dateKey, '18:00'), end_at: slotDateTime(dateKey, '20:00'), status: 'confirmed' },
  { id: 'demo-4', court_id: COURTS[3].id, start_at: slotDateTime(dateKey, '20:00'), end_at: slotDateTime(dateKey, '21:00'), status: 'held' },
]
