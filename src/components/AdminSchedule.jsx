import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, GripVertical, X } from 'lucide-react'
import { addDays, COURTS, timeFromDateTime, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const HALF_HOURS = Array.from({ length: 30 }, (_, index) => {
  const minutes = 7 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

function NewBookingModal({ draft, busy, onClose, onSubmit }) {
  const { courtTitle, t } = useI18n()
  const [form, setForm] = useState({ name: '', email: '', duration: 60, partySize: 2 })

  const submit = (event) => {
    event.preventDefault()
    onSubmit({ ...draft, ...form })
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="admin-create-modal" onSubmit={submit}>
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label={t('auth.close')}><X size={19} /></button>
        <span className="eyebrow"><CalendarPlus size={13} /> {t('admin.schedule.addEyebrow')}</span>
        <h2>{t('admin.schedule.addTitle')}</h2>
        <p>{draft.dateKey.replaceAll('-', '.')} · {courtTitle(draft.court)} · {draft.time}</p>
        <div className="admin-create-fields">
          <label><span>{t('admin.schedule.customerName')}</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>{t('admin.schedule.customerEmail')}</span><input required type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
          <label><span>{t('admin.schedule.duration')}</span><select value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}><option value="60">60 min</option><option value="90">90 min</option><option value="120">120 min</option></select></label>
          <label><span>{t('admin.schedule.partySize')}</span><input type="number" min="1" max="8" value={form.partySize} onChange={(event) => setForm((current) => ({ ...current, partySize: Number(event.target.value) }))} /></label>
        </div>
        <button className="primary-button" disabled={busy}>{busy ? t('admin.schedule.saving') : t('admin.schedule.create')}</button>
      </form>
    </div>
  )
}

export default function AdminSchedule({ bookings, initialDate, busy, onCreate, onReschedule, onDateChange }) {
  const { courtTitle, locale, t } = useI18n()
  const [dateKey, setDateKey] = useState(initialDate)
  const [draggedId, setDraggedId] = useState(null)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [draft, setDraft] = useState(null)

  useEffect(() => setDateKey(initialDate), [initialDate])

  const dayBookings = useMemo(() => bookings.filter((booking) => (
    booking.start_at.startsWith(dateKey) && ['held', 'confirmed'].includes(booking.status)
  )), [bookings, dateKey])

  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`))
  const quickDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(new Date(`${dateKey}T12:00:00`), index)
    return {
      key: toDateKey(date),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date),
    }
  }), [dateKey, locale])

  const selectDate = (next) => {
    setDateKey(next)
    onDateChange(next)
  }
  const moveDay = (amount) => selectDate(toDateKey(addDays(new Date(`${dateKey}T12:00:00`), amount)))

  const dropBooking = async (court, time, bookingId) => {
    const booking = bookings.find((item) => item.id === bookingId) || selectedBooking
    setDraggedId(null)
    if (!booking) return
    const saved = await onReschedule(booking, court, time, durationMinutes(booking), dateKey)
    if (saved) setSelectedBooking(null)
  }

  const chooseSlot = async (court, time) => {
    if (selectedBooking) {
      const saved = await onReschedule(selectedBooking, court, time, durationMinutes(selectedBooking), dateKey)
      if (saved) setSelectedBooking(null)
      return
    }
    setDraft({ court, dateKey, time })
  }

  const chooseTransferDay = (next, bookingId = draggedId) => {
    const booking = bookings.find((item) => item.id === bookingId) || selectedBooking
    if (booking) setSelectedBooking(booking)
    setDraggedId(null)
    selectDate(next)
  }

  return (
    <section className="admin-schedule-editor" aria-label={t('admin.schedule.aria')}>
      <header>
        <div>
          <span className="eyebrow"><GripVertical size={13} /> {t('admin.schedule.eyebrow')}</span>
          <h2>{t('admin.schedule.title')}</h2>
          <p>{t('admin.schedule.description')}</p>
        </div>
        <div className="admin-schedule-date">
          <button onClick={() => moveDay(-1)} aria-label={t('admin.schedule.previous')}><ChevronLeft size={18} /></button>
          <label><strong>{dayLabel}</strong><input type="date" value={dateKey} onChange={(event) => selectDate(event.target.value)} /></label>
          <button onClick={() => moveDay(1)} aria-label={t('admin.schedule.next')}><ChevronRight size={18} /></button>
        </div>
      </header>

      <div className="admin-schedule-day-strip" aria-label={t('admin.schedule.quickDays')}>
        {quickDays.map((day, index) => (
          <button
            className={index === 0 ? 'active' : ''}
            key={day.key}
            onClick={() => chooseTransferDay(day.key, null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => chooseTransferDay(day.key, event.dataTransfer.getData('text/plain') || draggedId)}
          >
            <small>{index === 0 ? t('admin.schedule.currentDay') : day.weekday}</small>
            <strong>{day.day}</strong>
          </button>
        ))}
      </div>
      {selectedBooking && (
        <div className="admin-schedule-transfer" role="status">
          <GripVertical size={14} />
          <strong>{selectedBooking.customer_name}</strong>
          <span>{t('admin.schedule.transferReady')}</span>
          <button onClick={() => setSelectedBooking(null)}>{t('admin.schedule.clearSelection')}</button>
        </div>
      )}
      <div className="admin-schedule-hint"><GripVertical size={14} /> {selectedBooking ? t('admin.schedule.pickDestination') : t('admin.schedule.hint')}<span><CalendarPlus size={14} /> {t('admin.schedule.addHint')}</span></div>
      <div className="admin-schedule-scroll">
        <div className="admin-schedule-grid">
          <div className="admin-schedule-corner"><Clock3 size={14} /></div>
          {COURTS.map((court) => <div className={`admin-schedule-court ${court.tone}`} key={court.id}><span>{court.name}</span><strong>{courtTitle(court)}</strong></div>)}
          <div className="admin-schedule-times">
            {HALF_HOURS.map((time, index) => <div className={index % 2 ? 'half' : ''} key={time}>{index % 2 === 0 ? time : ''}</div>)}
          </div>
          {COURTS.map((court) => (
            <div className={`admin-schedule-lane ${court.tone}`} key={court.id}>
              {HALF_HOURS.map((time) => (
                <button
                  className="admin-schedule-slot"
                  key={time}
                  onClick={() => chooseSlot(court, time)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropBooking(court, time, event.dataTransfer.getData('text/plain') || draggedId)}
                  aria-label={t('admin.schedule.emptySlot', { court: courtTitle(court), time })}
                />
              ))}
              {dayBookings.filter((booking) => booking.court_id === court.id).map((booking) => {
                const startMinutes = Number(timeFromDateTime(booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(booking.start_at).slice(3))
                const offset = startMinutes - 7 * 60
                const minutes = durationMinutes(booking)
                return (
                  <article
                    className={`admin-schedule-booking ${draggedId === booking.id ? 'dragging' : ''} ${selectedBooking?.id === booking.id ? 'selected' : ''}`}
                    draggable={!busy}
                    role="button"
                    tabIndex="0"
                    aria-pressed={selectedBooking?.id === booking.id}
                    onClick={(event) => { event.stopPropagation(); setSelectedBooking((current) => current?.id === booking.id ? null : booking) }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedBooking((current) => current?.id === booking.id ? null : booking) } }}
                    onDragStart={(event) => { event.dataTransfer.setData('text/plain', booking.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(booking.id) }}
                    onDragEnd={() => setDraggedId(null)}
                    style={{ '--start': offset / 30, '--span': minutes / 30 }}
                    key={booking.id}
                    title={t('admin.schedule.dragTitle', { name: booking.customer_name })}
                  >
                    <GripVertical size={14} />
                    <div><strong>{booking.customer_name}</strong><span>{timeFromDateTime(booking.start_at)}–{timeFromDateTime(booking.end_at)}</span></div>
                  </article>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {draft && <NewBookingModal draft={draft} busy={busy} onClose={() => setDraft(null)} onSubmit={async (details) => { const saved = await onCreate(details); if (saved) setDraft(null) }} />}
    </section>
  )
}
