import { ArrowRight, CalendarClock, Clock3, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { COURTS, timeFromDateTime, venueNow } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

export default function AdminRescheduleModal({ booking, busy, onClose, onSubmit, onMoved }) {
  const { courtTitle, t } = useI18n()
  const currentDuration = durationMinutes(booking)
  const [form, setForm] = useState({
    date: booking.start_at.slice(0, 10),
    courtId: booking.court_id,
    time: timeFromDateTime(booking.start_at),
    duration: currentDuration,
  })
  const durations = useMemo(() => [...new Set([...Array.from({ length: 8 }, (_, index) => 30 + index * 30), currentDuration])].sort((a, b) => a - b), [currentDuration])
  const targetCourt = COURTS.find((court) => court.id === form.courtId) || COURTS[0]
  const today = venueNow().dateKey

  const submit = async (event) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const date = String(values.get('date'))
    const time = String(values.get('time'))
    const duration = Number(values.get('duration'))
    const court = COURTS.find((item) => item.id === values.get('courtId')) || targetCourt
    const result = await onSubmit(booking, court, time, duration, date)
    if (result?.saved) {
      onMoved(date, booking.id)
      onClose()
    } else if (result?.unchanged) {
      onClose()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="admin-reschedule-modal" onSubmit={submit}>
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label={t('auth.close')}><X size={19} /></button>
        <span className="eyebrow"><CalendarClock size={13} /> {t('admin.reschedule.eyebrow')}</span>
        <h2>{t('admin.reschedule.title')}</h2>
        <p>{t('admin.reschedule.description', { name: booking.customer_name })}</p>

        <div className="admin-reschedule-current">
          <Clock3 size={16} />
          <span>{booking.start_at.slice(0, 10).replaceAll('-', '.')}</span>
          <strong>{timeFromDateTime(booking.start_at)}–{timeFromDateTime(booking.end_at)}</strong>
          <span>{courtTitle(COURTS.find((court) => court.id === booking.court_id) || COURTS[0])}</span>
          <ArrowRight size={15} />
        </div>

        <div className="admin-reschedule-fields">
          <label><span>{t('admin.reschedule.date')}</span><input required name="date" type="date" min={today} value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label>
          <label><span>{t('admin.reschedule.court')}</span><select name="courtId" value={form.courtId} onChange={(event) => setForm((current) => ({ ...current, courtId: event.target.value }))}>{COURTS.map((court) => <option value={court.id} key={court.id}>{courtTitle(court)}</option>)}</select></label>
          <label><span>{t('admin.reschedule.time')}</span><input required name="time" type="time" min="10:00" max="23:00" step="1800" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} /></label>
          <label><span>{t('admin.schedule.duration')}</span><select name="duration" value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}>{durations.map((minutes) => <option value={minutes} key={minutes}>{minutes} min</option>)}</select></label>
        </div>
        <button className="primary-button" disabled={busy}>{busy ? t('admin.schedule.saving') : t('admin.reschedule.confirm')}</button>
      </form>
    </div>
  )
}
