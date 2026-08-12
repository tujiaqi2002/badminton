import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, GripVertical, Trash2, X } from 'lucide-react'
import { addDays, COURTS, timeFromDateTime, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const HALF_HOURS = Array.from({ length: 30 }, (_, index) => {
  const minutes = 7 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

const timeFromMinutes = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

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

export default function AdminSchedule({ bookings, initialDate, busy, onCreate, onReschedule, onCancel, onDateChange }) {
  const { courtTitle, locale, t } = useI18n()
  const [dateKey, setDateKey] = useState(initialDate)
  const [draggedId, setDraggedId] = useState(null)
  const [dragPreview, setDragPreview] = useState(null)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [dragDay, setDragDay] = useState(null)
  const [pointerDrag, setPointerDrag] = useState(null)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [draft, setDraft] = useState(null)
  const pointerMoved = useRef(false)
  const pointerTarget = useRef(null)

  useEffect(() => setDateKey(initialDate), [initialDate])

  const dayBookings = useMemo(() => bookings.filter((booking) => (
    booking.start_at.startsWith(dateKey) && ['held', 'confirmed'].includes(booking.status)
  )), [bookings, dateKey])

  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`))
  const draggedBooking = bookings.find((booking) => booking.id === draggedId)
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

  const finishDrag = () => {
    setDraggedId(null)
    setDragPreview(null)
    setCancelArmed(false)
    setDragDay(null)
    setPointerDrag(null)
  }

  useEffect(() => {
    if (!pointerDrag) return undefined
    const move = (event) => {
      pointerMoved.current = true
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const pointInside = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return null
        const rect = node.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom ? node : null
      }
      const dayButton = element?.closest('[data-transfer-date]')
      if (dayButton) {
        pointerTarget.current = { type: 'day', date: dayButton.dataset.transferDate }
        setDragDay(dayButton.dataset.transferDate)
        setCancelArmed(false)
        setDragPreview(null)
        return
      }
      setDragDay(null)
      const cancelZone = element?.closest('.admin-schedule-cancel-drop') || pointInside('.admin-schedule-cancel-drop')
      if (cancelZone) {
        pointerTarget.current = { type: 'cancel' }
        setCancelArmed(true)
        setDragPreview(null)
        return
      }
      setCancelArmed(false)
      const lane = element?.closest('.admin-schedule-lane')
      if (!lane) return
      const court = COURTS.find((item) => item.id === lane.dataset.courtId)
      if (!court) return
      const rect = lane.getBoundingClientRect()
      const slotHeight = rect.height / HALF_HOURS.length
      const duration = durationMinutes(pointerDrag.booking)
      const maxIndex = Math.max(0, Math.floor((15 * 60 - duration) / 30))
      const index = Math.max(0, Math.min(maxIndex, Math.round((event.clientY - rect.top - pointerDrag.grabOffset) / slotHeight)))
      const startMinutes = 7 * 60 + index * 30
      const nextTarget = { court, index, time: timeFromMinutes(startMinutes), endTime: timeFromMinutes(startMinutes + duration), span: duration / 30 }
      pointerTarget.current = { type: 'lane', target: nextTarget }
      setDragPreview(nextTarget)
    }
    const up = async (event) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const cancelNode = document.querySelector('.admin-schedule-cancel-drop')
      const cancelRect = cancelNode?.getBoundingClientRect()
      const insideCancel = cancelRect && event.clientX >= cancelRect.left && event.clientX <= cancelRect.right && event.clientY >= cancelRect.top && event.clientY <= cancelRect.bottom
      const dayButton = element?.closest('[data-transfer-date]')
      if (dayButton || pointerTarget.current?.type === 'day') {
        const booking = pointerDrag.booking
        const nextDate = dayButton?.dataset.transferDate || pointerTarget.current.date
        pointerTarget.current = null
        finishDrag()
        setSelectedBooking(booking)
        setDateKey(nextDate)
        onDateChange(nextDate)
        return
      }
      if (element?.closest('.admin-schedule-cancel-drop') || insideCancel || pointerTarget.current?.type === 'cancel') {
        const booking = pointerDrag.booking
        pointerTarget.current = null
        finishDrag()
        onCancel(booking)
        return
      }
      const target = dragPreview || (pointerTarget.current?.type === 'lane' ? pointerTarget.current.target : null)
      const booking = pointerDrag.booking
      pointerTarget.current = null
      finishDrag()
      if (target) await onReschedule(booking, target.court, target.time, durationMinutes(booking), dateKey)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dateKey, dragPreview, onCancel, onDateChange, onReschedule, pointerDrag])

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
            className={`${index === 0 ? 'active' : ''} ${dragDay === day.key ? 'drop-target' : ''}`}
            data-transfer-date={day.key}
            key={day.key}
            onClick={() => chooseTransferDay(day.key, null)}
          >
            <small>{index === 0 ? t('admin.schedule.currentDay') : day.weekday}</small>
            <strong>{day.day}</strong>
          </button>
        ))}
      </div>
      <div
        className={`admin-schedule-cancel-drop ${draggedId ? 'active' : ''} ${cancelArmed ? 'armed' : ''}`}
        aria-label={t('admin.schedule.cancelDrop')}
      >
        <Trash2 size={17} />
        <div><strong>{cancelArmed ? t('admin.schedule.cancelRelease') : t('admin.schedule.cancelDrop')}</strong><span>{t('admin.schedule.cancelProtection')}</span></div>
      </div>
      {selectedBooking && (
        <div className="admin-schedule-transfer" role="status">
          <GripVertical size={14} />
          <strong>{selectedBooking.customer_name}</strong>
          <span>{t('admin.schedule.transferReady')}</span>
          <button onClick={() => setSelectedBooking(null)}>{t('admin.schedule.clearSelection')}</button>
        </div>
      )}
      {draggedBooking && dragPreview ? (
        <div className="admin-drag-readout" role="status" aria-live="polite">
          <span>{t('admin.schedule.preview')}</span>
          <strong>{draggedBooking.customer_name}</strong>
          <b>{dateKey.replaceAll('-', '.')} · {courtTitle(dragPreview.court)} · {dragPreview.time}–{dragPreview.endTime}</b>
          <small>{t('admin.schedule.releaseToMove')}</small>
        </div>
      ) : (
        <div className="admin-schedule-hint"><GripVertical size={14} /> {selectedBooking ? t('admin.schedule.pickDestination') : t('admin.schedule.hint')}<span><CalendarPlus size={14} /> {t('admin.schedule.addHint')}</span></div>
      )}
      <div className="admin-schedule-scroll">
        <div className="admin-schedule-grid">
          <div className="admin-schedule-corner"><Clock3 size={14} /></div>
          {COURTS.map((court) => <div className={`admin-schedule-court ${court.tone}`} key={court.id}><span>{court.name}</span><strong>{courtTitle(court)}</strong></div>)}
          <div className="admin-schedule-times">
            {HALF_HOURS.map((time, index) => <div className={index % 2 ? 'half' : ''} key={time}>{index % 2 === 0 ? time : ''}</div>)}
          </div>
          {COURTS.map((court) => (
            <div
              className={`admin-schedule-lane ${court.tone} ${dragPreview?.court.id === court.id ? 'previewing' : ''}`}
              data-court-id={court.id}
              key={court.id}
            >
              {HALF_HOURS.map((time) => (
                <button
                  className="admin-schedule-slot"
                  key={time}
                  onClick={() => chooseSlot(court, time)}
                  aria-label={t('admin.schedule.emptySlot', { court: courtTitle(court), time })}
                />
              ))}
              {draggedBooking && dragPreview?.court.id === court.id && (
                <div
                  className="admin-schedule-drop-preview"
                  style={{ '--start': dragPreview.index, '--span': dragPreview.span }}
                  aria-hidden="true"
                >
                  <strong>{dragPreview.time}–{dragPreview.endTime}</strong>
                  <span>{t('admin.schedule.dropHere')}</span>
                </div>
              )}
              {dayBookings.filter((booking) => booking.court_id === court.id).map((booking) => {
                const startMinutes = Number(timeFromDateTime(booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(booking.start_at).slice(3))
                const offset = startMinutes - 7 * 60
                const minutes = durationMinutes(booking)
                return (
                  <article
                    className={`admin-schedule-booking ${draggedId === booking.id ? 'dragging' : ''} ${selectedBooking?.id === booking.id ? 'selected' : ''}`}
                    draggable={false}
                    role="button"
                    tabIndex="0"
                    aria-pressed={selectedBooking?.id === booking.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (pointerMoved.current) { pointerMoved.current = false; return }
                      setSelectedBooking((current) => current?.id === booking.id ? null : booking)
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedBooking((current) => current?.id === booking.id ? null : booking) } }}
                    onPointerDown={(event) => {
                      if (busy) return
                      event.currentTarget.setPointerCapture?.(event.pointerId)
                      const grabOffset = event.clientY - event.currentTarget.getBoundingClientRect().top
                      pointerMoved.current = false
                      pointerTarget.current = null
                      setDraggedId(booking.id)
                      setSelectedBooking(null)
                      setPointerDrag({ booking, grabOffset })
                    }}
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
