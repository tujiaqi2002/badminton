import { ChevronLeft, ChevronRight, Gauge, PhoneCall } from 'lucide-react'
import { addDays, addMinutes, COURTS, mondayOfWeek, overlaps, slotDateTime, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const HOURS = Array.from({ length: 14 }, (_, index) => `${String(index + 10).padStart(2, '0')}:00`)

export default function WeeklyCapacityMonitor({ bookings, weekDate, onWeekChange, onInspect }) {
  const { locale, t } = useI18n()
  const monday = mondayOfWeek(weekDate)
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
    const end = addMinutes(start, 60)
    const booked = new Set(bookings.filter((booking) => (
      ['held', 'confirmed'].includes(booking.status)
      && overlaps(start, end, booking.start_at, booking.end_at)
    )).map((booking) => booking.court_id)).size
    return COURTS.length - booked
  }

  return (
    <section className="capacity-monitor" aria-label={t('admin.capacity.aria')}>
      <header>
        <div><span className="eyebrow"><Gauge size={13} /> {t('admin.capacity.eyebrow')}</span><h2>{t('admin.capacity.title')}</h2><p><PhoneCall size={14} /> {t('admin.capacity.description')}</p></div>
        <div className="capacity-legend"><span><i className="open" />{t('admin.capacity.open')}</span><span><i className="tight" />{t('admin.capacity.tight')}</span><span><i className="full" />{t('admin.capacity.full')}</span></div>
      </header>
      <div className="capacity-grid-wrap">
        <div className="capacity-grid" style={{ '--capacity-days': days.length }}>
          <button className="capacity-week-nav" onClick={() => onWeekChange(toDateKey(addDays(new Date(`${monday}T12:00:00`), -7)))} aria-label={t('admin.schedule.previousWeek')}><ChevronLeft size={17} /></button>
          {days.map((day) => <div className="capacity-day" key={day.key}><small>{day.weekday}</small><strong>{day.day}</strong></div>)}
          <button className="capacity-week-nav" onClick={() => onWeekChange(toDateKey(addDays(new Date(`${monday}T12:00:00`), 7)))} aria-label={t('admin.schedule.nextWeek')}><ChevronRight size={17} /></button>
          {HOURS.map((time) => (
            <div className="capacity-row" key={time}>
              <strong>{time}</strong>
              {days.map((day) => {
                const free = availability(day.key, time)
                const tone = free === 0 ? 'full' : free <= 2 ? 'tight' : 'open'
                return <button className={tone} key={day.key} onClick={() => onInspect(day.key, time)} aria-label={t('admin.capacity.cell', { date: day.day, time, count: free })}><b>{free}</b><span>{t('admin.capacity.courtsFree')}</span></button>
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
