import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Gauge, PhoneCall } from 'lucide-react'
import { addDays, addMinutes, COURTS, isPastSlot, mondayOfWeek, openingHoursForDate, overlaps, slotDateTime, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const CAPACITY_SLOT_MINUTES = 60

export default function WeeklyCapacityMonitor({ bookings, events = [], weekDate, onWeekChange, onInspect, configuration }) {
  const { locale, t } = useI18n()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const monday = mondayOfWeek(weekDate)
  const slotMinutes = CAPACITY_SLOT_MINUTES
  const openDays = (configuration?.hours || []).filter((item) => !item.is_closed)
  const firstMinute = openDays.length ? Math.min(...openDays.map((item) => Number(item.open_minute))) : 600
  const lastMinute = openDays.length ? Math.max(...openDays.map((item) => Number(item.close_minute))) : 1440
  const hours = Array.from({ length: Math.max(0, Math.floor((lastMinute - firstMinute) / slotMinutes)) }, (_, index) => {
    const minute = firstMinute + index * slotMinutes
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  })
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(new Date(`${monday}T12:00:00`), index)
    return {
      key: toDateKey(date),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date),
    }
  })

  const availability = (date, time) => {
    const start = slotDateTime(date, time)
    const end = addMinutes(start, slotMinutes)
    const blockedCourtIds = new Set(events.filter((event) => (
      event.status === 'scheduled' && event.blocks_booking
      && overlaps(start, end, event.starts_at, event.ends_at)
    )).flatMap((event) => event.court_ids?.length ? event.court_ids : COURTS.map((court) => court.id)))
    const unavailable = new Set([
      ...bookings.filter((booking) => ['held', 'confirmed'].includes(booking.status) && overlaps(start, end, booking.start_at, booking.end_at)).map((booking) => booking.court_id),
      ...blockedCourtIds,
    ]).size
    return COURTS.length - unavailable
  }

  return (
    <section className="capacity-monitor" aria-label={t('admin.capacity.aria')}>
      <header>
        <div><span className="eyebrow"><Gauge size={13} /> {t('admin.capacity.eyebrow')}</span><p><PhoneCall size={14} /> {t('admin.capacity.description')}</p></div>
        <div className="capacity-legend"><span><i className="open" />{t('admin.capacity.open')}</span><span><i className="tight" />{t('admin.capacity.tight')}</span><span><i className="full" />{t('admin.capacity.full')}</span></div>
      </header>
      <div className="capacity-grid-wrap">
        <div className="capacity-grid" style={{ '--capacity-days': days.length }}>
          <button className="capacity-week-nav" onClick={() => onWeekChange(toDateKey(addDays(new Date(`${monday}T12:00:00`), -7)))} aria-label={t('admin.schedule.previousWeek')}><ChevronLeft size={17} /></button>
          {days.map((day) => <div className="capacity-day" key={day.key}><small>{day.weekday}</small><strong>{day.day}</strong></div>)}
          <button className="capacity-week-nav" onClick={() => onWeekChange(toDateKey(addDays(new Date(`${monday}T12:00:00`), 7)))} aria-label={t('admin.schedule.nextWeek')}><ChevronRight size={17} /></button>
          {hours.map((time) => (
            <div className="capacity-row" key={time}>
              <strong>{time}</strong>
              {days.map((day) => {
                const past = isPastSlot(day.key, time, now)
                const opening = openingHoursForDate(configuration, day.key)
                const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
                const closed = opening.is_closed || minute < opening.open_minute || minute + slotMinutes > opening.close_minute
                const free = availability(day.key, time)
                const tone = free === 0 ? 'full' : free <= 2 ? 'tight' : 'open'
                return <button className={closed ? 'closed' : past ? 'past' : tone} disabled={closed || past} key={day.key} onClick={() => onInspect(day.key, time)} aria-label={closed ? t('board.closed') : past ? t('admin.capacity.pastCell', { date: day.day, time }) : t('admin.capacity.cell', { date: day.day, time, count: free })}>{closed || past ? <><b>—</b><span>{t(closed ? 'board.closed' : 'admin.capacity.past')}</span></> : <><b>{free}</b><span>{t('admin.capacity.courtsFree')}</span></>}</button>
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
