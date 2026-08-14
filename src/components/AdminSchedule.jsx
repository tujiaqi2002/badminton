import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Clock3, GripVertical, Pencil, PhoneCall, Repeat2, Save, Trash2, X } from 'lucide-react'
import { addDays, COURTS, endTimeFromDateTime, formatMoney, isPastSlot, mondayOfWeek, timeFromDateTime, toDateKey, venueNow } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const OPEN_MINUTES = 10 * 60
const HALF_HOURS = Array.from({ length: 28 }, (_, index) => {
  const minutes = OPEN_MINUTES + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

const timeFromMinutes = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const ADMIN_DURATIONS = Array.from({ length: 7 }, (_, index) => 60 + index * 30)

const bookingPhaseAtVenue = (booking, nowAtVenue) => {
  if (booking.end_at <= nowAtVenue.dateTime) return 'ended'
  if (booking.start_at <= nowAtVenue.dateTime) return 'in-progress'
  return 'future'
}

function NewBookingModal({ draft, busy, onClose, onSubmit }) {
  const { courtTitle, t } = useI18n()
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', duration: draft.duration || 60, partySize: 2, courts: draft.courts || [draft.court], recurring: false, weekCount: 4 })
  const [conflicts, setConflicts] = useState([])

  const submit = async (event) => {
    event.preventDefault()
    setConflicts([])
    const result = await onSubmit({ ...draft, ...form })
    if (result?.conflicts) setConflicts(result.conflicts)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="admin-create-modal" onSubmit={submit}>
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label={t('auth.close')}><X size={19} /></button>
        <span className="eyebrow"><CalendarPlus size={13} /> {t('admin.schedule.addEyebrow')}</span>
        <h2>{t('admin.schedule.addTitle')}</h2>
        <p>{draft.dateKey.replaceAll('-', '.')} · {draft.time} · {t('admin.schedule.selectedCourts', { count: form.courts.length })}</p>
        <div className="admin-create-fields">
          <label className="wide"><span>{t('admin.schedule.customerName')}</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>{t('admin.schedule.customerEmailOptional')}</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
          <label><span>{t('admin.schedule.customerPhoneOptional')}</span><input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label><span>{t('admin.schedule.duration')}</span><select value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}>{ADMIN_DURATIONS.map((minutes) => <option value={minutes} key={minutes} disabled={Number(draft.time.slice(0, 2)) * 60 + Number(draft.time.slice(3)) + minutes > 24 * 60}>{minutes / 60} h</option>)}</select></label>
          <label><span>{t('admin.schedule.partySize')}</span><input type="number" min="1" max="8" value={form.partySize} onChange={(event) => setForm((current) => ({ ...current, partySize: Number(event.target.value) }))} /></label>
          <label className="wide admin-recurring-toggle"><input type="checkbox" checked={form.recurring} onChange={(event) => { setConflicts([]); setForm((current) => ({ ...current, recurring: event.target.checked })) }} /><span><Repeat2 size={15} /> {t('admin.schedule.weeklyRecurring')}</span></label>
          {form.recurring && <label className="wide admin-week-count"><span>{t('admin.schedule.repeatFor')}</span><select value={form.weekCount} onChange={(event) => { setConflicts([]); setForm((current) => ({ ...current, weekCount: Number(event.target.value) })) }}>{Array.from({ length: 11 }, (_, index) => index + 2).map((weeks) => <option value={weeks} key={weeks}>{t('admin.schedule.weekCount', { count: weeks })}</option>)}</select></label>}
          <label className="wide"><span>{t('admin.schedule.customerNotesOptional')}</span><textarea maxLength="2000" rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          <div className="wide admin-court-picker"><span>{t('drawer.courts')}</span><div className="court-multi-picker">{COURTS.map((court) => { const selected = form.courts.some((item) => item.id === court.id); return <button type="button" className={selected ? 'selected' : ''} key={court.id} onClick={() => setForm((current) => { const courts = selected ? current.courts.filter((item) => item.id !== court.id) : [...current.courts, court]; return courts.length ? { ...current, courts } : current })}><strong>{court.name}</strong><small>{court.english}</small></button> })}</div></div>
        </div>
        {conflicts.length > 0 && <div className="admin-recurring-conflicts" role="alert"><AlertTriangle size={17} /><div><strong>{t('admin.schedule.recurringUnavailable')}</strong><span>{t('admin.schedule.recurringUnavailableHelp')}</span><ul>{conflicts.map((conflict) => <li key={`${conflict.startAt}-${conflict.courtIds.join('-')}`}>{conflict.startAt.slice(0, 10).replaceAll('-', '.')} · {conflict.startAt.slice(11, 16)} · {conflict.courtIds.map((id) => courtTitle(COURTS.find((court) => court.id === id) || COURTS[0])).join(' + ')}</li>)}</ul></div></div>}
        <button className="primary-button" disabled={busy || !form.courts.length}>{busy ? t('admin.schedule.saving') : t('admin.schedule.create')}</button>
      </form>
    </div>
  )
}

export default function AdminSchedule({ bookings, initialDate, busy, onCreate, onReschedule, onRescheduleGroup, onCancel, onUpdateDetails, onDateChange, focusTime, onClearFocus }) {
  const { courtTitle, locale, t } = useI18n()
  const [dateKey, setDateKey] = useState(initialDate)
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(initialDate))
  const [draggedId, setDraggedId] = useState(null)
  const [dragPreview, setDragPreview] = useState(null)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [dragDay, setDragDay] = useState(null)
  const [pointerDrag, setPointerDrag] = useState(null)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({ name: '', email: '', phone: '', notes: '', paymentStatus: 'pay_at_venue' })
  const [rangeDraft, setRangeDraft] = useState(null)
  const [resizeDrag, setResizeDrag] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const pointerMoved = useRef(false)
  const pointerTarget = useRef(null)
  const editorRef = useRef(null)

  useEffect(() => {
    setDateKey(initialDate)
    setWeekStart((current) => {
      const monday = mondayOfWeek(initialDate)
      return initialDate < current || initialDate > toDateKey(addDays(new Date(`${current}T12:00:00`), 6)) ? monday : current
    })
  }, [initialDate])

  useEffect(() => {
    if (!focusTime) return
    window.setTimeout(() => document.querySelector(`[data-schedule-time="${focusTime}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
  }, [dateKey, focusTime])

  const dayBookings = useMemo(() => bookings.filter((booking) => (
    booking.start_at.startsWith(dateKey) && ['held', 'confirmed'].includes(booking.status)
  )), [bookings, dateKey])

  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`))
  const draggedBooking = bookings.find((booking) => booking.id === draggedId)
  const activeSelection = selectedBooking && (bookings.find((booking) => booking.id === selectedBooking.id) || selectedBooking)
  const activeGroup = activeSelection ? bookings.filter((booking) => (booking.booking_group_id || booking.id) === (activeSelection.booking_group_id || activeSelection.id) && ['held', 'confirmed'].includes(booking.status)) : []
  const groupPrice = activeGroup.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0)
  const nowAtVenue = venueNow(now)
  const currentLineOffset = dateKey === nowAtVenue.dateKey && nowAtVenue.minutes >= OPEN_MINUTES && nowAtVenue.minutes <= 24 * 60
    ? (nowAtVenue.minutes - OPEN_MINUTES) / 30
    : null
  const multiCourtGroups = useMemo(() => {
    const groups = new Map()
    dayBookings.forEach((booking) => {
      if (!booking.booking_group_id) return
      const rows = groups.get(booking.booking_group_id) || []
      rows.push(booking)
      groups.set(booking.booking_group_id, rows)
    })
    return [...groups.entries()].flatMap(([id, rows]) => {
      if (rows.length < 2) return []
      const courtIndexes = rows.map((booking) => COURTS.findIndex((court) => court.id === booking.court_id)).filter((index) => index >= 0)
      if (courtIndexes.length < 2) return []
      const anchor = rows[0]
      const startMinutes = Number(timeFromDateTime(anchor.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(anchor.start_at).slice(3))
      const resizingThisGroup = resizeDrag && (resizeDrag.booking.booking_group_id || resizeDrag.booking.id) === id
      return [{
        id,
        count: rows.length,
        firstCourt: Math.min(...courtIndexes),
        lastCourt: Math.max(...courtIndexes),
        start: (startMinutes - OPEN_MINUTES) / 30,
        span: (resizingThisGroup ? resizeDrag.duration : durationMinutes(anchor)) / 30,
      }]
    })
  }, [dayBookings, resizeDrag])
  const quickDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(new Date(`${weekStart}T12:00:00`), index)
    return {
      key: toDateKey(date),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date),
    }
  }), [weekStart, locale])

  useEffect(() => {
    if (!activeSelection) {
      setEditingDetails(false)
      return
    }
    setDetailsForm({
      name: activeSelection.customer_name || '',
      email: activeSelection.customer_email || '',
      phone: activeSelection.customer_phone || '',
      notes: activeSelection.customer_notes || '',
      paymentStatus: activeSelection.payment_status || 'pay_at_venue',
    })
    setEditingDetails(false)
  }, [activeSelection])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!activeSelection) return undefined
    const clearSelectionOutside = (event) => {
      if (!editorRef.current?.contains(event.target)) setSelectedBooking(null)
    }
    document.addEventListener('pointerdown', clearSelectionOutside)
    return () => document.removeEventListener('pointerdown', clearSelectionOutside)
  }, [activeSelection])

  const selectDate = (next) => {
    setDateKey(next)
    onDateChange(next)
  }
  const moveWeek = (amount) => {
    const next = toDateKey(addDays(new Date(`${weekStart}T12:00:00`), amount * 7))
    setWeekStart(next)
    const selectedOffset = Math.max(0, Math.min(6, Math.round((new Date(`${dateKey}T12:00:00`) - new Date(`${weekStart}T12:00:00`)) / 86400000)))
    selectDate(toDateKey(addDays(new Date(`${next}T12:00:00`), selectedOffset)))
  }

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
      if (!pointerMoved.current && Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 5) return
      pointerMoved.current = true
      setDraggedId(pointerDrag.booking.id)
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const pointInside = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return null
        const rect = node.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom ? node : null
      }
      const dayButton = element?.closest('[data-transfer-date]')
      if (dayButton && !dayButton.disabled) {
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
      if (!lane) {
        pointerTarget.current = null
        setDragPreview(null)
        return
      }
      const court = COURTS.find((item) => item.id === lane.dataset.courtId)
      if (!court) return
      const rect = lane.getBoundingClientRect()
      const slotHeight = rect.height / HALF_HOURS.length
      const duration = durationMinutes(pointerDrag.booking)
      const maxIndex = Math.max(0, Math.floor((14 * 60 - duration) / 30))
      const index = Math.max(0, Math.min(maxIndex, Math.round((event.clientY - rect.top - pointerDrag.grabOffset) / slotHeight)))
      const startMinutes = OPEN_MINUTES + index * 30
      const nextTarget = { court, index, time: timeFromMinutes(startMinutes), endTime: timeFromMinutes(startMinutes + duration), span: duration / 30 }
      if (isPastSlot(dateKey, nextTarget.time, now)) {
        pointerTarget.current = { type: 'invalid' }
        setDragPreview({ ...nextTarget, invalid: true })
        return
      }
      pointerTarget.current = { type: 'lane', target: nextTarget }
      setDragPreview(nextTarget)
    }
    const up = async (event) => {
      if (!pointerMoved.current) {
        pointerTarget.current = null
        finishDrag()
        return
      }
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const cancelNode = document.querySelector('.admin-schedule-cancel-drop')
      const cancelRect = cancelNode?.getBoundingClientRect()
      const insideCancel = cancelRect && event.clientX >= cancelRect.left && event.clientX <= cancelRect.right && event.clientY >= cancelRect.top && event.clientY <= cancelRect.bottom
      const dayButton = element?.closest('[data-transfer-date]')
      if ((dayButton && !dayButton.disabled) || pointerTarget.current?.type === 'day') {
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
      const target = pointerTarget.current?.type === 'lane' ? pointerTarget.current.target : null
      const booking = pointerDrag.booking
      pointerTarget.current = null
      finishDrag()
      if (target) {
        const pointerGroupSize = bookings.filter((item) => (
          (item.booking_group_id || item.id) === (booking.booking_group_id || booking.id)
          && ['held', 'confirmed'].includes(item.status)
        )).length
        const result = pointerGroupSize > 1
          ? await onRescheduleGroup(booking, target.time, durationMinutes(booking), dateKey, target.court)
          : await onReschedule(booking, target.court, target.time, durationMinutes(booking), dateKey)
        if (result?.unchanged) setSelectedBooking(booking)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [bookings, dateKey, now, onCancel, onDateChange, onReschedule, onRescheduleGroup, pointerDrag])

  const chooseSlot = (court, time) => {
    const startMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    if (startMinutes + 60 > 24 * 60 || isPastSlot(dateKey, time, now)) return
    if (activeSelection) {
      setSelectedBooking(null)
      return
    }
    onClearFocus?.()
    setDraft({ court, courts: [court], dateKey, time })
  }

  const chooseTransferDay = (next, bookingId = draggedId) => {
    const booking = bookings.find((item) => item.id === bookingId) || activeSelection
    if (booking) setSelectedBooking(booking)
    setDraggedId(null)
    selectDate(next)
  }

  useEffect(() => {
    if (!rangeDraft?.dragging) return undefined
    const move = (event) => {
      const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest('.admin-schedule-slot')
      if (!slot || slot.disabled || slot.dataset.courtId !== rangeDraft.court.id) return
      const currentIndex = Number(slot.dataset.index)
      setRangeDraft((current) => ({ ...current, currentIndex }))
    }
    const up = (event) => {
      if (event.pointerId !== rangeDraft.pointerId) return
      const startIndex = Math.min(rangeDraft.startIndex, rangeDraft.currentIndex)
      const endIndex = Math.max(rangeDraft.startIndex, rangeDraft.currentIndex) + 1
      const span = endIndex - startIndex
      const duration = Math.max(60, Math.min(240, span * 30))
      const startMinutes = OPEN_MINUTES + startIndex * 30
      const startTime = timeFromMinutes(startMinutes)
      if (startMinutes + duration <= 24 * 60 && !isPastSlot(dateKey, startTime, now)) setDraft({ court: rangeDraft.court, courts: [rangeDraft.court], dateKey, time: startTime, duration })
      setRangeDraft(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [dateKey, now, rangeDraft])

  useEffect(() => {
    if (!resizeDrag) return undefined
    const move = (event) => {
      const deltaSlots = Math.round((event.clientY - resizeDrag.startY) / 26)
      const startMinutes = Number(timeFromDateTime(resizeDrag.booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(resizeDrag.booking.start_at).slice(3))
      const maxDuration = Math.min(240, 24 * 60 - startMinutes)
      const duration = Math.max(resizeDrag.minimumDuration, Math.min(maxDuration, resizeDrag.initialDuration + deltaSlots * 30))
      setResizeDrag((current) => ({ ...current, duration }))
    }
    const up = async () => {
      const booking = resizeDrag.booking
      const duration = resizeDrag.duration
      setResizeDrag(null)
      if (duration === resizeDrag.initialDuration) return
      const court = COURTS.find((item) => item.id === booking.court_id) || COURTS[0]
      resizeDrag.groupSize > 1
        ? await onRescheduleGroup(booking, timeFromDateTime(booking.start_at), duration, booking.start_at.slice(0, 10))
        : await onReschedule(booking, court, timeFromDateTime(booking.start_at), duration, booking.start_at.slice(0, 10))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [onReschedule, onRescheduleGroup, resizeDrag])

  return (
    <section
      ref={editorRef}
      className="admin-schedule-editor"
      aria-label={t('admin.schedule.aria')}
      onContextMenu={(event) => {
        if (!rangeDraft && !activeSelection) return
        event.preventDefault()
        setRangeDraft(null)
        setSelectedBooking(null)
      }}
    >
      <header>
        <div>
          <span className="eyebrow"><GripVertical size={13} /> {t('admin.schedule.eyebrow')}</span>
          <h2>{t('admin.schedule.title')}</h2>
          <p>{t('admin.schedule.description')}</p>
        </div>
        <div className="admin-schedule-date">
          <label><strong>{dayLabel}</strong><input type="date" value={dateKey} onChange={(event) => selectDate(event.target.value)} /></label>
        </div>
      </header>

      <section className={`admin-schedule-inspector ${activeSelection ? 'has-booking' : ''}`} aria-live="polite">
        {activeSelection ? (
          <>
            <div className="admin-inspector-title">
              <span>{t('admin.schedule.bookingDetails')}</span>
              <strong>{activeSelection.customer_name}</strong>
              <span className={`status-pill ${activeSelection.status}`}>{t(`status.${activeSelection.status}`)}</span>
              {!editingDetails && <button className="admin-inspector-edit" onClick={() => setEditingDetails(true)}><Pencil size={12} /> {t('admin.schedule.editDetails')}</button>}
            </div>
            {editingDetails ? (
              <form className="admin-inspector-form" onSubmit={async (event) => {
                event.preventDefault()
                const saved = await onUpdateDetails(activeSelection, detailsForm)
                if (saved) setEditingDetails(false)
              }}>
                <label><span>{t('admin.schedule.customerName')}</span><input required maxLength="120" value={detailsForm.name} onChange={(event) => setDetailsForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>{t('admin.schedule.customerEmailOptional')}</span><input type="email" maxLength="320" value={detailsForm.email} onChange={(event) => setDetailsForm((current) => ({ ...current, email: event.target.value }))} /></label>
                <label><span>{t('admin.schedule.customerPhoneOptional')}</span><input type="tel" maxLength="40" value={detailsForm.phone} onChange={(event) => setDetailsForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label className="admin-payment-toggle"><input type="checkbox" checked={detailsForm.paymentStatus === 'paid'} onChange={(event) => setDetailsForm((current) => ({ ...current, paymentStatus: event.target.checked ? 'paid' : (activeSelection.payment_method === 'stripe' ? 'pending' : 'pay_at_venue') }))} /><span>{t('admin.schedule.markPaid')}</span></label>
                <label className="notes"><span>{t('admin.schedule.customerNotesOptional')}</span><textarea maxLength="2000" rows="2" value={detailsForm.notes} onChange={(event) => setDetailsForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <div className="admin-inspector-form-actions"><button type="button" onClick={() => setEditingDetails(false)}>{t('admin.schedule.discardDetails')}</button><button className="save" disabled={busy}><Save size={12} /> {busy ? t('admin.schedule.saving') : t('admin.schedule.saveDetails')}</button></div>
              </form>
            ) : (
              <dl>
                <div><dt>{t('admin.schedule.courtTime')}</dt><dd>{activeGroup.map((booking) => courtTitle(COURTS.find((court) => court.id === booking.court_id) || COURTS[0])).join(' + ')} · {activeSelection.start_at.slice(0, 10).replaceAll('-', '.')} · {timeFromDateTime(activeSelection.start_at)}–{endTimeFromDateTime(activeSelection.start_at, activeSelection.end_at)}</dd></div>
                <div><dt>{t('admin.schedule.bookedAt')}</dt><dd>{activeSelection.created_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activeSelection.created_at)) : t('admin.schedule.notRecorded')}</dd></div>
                <div><dt>{t('admin.schedule.contact')}</dt><dd>{activeSelection.customer_email || t('admin.schedule.notProvided')} · {activeSelection.customer_phone || t('admin.schedule.notProvided')}</dd></div>
                <div><dt>{t('admin.schedule.bookingMeta')}</dt><dd>{t('admin.people', { count: activeSelection.party_size })} · <span className={`admin-payment-status ${activeSelection.payment_status === 'paid' ? 'paid' : 'unpaid'}`}>{t(activeSelection.payment_status === 'paid' ? 'admin.schedule.paymentPaid' : 'admin.schedule.paymentUnpaid')}</span> · {t(`payment.${activeSelection.payment_status}`)} · {formatMoney(groupPrice, locale)}</dd></div>
                {activeSelection.recurrence_series_id && <div><dt>{t('admin.schedule.recurrence')}</dt><dd>{t('admin.schedule.recurrenceWeek', { count: activeSelection.recurrence_week })}</dd></div>}
                <div className="notes"><dt>{t('admin.schedule.customerNotes')}</dt><dd>{activeSelection.customer_notes || t('admin.schedule.noNotes')}</dd></div>
              </dl>
            )}
          </>
        ) : (
          <div className="admin-inspector-empty"><strong>{t('admin.schedule.noSelectionTitle')}</strong><span>{t('admin.schedule.noSelectionText')}</span></div>
        )}
      </section>
      <div className={`admin-schedule-context ${draggedBooking && dragPreview ? `dragging ${dragPreview.invalid ? 'invalid' : ''}` : activeSelection ? 'selected' : focusTime ? 'phone-focus' : ''}`}>
        {draggedBooking && dragPreview ? (
          <div className="admin-drag-readout" role="status" aria-live="polite">
            <span>{t('admin.schedule.preview')}</span>
            <strong>{draggedBooking.customer_name}</strong>
            <b>{dateKey.replaceAll('-', '.')} · {courtTitle(dragPreview.court)} · {dragPreview.time}–{dragPreview.endTime}</b>
            <small>{t(dragPreview.invalid ? 'admin.schedule.pastDropBlocked' : 'admin.schedule.releaseToMove')}</small>
          </div>
        ) : activeSelection ? (
          <div className="admin-schedule-selection" role="status">
            <GripVertical size={14} />
            <strong>{activeSelection.customer_name}</strong>
            <span>{t('admin.schedule.pickDestination')}</span>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => setSelectedBooking(null)}><X size={13} /> {t('admin.schedule.clearSelection')}</button>
          </div>
        ) : focusTime ? (
          <div className="admin-phone-focus-guide" role="status" aria-live="polite">
            <PhoneCall size={15} />
            <strong>{t('admin.schedule.phoneFocusTitle')}</strong>
            <span>{t('admin.schedule.phoneFocusText', { date: dateKey.replaceAll('-', '.'), time: focusTime })}</span>
            <button onClick={onClearFocus}><X size={13} /> {t('admin.schedule.clearPhoneFocus')}</button>
          </div>
        ) : (
          <div className="admin-schedule-hint"><GripVertical size={14} /> {t('admin.schedule.hint')}<span><CalendarPlus size={14} /> {t('admin.schedule.addHint')}</span></div>
        )}
      </div>
      <div className="admin-schedule-workbench">
        <aside className="admin-schedule-side admin-schedule-side-left">
          <div className="admin-schedule-day-strip" aria-label={t('admin.schedule.quickDays')}>
            <button className="week-nav" onClick={() => moveWeek(-1)} aria-label={t('admin.schedule.previousWeek')}><ChevronLeft size={18} /><small>{t('admin.schedule.previousWeekShort')}</small></button>
            {quickDays.map((day) => (
              <button
                className={`${dateKey === day.key ? 'active' : ''} ${day.key < nowAtVenue.dateKey ? 'past' : ''} ${dragDay === day.key ? 'drop-target' : ''}`}
                data-transfer-date={day.key >= nowAtVenue.dateKey ? day.key : undefined}
                key={day.key}
                onClick={() => chooseTransferDay(day.key, null)}
              >
                <small>{dateKey === day.key ? t('admin.schedule.selectedDay') : day.weekday}</small>
                <strong>{day.day}</strong>
              </button>
            ))}
            <button className="week-nav" onClick={() => moveWeek(1)} aria-label={t('admin.schedule.nextWeek')}><ChevronRight size={18} /><small>{t('admin.schedule.nextWeekShort')}</small></button>
          </div>
        </aside>
        <div className="admin-schedule-scroll">
          <div className="admin-schedule-grid">
          {currentLineOffset !== null && <div className="admin-now-line" style={{ '--now-top': `${64 + currentLineOffset * 26}px` }} aria-label={t('admin.schedule.nowLine', { time: nowAtVenue.time })}><span>{t('admin.schedule.now')} {nowAtVenue.time}</span></div>}
          {multiCourtGroups.map((group) => (
            <div
              className="admin-booking-group-rail"
              style={{ '--group-first': group.firstCourt, '--group-last': group.lastCourt, '--group-start': group.start, '--group-span': group.span }}
              aria-label={t('admin.schedule.multiCourtLinked', { count: group.count })}
              data-label={t('admin.schedule.multiCourtLinked', { count: group.count })}
              key={group.id}
            />
          ))}
          <div className="admin-schedule-corner"><Clock3 size={14} /></div>
          {COURTS.map((court) => <div className={`admin-schedule-court ${court.tone}`} key={court.id}><span>{court.name}</span><strong>{courtTitle(court)}</strong></div>)}
          <div className="admin-schedule-times">
            {HALF_HOURS.map((time, index) => <div className={`${index % 2 ? 'half' : ''} ${focusTime === time ? 'phone-focus' : ''}`} data-schedule-time={time} key={time}>{index % 2 === 0 ? time : ''}</div>)}
          </div>
          {COURTS.map((court) => (
            <div
              className={`admin-schedule-lane ${court.tone} ${dragPreview?.court.id === court.id ? 'previewing' : ''}`}
              data-court-id={court.id}
              key={court.id}
            >
              {HALF_HOURS.map((time, index) => {
                const past = isPastSlot(dateKey, time, now)
                return (
                <button
                  className={`admin-schedule-slot ${past ? 'past' : ''} ${focusTime === time ? 'phone-focus' : ''}`}
                  key={time}
                  disabled={time === '23:30' || past}
                  data-court-id={court.id}
                  data-index={index}
                  onClick={() => { if (!rangeDraft && time !== '23:30') chooseSlot(court, time) }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || busy || activeSelection) return
                    event.preventDefault()
                    onClearFocus?.()
                    setRangeDraft({ dragging: true, court, startIndex: index, currentIndex: index, pointerId: event.pointerId })
                  }}
                  aria-label={t('admin.schedule.emptySlot', { court: courtTitle(court), time })}
                />
                )
              })}
              {rangeDraft?.court.id === court.id && <div className={`admin-range-preview ${rangeDraft.startIndex === rangeDraft.currentIndex ? 'compact' : ''}`} style={{ '--start': Math.min(rangeDraft.startIndex, rangeDraft.currentIndex), '--span': Math.abs(rangeDraft.currentIndex - rangeDraft.startIndex) + 1 }}><strong>{timeFromMinutes(OPEN_MINUTES + Math.min(rangeDraft.startIndex, rangeDraft.currentIndex) * 30)}–{timeFromMinutes(OPEN_MINUTES + (Math.max(rangeDraft.startIndex, rangeDraft.currentIndex) + 1) * 30)}</strong><span>{t('admin.schedule.releaseToCreate')}</span></div>}
              {draggedBooking && dragPreview?.court.id === court.id && (
                <div
                  className={`admin-schedule-drop-preview ${dragPreview.invalid ? 'invalid' : ''}`}
                  style={{ '--start': dragPreview.index, '--span': dragPreview.span }}
                  aria-hidden="true"
                >
                  <strong>{dragPreview.time}–{dragPreview.endTime}</strong>
                  <span>{t(dragPreview.invalid ? 'admin.schedule.pastDropBlockedShort' : 'admin.schedule.dropHere')}</span>
                </div>
              )}
              {dayBookings.filter((booking) => booking.court_id === court.id).map((booking) => {
                const startMinutes = Number(timeFromDateTime(booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(booking.start_at).slice(3))
                const offset = startMinutes - OPEN_MINUTES
                const groupSize = dayBookings.filter((item) => (item.booking_group_id || item.id) === (booking.booking_group_id || booking.id)).length
                const bookingGroupKey = booking.booking_group_id || booking.id
                const resizeGroupKey = resizeDrag ? (resizeDrag.booking.booking_group_id || resizeDrag.booking.id) : null
                const minutes = resizeGroupKey === bookingGroupKey ? resizeDrag.duration : durationMinutes(booking)
                const bookingPhase = bookingPhaseAtVenue(booking, nowAtVenue)
                const canMove = bookingPhase === 'future'
                const nowSeconds = Number(nowAtVenue.dateTime.slice(17, 19))
                const minimumEndMinutes = Math.ceil((nowAtVenue.minutes + 30 + (nowSeconds > 0 ? 1 / 60 : 0)) / 30) * 30
                const minimumResizeDuration = bookingPhase === 'in-progress' ? Math.max(60, minimumEndMinutes - startMinutes) : 60
                const maximumResizeDuration = Math.min(240, 24 * 60 - startMinutes)
                const canResize = bookingPhase !== 'ended' && minimumResizeDuration <= maximumResizeDuration
                return (
                  <article
                    className={`admin-schedule-booking ${bookingPhase} ${groupSize > 1 ? 'grouped' : ''} ${draggedId === booking.id ? 'dragging' : ''} ${draggedId === booking.id && dragPreview?.invalid ? 'invalid-target' : ''} ${selectedBooking?.id === booking.id ? 'selected' : ''}`}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    role="button"
                    tabIndex="0"
                    aria-pressed={activeSelection?.id === booking.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (pointerMoved.current) { pointerMoved.current = false; return }
                      event.currentTarget.blur()
                      setSelectedBooking((current) => current?.id === booking.id ? null : booking)
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedBooking((current) => current?.id === booking.id ? null : booking) } }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || busy || !canMove) return
                      event.preventDefault()
                      window.getSelection()?.removeAllRanges()
                      event.currentTarget.setPointerCapture?.(event.pointerId)
                      const grabOffset = event.clientY - event.currentTarget.getBoundingClientRect().top
                      pointerMoved.current = false
                      pointerTarget.current = null
                      setSelectedBooking(null)
                      setPointerDrag({ booking, grabOffset, startX: event.clientX, startY: event.clientY })
                    }}
                    style={{ '--start': offset / 30, '--span': minutes / 30 }}
                    key={booking.id}
                    title={t(canMove ? 'admin.schedule.dragTitle' : bookingPhase === 'in-progress' ? 'admin.schedule.inProgressResizeTitle' : 'admin.schedule.endedReadOnly', { name: booking.customer_name })}
                  >
                    {canMove ? <GripVertical size={14} /> : <Clock3 className="admin-booking-state-icon" size={14} />}
                    <div><strong>{booking.customer_name}{groupSize > 1 ? ` · ${t('admin.schedule.multiCourtShort', { count: groupSize })}` : ''}</strong><span>{timeFromDateTime(booking.start_at)}–{resizeGroupKey === bookingGroupKey ? timeFromMinutes(startMinutes + minutes) : endTimeFromDateTime(booking.start_at, booking.end_at)}</span><small className={`admin-booking-payment ${booking.payment_status === 'paid' ? 'paid' : 'unpaid'}`}>{t(booking.payment_status === 'paid' ? 'admin.schedule.paymentPaid' : 'admin.schedule.paymentUnpaid')}</small></div>
                    {canResize && <button className="admin-resize-handle" aria-label={t('admin.schedule.resize')} title={t('admin.schedule.resize')} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); setResizeDrag({ booking, startY: event.clientY, initialDuration: durationMinutes(booking), duration: durationMinutes(booking), minimumDuration: minimumResizeDuration, groupSize }) }} />}
                  </article>
                )
              })}
            </div>
          ))}
          </div>
        </div>
        <aside className="admin-schedule-side admin-schedule-side-right">
          <div
            className={`admin-schedule-cancel-drop ${draggedId ? 'active' : ''} ${cancelArmed ? 'armed' : ''}`}
            aria-label={t('admin.schedule.cancelDrop')}
          >
            <Trash2 size={22} />
            <div><strong>{cancelArmed ? t('admin.schedule.cancelRelease') : t('admin.schedule.cancelDrop')}</strong><span>{t('admin.schedule.cancelProtection')}</span></div>
          </div>
        </aside>
      </div>
      {draft && <NewBookingModal draft={draft} busy={busy} onClose={() => setDraft(null)} onSubmit={async (details) => { const result = await onCreate(details); if (result?.saved) setDraft(null); return result }} />}
    </section>
  )
}
