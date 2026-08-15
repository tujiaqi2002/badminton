import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock3, GripVertical, History, Link2, MessageSquareText, Pencil, PhoneCall, Repeat2, Save, Trash2, X } from 'lucide-react'
import { addDays, bookingDurations, COURTS, endTimeFromDateTime, formatMoney, isPastSlot, mondayOfWeek, timeFromDateTime, toDateKey, venueNow } from '../lib/booking'
import { customerToneForBooking } from '../lib/bookingColors'
import { useI18n } from '../lib/i18n'
import AdminAuditDrawer from './AdminAuditDrawer'

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

const timeFromMinutes = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const bookingPhaseAtVenue = (booking, nowAtVenue) => {
  if (booking.end_at <= nowAtVenue.dateTime) return 'ended'
  if (booking.start_at <= nowAtVenue.dateTime) return 'in-progress'
  return 'future'
}

function ScheduleDatePicker({ dateKey, dayLabel, locale, todayKey, onSelect, t }) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [monthCursor, setMonthCursor] = useState(() => {
    const selected = new Date(`${dateKey}T12:00:00`)
    return new Date(selected.getFullYear(), selected.getMonth(), 1, 12)
  })

  useEffect(() => {
    const selected = new Date(`${dateKey}T12:00:00`)
    setMonthCursor(new Date(selected.getFullYear(), selected.getMonth(), 1, 12))
  }, [dateKey])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const calendarDays = useMemo(() => {
    const firstDayOffset = (monthCursor.getDay() + 6) % 7
    const firstCell = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1 - firstDayOffset, 12)
    return Array.from({ length: 42 }, (_, index) => addDays(firstCell, index))
  }, [monthCursor])
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => (
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(addDays(new Date('2026-08-10T12:00:00'), index))
  )), [locale])
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(monthCursor)
  const fullDate = (date) => new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date)
  const moveMonth = (amount) => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12))
  const chooseDate = (next) => {
    onSelect(next)
    setOpen(false)
  }

  return (
    <div className={`admin-schedule-date-inline ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-date-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('admin.schedule.chooseDate')}
      >
        <span><strong>{dayLabel}</strong><small>{dateKey.replaceAll('-', '.')}</small></span>
        <CalendarDays size={14} />
      </button>
      {open && (
        <div className="admin-calendar-popover" role="dialog" aria-label={t('admin.schedule.chooseDate')}>
          <header>
            <button type="button" onClick={() => moveMonth(-1)} aria-label={t('admin.schedule.previousMonth')}><ChevronLeft size={17} /></button>
            <strong>{monthLabel}</strong>
            <button type="button" onClick={() => moveMonth(1)} aria-label={t('admin.schedule.nextMonth')}><ChevronRight size={17} /></button>
          </header>
          <div className="admin-calendar-weekdays" aria-hidden="true">{weekdays.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}</div>
          <div className="admin-calendar-days">
            {calendarDays.map((date) => {
              const key = toDateKey(date)
              const outsideMonth = date.getMonth() !== monthCursor.getMonth()
              return (
                <button
                  type="button"
                  className={`${key === dateKey ? 'selected' : ''} ${key === todayKey ? 'today' : ''} ${outsideMonth ? 'outside' : ''}`}
                  onClick={() => chooseDate(key)}
                  aria-label={fullDate(date)}
                  aria-current={key === dateKey ? 'date' : undefined}
                  key={key}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <button type="button" className="admin-calendar-today" onClick={() => chooseDate(todayKey)}><CalendarDays size={13} /> {t('admin.today')}</button>
        </div>
      )}
    </div>
  )
}

function NewBookingModal({ draft, busy, onClose, onSubmit, configuration }) {
  const { courtTitle, t } = useI18n()
  const durations = bookingDurations(configuration, true)
  const closeMinute = Number(configuration?.opening_hours?.close_minute || 1440)
  const initialDuration = draft.duration || (durations.includes(60) ? 60 : durations[0] || 30)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', duration: initialDuration, partySize: 2, courts: draft.courts || [draft.court], recurring: false, weekCount: 4 })
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
          <label><span>{t('admin.schedule.duration')}</span><select value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}>{durations.map((minutes) => <option value={minutes} key={minutes} disabled={Number(draft.time.slice(0, 2)) * 60 + Number(draft.time.slice(3)) + minutes > closeMinute}>{minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}</option>)}</select></label>
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

export default function AdminSchedule({ bookings, events = [], initialDate, busy, onCreate, onReschedule, onRescheduleGroup, onCancel, onUpdateDetails, onDateChange, focusTime, onClearFocus, auditOperations = [], auditLoading = false, auditRevertingId = null, onOpenAudit, onRevertAudit, configuration }) {
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
  const [auditOpen, setAuditOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const pointerMoved = useRef(false)
  const pointerTarget = useRef(null)
  const editorRef = useRef(null)
  const slotMinutes = Number(configuration?.settings?.slot_minutes || 30)
  const managerMaxMinutes = Number(configuration?.settings?.manager_max_minutes || 240)
  const openMinutes = Number(configuration?.opening_hours?.open_minute || 600)
  const closeMinutes = Number(configuration?.opening_hours?.close_minute || 1440)
  const venueClosed = Boolean(configuration?.opening_hours?.is_closed)
  const minimumBookingDuration = Math.ceil(30 / slotMinutes) * slotMinutes
  const currency = configuration?.settings?.currency || 'CAD'
  const timeSlots = useMemo(() => Array.from({ length: Math.max(0, Math.floor((closeMinutes - openMinutes) / slotMinutes)) }, (_, index) => timeFromMinutes(openMinutes + index * slotMinutes)), [closeMinutes, openMinutes, slotMinutes])

  useEffect(() => {
    setSelectedBooking(null)
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

  useEffect(() => {
    if (draggedId) setAuditOpen(false)
  }, [draggedId])

  const dayBookings = useMemo(() => bookings.filter((booking) => (
    booking.start_at.startsWith(dateKey) && ['held', 'confirmed'].includes(booking.status)
  )), [bookings, dateKey])
  const dayEvents = useMemo(() => events.filter((item) => (
    item.status === 'scheduled'
      && item.starts_at < `${dateKey}T24:00:00`
      && item.ends_at > `${dateKey}T00:00:00`
  )), [dateKey, events])

  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`))
  const draggedBooking = bookings.find((booking) => booking.id === draggedId)
  const activeSelection = selectedBooking && (bookings.find((booking) => booking.id === selectedBooking.id) || selectedBooking)
  const activeGroup = activeSelection ? bookings.filter((booking) => (booking.booking_group_id || booking.id) === (activeSelection.booking_group_id || activeSelection.id) && ['held', 'confirmed'].includes(booking.status)) : []
  const groupPrice = activeGroup.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0)
  const nowAtVenue = venueNow(now)
  const currentLineOffset = dateKey === nowAtVenue.dateKey && nowAtVenue.minutes >= openMinutes && nowAtVenue.minutes <= closeMinutes
    ? (nowAtVenue.minutes - openMinutes) / slotMinutes
    : null
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

  const markSelectionPaid = async () => {
    if (!activeSelection || activeSelection.payment_status === 'paid' || busy) return
    await onUpdateDetails(activeSelection, {
      name: activeSelection.customer_name || '',
      email: activeSelection.customer_email || '',
      phone: activeSelection.customer_phone || '',
      notes: activeSelection.customer_notes || '',
      paymentStatus: 'paid',
    })
  }

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
    setSelectedBooking(null)
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
      const slotHeight = rect.height / timeSlots.length
      const duration = durationMinutes(pointerDrag.booking)
      const maxIndex = Math.max(0, Math.floor((closeMinutes - openMinutes - duration) / slotMinutes))
      const index = Math.max(0, Math.min(maxIndex, Math.round((event.clientY - rect.top - pointerDrag.grabOffset) / slotHeight)))
      const startMinutes = openMinutes + index * slotMinutes
      const nextTarget = { court, index, time: timeFromMinutes(startMinutes), endTime: timeFromMinutes(startMinutes + duration), span: duration / slotMinutes }
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
        const nextDate = dayButton?.dataset.transferDate || pointerTarget.current.date
        pointerTarget.current = null
        finishDrag()
        setSelectedBooking(null)
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
  }, [bookings, closeMinutes, dateKey, now, onCancel, onDateChange, onReschedule, onRescheduleGroup, openMinutes, pointerDrag, slotMinutes, timeSlots.length])

  const chooseSlot = (court, time) => {
    const startMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    if (venueClosed || startMinutes + minimumBookingDuration > closeMinutes || isPastSlot(dateKey, time, now)) return
    if (activeSelection) {
      setSelectedBooking(null)
      return
    }
    onClearFocus?.()
    const durations = bookingDurations(configuration, true).filter((minutes) => startMinutes + minutes <= closeMinutes)
    setDraft({ court, courts: [court], dateKey, time, duration: durations.includes(60) ? 60 : durations[0] || minimumBookingDuration })
  }

  const chooseTransferDay = (next) => {
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
      const duration = Math.max(minimumBookingDuration, Math.min(managerMaxMinutes, span * slotMinutes))
      const startMinutes = openMinutes + startIndex * slotMinutes
      const startTime = timeFromMinutes(startMinutes)
      if (!venueClosed && startMinutes + duration <= closeMinutes && !isPastSlot(dateKey, startTime, now)) setDraft({ court: rangeDraft.court, courts: [rangeDraft.court], dateKey, time: startTime, duration })
      setRangeDraft(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [closeMinutes, dateKey, managerMaxMinutes, minimumBookingDuration, now, openMinutes, rangeDraft, slotMinutes, venueClosed])

  useEffect(() => {
    if (!resizeDrag) return undefined
    const move = (event) => {
      const deltaSlots = Math.round((event.clientY - resizeDrag.startY) / 26)
      const startMinutes = Number(timeFromDateTime(resizeDrag.booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(resizeDrag.booking.start_at).slice(3))
      const maxDuration = Math.min(managerMaxMinutes, closeMinutes - startMinutes)
      const duration = Math.max(resizeDrag.minimumDuration, Math.min(maxDuration, resizeDrag.initialDuration + deltaSlots * slotMinutes))
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
  }, [closeMinutes, managerMaxMinutes, onReschedule, onRescheduleGroup, resizeDrag, slotMinutes])

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
                <div><dt>{t('admin.schedule.bookingMeta')}</dt><dd className="admin-booking-meta">{t('admin.people', { count: activeSelection.party_size })} · <label className={`admin-quick-payment ${activeSelection.payment_status === 'paid' ? 'paid' : 'unpaid'}`} title={t(activeSelection.payment_status === 'paid' ? 'admin.schedule.paidEditHint' : 'admin.schedule.quickMarkPaid')}><input type="checkbox" checked={activeSelection.payment_status === 'paid'} disabled={busy || activeSelection.payment_status === 'paid'} onChange={markSelectionPaid} /><span>{t(activeSelection.payment_status === 'paid' ? 'admin.schedule.paymentPaid' : 'admin.schedule.quickMarkPaid')}</span></label> · {t(`payment.${activeSelection.payment_status}`)} · {formatMoney(groupPrice, locale, currency)}</dd></div>
                {activeSelection.recurrence_series_id && <div><dt>{t('admin.schedule.recurrence')}</dt><dd>{t('admin.schedule.recurrenceWeek', { count: activeSelection.recurrence_week })}</dd></div>}
                <div className="notes"><dt>{t('admin.schedule.customerNotes')}</dt><dd>{activeSelection.customer_notes || t('admin.schedule.noNotes')}</dd></div>
              </dl>
            )}
          </>
        ) : (
          <div className="admin-inspector-empty"><strong>{t('admin.schedule.noSelectionTitle')}</strong><span>{t('admin.schedule.noSelectionText')}</span></div>
        )}
      </section>
      <div className={`admin-schedule-context ${draggedBooking && dragPreview ? `dragging ${dragPreview.invalid ? 'invalid' : ''}` : focusTime ? 'phone-focus' : ''}`}>
        {draggedBooking && dragPreview ? (
          <div className="admin-drag-readout" role="status" aria-live="polite">
            <span>{t('admin.schedule.preview')}</span>
            <strong>{draggedBooking.customer_name}</strong>
            <b>{dateKey.replaceAll('-', '.')} · {courtTitle(dragPreview.court)} · {t('admin.schedule.dragStart')} {dragPreview.time} → {t('admin.schedule.dragEnd')} {dragPreview.endTime}</b>
            <small>{t(dragPreview.invalid ? 'admin.schedule.pastDropBlocked' : 'admin.schedule.releaseToMove')}</small>
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
            <ScheduleDatePicker dateKey={dateKey} dayLabel={dayLabel} locale={locale} todayKey={nowAtVenue.dateKey} onSelect={selectDate} t={t} />
            <button className="today-nav" onClick={() => selectDate(nowAtVenue.dateKey)} aria-label={t('admin.schedule.goToday')}><CalendarDays size={15} /><small>{t('admin.today')}</small></button>
            <button className="week-nav" onClick={() => moveWeek(-1)} aria-label={t('admin.schedule.previousWeek')}><ChevronLeft size={18} /><small>{t('admin.schedule.previousWeekShort')}</small></button>
            {quickDays.map((day) => (
              <button
                className={`${dateKey === day.key ? 'active' : ''} ${day.key < nowAtVenue.dateKey ? 'past' : ''} ${dragDay === day.key ? 'drop-target' : ''}`}
                data-transfer-date={day.key >= nowAtVenue.dateKey ? day.key : undefined}
                key={day.key}
                onClick={() => chooseTransferDay(day.key)}
              >
                <small>{dateKey === day.key ? t('admin.schedule.selectedDay') : day.weekday}</small>
                <strong>{day.day}</strong>
              </button>
            ))}
            <button className="week-nav" onClick={() => moveWeek(1)} aria-label={t('admin.schedule.nextWeek')}><ChevronRight size={18} /><small>{t('admin.schedule.nextWeekShort')}</small></button>
          </div>
        </aside>
        <div className="admin-schedule-scroll">
          <div className={`admin-schedule-grid ${venueClosed ? 'venue-closed' : ''}`} style={{ '--slot-count': timeSlots.length }}>
          {currentLineOffset !== null && <div className="admin-now-line" style={{ '--now-top': `${50 + currentLineOffset * 26}px` }} aria-label={t('admin.schedule.nowLine', { time: nowAtVenue.time })}><span>{t('admin.schedule.now')} {nowAtVenue.time}</span></div>}
          <div className="admin-schedule-corner"><Clock3 size={14} /></div>
          {COURTS.map((court) => <div className={`admin-schedule-court ${court.tone}`} key={court.id}><span>{court.name}</span><strong>{courtTitle(court)}</strong></div>)}
          <div className="admin-schedule-times">
            {timeSlots.map((time) => { const minute = Number(time.slice(3, 5)); const boundary = (minute + slotMinutes) % 60 === 0; return <div className={`${boundary ? 'hour-boundary' : 'minor'} ${focusTime === time ? 'phone-focus' : ''}`} data-schedule-time={time} key={time}>{minute === 0 || slotMinutes >= 60 ? time : ''}</div> })}
          </div>
          {COURTS.map((court) => (
            <div
              className={`admin-schedule-lane ${court.tone} ${dragPreview?.court.id === court.id ? 'previewing' : ''}`}
              data-court-id={court.id}
              key={court.id}
            >
              {timeSlots.map((time, index) => {
                const past = isPastSlot(dateKey, time, now)
                const startMinute = openMinutes + index * slotMinutes
                return (
                <button
                  className={`admin-schedule-slot ${(startMinute + slotMinutes) % 60 === 0 ? 'hour-boundary' : ''} ${past ? 'past' : ''} ${focusTime === time ? 'phone-focus' : ''}`}
                  key={time}
                  disabled={venueClosed || startMinute + minimumBookingDuration > closeMinutes || past}
                  data-court-id={court.id}
                  data-index={index}
                  onClick={() => { if (!rangeDraft) chooseSlot(court, time) }}
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
              {rangeDraft?.court.id === court.id && <div className={`admin-range-preview ${rangeDraft.startIndex === rangeDraft.currentIndex ? 'compact' : ''}`} style={{ '--start': Math.min(rangeDraft.startIndex, rangeDraft.currentIndex), '--span': Math.abs(rangeDraft.currentIndex - rangeDraft.startIndex) + 1 }}><strong>{timeFromMinutes(openMinutes + Math.min(rangeDraft.startIndex, rangeDraft.currentIndex) * slotMinutes)}–{timeFromMinutes(openMinutes + (Math.max(rangeDraft.startIndex, rangeDraft.currentIndex) + 1) * slotMinutes)}</strong><span>{t('admin.schedule.releaseToCreate')}</span></div>}
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
              {dayEvents.filter((item) => !item.court_ids?.length || item.court_ids.includes(court.id)).map((item) => {
                const rawStart = item.starts_at.slice(0, 10) < dateKey ? openMinutes : Number(item.starts_at.slice(11, 13)) * 60 + Number(item.starts_at.slice(14, 16))
                const rawEnd = item.ends_at.slice(0, 10) > dateKey ? closeMinutes : Number(item.ends_at.slice(11, 13)) * 60 + Number(item.ends_at.slice(14, 16))
                const start = Math.max(openMinutes, rawStart)
                const end = Math.min(closeMinutes, rawEnd)
                if (end <= start) return null
                const title = locale.startsWith('zh') ? item.title_zh : item.title_en
                return <article
                  className={`admin-schedule-event ${item.blocks_booking ? 'blocking' : 'informational'} ${item.color || 'ink'}`}
                  style={{ '--start': (start - openMinutes) / slotMinutes, '--span': (end - start) / slotMinutes }}
                  title={t('admin.schedule.venueEventTitle', { title })}
                  key={`${item.id}-${court.id}`}
                >
                  <CalendarClock size={13} />
                  <div><strong>{title}</strong><span>{timeFromMinutes(start)}–{timeFromMinutes(end)}</span><small>{t(item.blocks_booking ? 'admin.schedule.eventBlocked' : 'admin.schedule.eventNotice')}</small></div>
                </article>
              })}
              {dayBookings.filter((booking) => booking.court_id === court.id).map((booking) => {
                const startMinutes = Number(timeFromDateTime(booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(booking.start_at).slice(3))
                const offset = startMinutes - openMinutes
                const groupSize = dayBookings.filter((item) => (item.booking_group_id || item.id) === (booking.booking_group_id || booking.id)).length
                const bookingGroupKey = booking.booking_group_id || booking.id
                const resizeGroupKey = resizeDrag ? (resizeDrag.booking.booking_group_id || resizeDrag.booking.id) : null
                const minutes = resizeGroupKey === bookingGroupKey ? resizeDrag.duration : durationMinutes(booking)
                const bookingPhase = bookingPhaseAtVenue(booking, nowAtVenue)
                const canMove = bookingPhase === 'future'
                const nowSeconds = Number(nowAtVenue.dateTime.slice(17, 19))
                const minimumEndMinutes = Math.ceil((nowAtVenue.minutes + (nowSeconds > 0 ? 1 / 60 : 0)) / slotMinutes) * slotMinutes
                const minimumResizeDuration = bookingPhase === 'in-progress' ? Math.max(minimumBookingDuration, minimumEndMinutes - startMinutes) : minimumBookingDuration
                const maximumResizeDuration = Math.min(managerMaxMinutes, closeMinutes - startMinutes)
                const canResize = bookingPhase !== 'ended' && minimumResizeDuration <= maximumResizeDuration
                const indicatorCount = Number(groupSize > 1) + Number(Boolean(booking.recurrence_series_id))
                const customerTone = customerToneForBooking(booking)
                return (
                  <article
                    className={`admin-schedule-booking ${bookingPhase} ${minutes <= 60 ? 'short' : ''} ${minutes === 30 ? 'half-hour' : ''} ${indicatorCount ? 'has-indicators' : ''} ${indicatorCount > 1 ? 'has-two-indicators' : ''} ${draggedId === booking.id ? 'dragging' : ''} ${draggedId === booking.id && dragPreview?.invalid ? 'invalid-target' : ''} ${selectedBooking?.id === booking.id ? 'selected' : ''}`}
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
                    style={{ '--start': offset / slotMinutes, '--span': minutes / slotMinutes, '--customer-tone': `${customerTone.lightness}%`, '--customer-hue-shift': customerTone.hue, '--customer-saturation': `${customerTone.saturation}%` }}
                    data-customer-tone={customerTone.index}
                    key={booking.id}
                    title={t(canMove ? 'admin.schedule.dragTitle' : bookingPhase === 'in-progress' ? 'admin.schedule.inProgressResizeTitle' : 'admin.schedule.endedReadOnly', { name: booking.customer_name })}
                  >
                    {canMove ? <GripVertical size={14} /> : <Clock3 className="admin-booking-state-icon" size={14} />}
                    <div>
                      <strong>{booking.customer_name}</strong>
                      <span>{timeFromDateTime(booking.start_at)}–{resizeGroupKey === bookingGroupKey ? timeFromMinutes(startMinutes + minutes) : endTimeFromDateTime(booking.start_at, booking.end_at)}</span>
                      <span className="admin-booking-tags">
                        <small className={`admin-booking-payment ${booking.payment_status === 'paid' ? 'paid' : 'unpaid'}`}>{t(booking.payment_status === 'paid' ? 'admin.schedule.paymentPaid' : 'admin.schedule.paymentUnpaid')}</small>
                        {booking.customer_notes?.trim() && <small className="admin-booking-note" title={booking.customer_notes}><MessageSquareText size={8} /> {t('admin.schedule.hasNote')}</small>}
                      </span>
                    </div>
                    {indicatorCount > 0 && <span className="admin-booking-indicators">
                      {groupSize > 1 && <span className="admin-booking-indicator" title={t('admin.schedule.multiCourtLinked', { count: groupSize })}><Link2 size={12} /></span>}
                      {booking.recurrence_series_id && <span className="admin-booking-indicator" title={t('admin.schedule.recurrenceCard', { count: booking.recurrence_week })}><Repeat2 size={12} /></span>}
                    </span>}
                    {canResize && <button className="admin-resize-handle" aria-label={t('admin.schedule.resize')} title={t('admin.schedule.resize')} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); setResizeDrag({ booking, startY: event.clientY, initialDuration: durationMinutes(booking), duration: durationMinutes(booking), minimumDuration: minimumResizeDuration, groupSize }) }} />}
                  </article>
                )
              })}
            </div>
          ))}
          </div>
        </div>
        <aside className="admin-schedule-side admin-schedule-side-right">
          {draggedId ? (
            <div
              className={`admin-schedule-cancel-drop active ${cancelArmed ? 'armed' : ''}`}
              aria-label={t('admin.schedule.cancelDrop')}
            >
              <Trash2 size={22} />
              <div><strong>{cancelArmed ? t('admin.schedule.cancelRelease') : t('admin.schedule.cancelDrop')}</strong><span>{t('admin.schedule.cancelProtection')}</span></div>
            </div>
          ) : (
            <button className="admin-audit-launcher" type="button" onClick={() => { setAuditOpen(true); onOpenAudit?.() }}>
              <span><History size={18} /></span>
              <strong>{t('admin.audit.launchTitle')}</strong>
              <small>{t('admin.audit.launchHelp')}</small>
              <b>{auditOperations.length}</b>
            </button>
          )}
        </aside>
      </div>
      <AdminAuditDrawer
        open={auditOpen}
        operations={auditOperations}
        loading={auditLoading}
        revertingId={auditRevertingId}
        onClose={() => setAuditOpen(false)}
        onRevert={onRevertAudit}
      />
      {draft && <NewBookingModal draft={draft} busy={busy} configuration={configuration} onClose={() => setDraft(null)} onSubmit={async (details) => { const result = await onCreate(details); if (result?.saved) setDraft(null); return result }} />}
    </section>
  )
}
