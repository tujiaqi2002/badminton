import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BadgeDollarSign, CalendarClock, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, GripVertical, Layers3, Link2, LockKeyhole, MessageSquareText, Pencil, PhoneCall, Plus, Repeat2, RotateCcw, Save, Trash2, Unlink, UnlockKeyhole, UsersRound, X } from 'lucide-react'
import { addDays, bookingDurations, COURTS, endTimeFromDateTime, formatMoney, isPastSlot, mondayOfWeek, timeFromDateTime, toDateKey, venueNow } from '../lib/booking'
import { createCustomerColorMap, customerColorForBooking } from '../lib/bookingColors'
import { activeBookingGroup, activeBookingGroupSize, BOOKING_MOVE_SCOPE_GROUP, bookingMoveScope, resizeAppliesToBooking } from '../lib/bookingMoveScope'
import { canLinkBookings } from '../lib/bookingRelationships'
import { bookingSwapPreview } from '../lib/bookingSwap'
import { DRAG_LOCK_COURT_ONLY, DRAG_LOCK_FREE, DRAG_LOCK_TIME_ONLY, useDisplay } from '../lib/display'
import { useI18n } from '../lib/i18n'
import AdminAuditDrawer, { AdminAuditQuickPanel } from './AdminAuditDrawer'

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

function NewBookingModal({ draft, busy, onClose, onSubmit, onPreviewPrice, configuration }) {
  const { courtTitle, locale, t } = useI18n()
  const durations = bookingDurations(configuration, true)
  const closeMinute = Number(configuration?.opening_hours?.close_minute || 1440)
  const initialDuration = draft.duration || (durations.includes(60) ? 60 : durations[0] || 30)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', duration: initialDuration, partySize: 2, courts: draft.courts || [draft.court], recurring: false, weekCount: 4 })
  const [conflicts, setConflicts] = useState([])
  const [pricePreview, setPricePreview] = useState(null)
  const [priceLoading, setPriceLoading] = useState(true)
  const [priceError, setPriceError] = useState('')
  const [priceEditing, setPriceEditing] = useState(false)
  const [priceOverride, setPriceOverride] = useState('')
  const priceRequest = useRef(0)
  const priceInputKey = `${draft.dateKey}|${draft.time}|${form.duration}|${form.courts.map((court) => court.id).sort().join(',')}|${form.email.trim().toLowerCase()}|${form.phone.trim()}|${form.recurring ? form.weekCount : 1}`
  const priceQuoteInput = useMemo(() => ({
    dateKey: draft.dateKey,
    time: draft.time,
    court: draft.court,
    duration: form.duration,
    courts: form.courts,
    email: form.email,
    phone: form.phone,
    recurring: form.recurring,
    weekCount: form.weekCount,
  }), [draft.dateKey, draft.time, draft.court, form.duration, form.courts, form.email, form.phone, form.recurring, form.weekCount])
  const firstOccurrence = pricePreview?.occurrences?.[0]
  const currency = pricePreview?.currency || configuration?.settings?.currency || 'CAD'
  const systemTotal = Number(pricePreview?.first_occurrence_total || 0)
  const overrideNumber = priceOverride === '' ? Number.NaN : Number(priceOverride)
  const overrideValid = !priceEditing || (Number.isFinite(overrideNumber) && overrideNumber >= 0 && overrideNumber < 1_000_000)
  const effectiveTotal = priceEditing && overrideValid ? overrideNumber : systemTotal

  useEffect(() => {
    setPriceEditing(false)
    setPriceOverride('')
  }, [priceInputKey])

  useEffect(() => {
    const requestId = priceRequest.current + 1
    priceRequest.current = requestId
    setPriceLoading(true)
    setPriceError('')
    const timeout = window.setTimeout(async () => {
      try {
        const preview = await onPreviewPrice(priceQuoteInput)
        if (priceRequest.current !== requestId) return
        setPricePreview(preview)
      } catch (error) {
        if (priceRequest.current !== requestId) return
        setPricePreview(null)
        setPriceError(error?.message || t('admin.schedule.priceUnavailable'))
      } finally {
        if (priceRequest.current === requestId) setPriceLoading(false)
      }
    }, 220)
    return () => window.clearTimeout(timeout)
  }, [onPreviewPrice, priceQuoteInput, t])

  const submit = async (event) => {
    event.preventDefault()
    if (!pricePreview || priceLoading || !overrideValid) return
    setConflicts([])
    const result = await onSubmit({
      ...draft,
      ...form,
      priceOverrideTotal: priceEditing ? overrideNumber : null,
    })
    if (result?.conflicts) setConflicts(result.conflicts)
  }

  const startEditingPrice = () => {
    setPriceOverride(systemTotal.toFixed(2))
    setPriceEditing(true)
  }

  const resetPrice = () => {
    setPriceOverride('')
    setPriceEditing(false)
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
          <section className={`admin-price-confirmation ${priceEditing ? 'editing' : ''}`} aria-live="polite">
            <header>
              <span><BadgeDollarSign size={15} /> {t('admin.schedule.priceTitle')}</span>
              {!priceLoading && pricePreview && !priceEditing && <button type="button" onClick={startEditingPrice}><Pencil size={13} /> {t('admin.schedule.priceEdit')}</button>}
              {priceEditing && <button type="button" onClick={resetPrice}><RotateCcw size={13} /> {t('admin.schedule.priceReset')}</button>}
            </header>
            {priceLoading ? (
              <div className="admin-price-state"><span className="admin-price-spinner" /> {t('admin.schedule.priceLoading')}</div>
            ) : priceError ? (
              <div className="admin-price-state error"><AlertTriangle size={15} /> {t('admin.schedule.priceUnavailable')}</div>
            ) : (
              <>
                <div className="admin-price-courts">
                  {(firstOccurrence?.courts || []).map((item) => {
                    const court = COURTS.find((candidate) => candidate.id === item.court_id)
                    return <div key={item.court_id}><span>{court ? courtTitle(court) : item.name_en}</span><strong>{formatMoney(Number(item.amount || 0), locale, currency, true)}</strong></div>
                  })}
                </div>
                {firstOccurrence?.member?.tier && <div className="admin-price-member">{t('admin.schedule.priceMemberDiscount', { tier: firstOccurrence.member.name_zh || firstOccurrence.member.name_en || firstOccurrence.member.tier, discount: Number(firstOccurrence.member.discount_percent || 0) })}</div>}
                {priceEditing && (
                  <label className="admin-price-override">
                    <span>{t('admin.schedule.priceOverrideLabel')}</span>
                    <div><b>{currency}</b><input type="number" min="0" max="999999.99" step="0.01" inputMode="decimal" value={priceOverride} onChange={(event) => setPriceOverride(event.target.value)} /></div>
                    {!overrideValid && <small>{t('admin.schedule.priceInvalid')}</small>}
                  </label>
                )}
                <div className="admin-price-total">
                  <span>{priceEditing ? t('admin.schedule.priceOverrideActive') : t('admin.schedule.priceSystem')}</span>
                  <div>{priceEditing && <del>{formatMoney(systemTotal, locale, currency, true)}</del>}<strong>{formatMoney(effectiveTotal, locale, currency, true)}</strong></div>
                </div>
                {form.recurring && <div className="admin-price-series"><span>{t('admin.schedule.priceSeries', { count: form.weekCount })}</span><strong>{formatMoney(priceEditing ? effectiveTotal * form.weekCount : Number(pricePreview.series_total || 0), locale, currency, true)}</strong></div>}
                {priceEditing && <p>{t('admin.schedule.priceOverrideHelp')}</p>}
              </>
            )}
          </section>
        </div>
        {conflicts.length > 0 && <div className="admin-recurring-conflicts" role="alert"><AlertTriangle size={17} /><div><strong>{t('admin.schedule.recurringUnavailable')}</strong><span>{t('admin.schedule.recurringUnavailableHelp')}</span><ul>{conflicts.map((conflict) => <li key={`${conflict.startAt}-${conflict.courtIds.join('-')}`}>{conflict.startAt.slice(0, 10).replaceAll('-', '.')} · {conflict.startAt.slice(11, 16)} · {conflict.courtIds.map((id) => courtTitle(COURTS.find((court) => court.id === id) || COURTS[0])).join(' + ')}</li>)}</ul></div></div>}
        <button className="primary-button" disabled={busy || !form.courts.length || priceLoading || !pricePreview || !overrideValid}>{busy ? t('admin.schedule.saving') : t('admin.schedule.createWithPrice', { price: formatMoney(effectiveTotal, locale, currency, true) })}</button>
      </form>
    </div>
  )
}

export default function AdminSchedule({ bookings, events = [], initialDate, busy, onCreate, onPreviewPrice, onReschedule, onRescheduleGroup, onSwap, onLink, onLoadRelationship, onUnlink, onMarkPaid, onCancel, onUpdateDetails, onDateChange, focusTime, onClearFocus, auditOperations = [], auditLoading = false, auditRevertingId = null, onOpenAudit, onViewAuditLog, onRevertAudit, configuration }) {
  const { bookingColorScheme, dragLockMode } = useDisplay()
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
  const [rangeFeedback, setRangeFeedback] = useState(null)
  const [resizeDrag, setResizeDrag] = useState(null)
  const [linkDrag, setLinkDrag] = useState(null)
  const [linkDropId, setLinkDropId] = useState(null)
  const [linkMode, setLinkMode] = useState(null)
  const [linkConfirmation, setLinkConfirmation] = useState(null)
  const [linkMenuOpen, setLinkMenuOpen] = useState(false)
  const [unlinkConfirmation, setUnlinkConfirmation] = useState(false)
  const [relationship, setRelationship] = useState(null)
  const [relationshipLoading, setRelationshipLoading] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditFocusId, setAuditFocusId] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const pointerMoved = useRef(false)
  const linkPointerMoved = useRef(false)
  const linkPointerStart = useRef(null)
  const suppressLinkClick = useRef(false)
  const linkTarget = useRef(null)
  const relationshipRequest = useRef(0)
  const pointerTarget = useRef(null)
  const rangeTarget = useRef(null)
  const suppressSlotClick = useRef(false)
  const rangeFeedbackTimer = useRef(null)
  const editorRef = useRef(null)
  const slotMinutes = Number(configuration?.settings?.slot_minutes || 30)
  const managerMaxMinutes = Number(configuration?.settings?.manager_max_minutes || 240)
  const openMinutes = Number(configuration?.opening_hours?.open_minute || 600)
  const closeMinutes = Number(configuration?.opening_hours?.close_minute || 1440)
  const venueClosed = Boolean(configuration?.opening_hours?.is_closed)
  const minimumBookingDuration = Math.ceil(30 / slotMinutes) * slotMinutes
  const currency = configuration?.settings?.currency || 'CAD'
  const historyLocked = configuration?.settings?.lock_historical_bookings !== false
  const multiCourtMoveTogether = configuration?.settings?.multi_court_drag_mode !== 'single'
  const timeSlots = useMemo(() => Array.from({ length: Math.max(0, Math.floor((closeMinutes - openMinutes) / slotMinutes)) }, (_, index) => timeFromMinutes(openMinutes + index * slotMinutes)), [closeMinutes, openMinutes, slotMinutes])
  const dragLockLabelKey = dragLockMode === DRAG_LOCK_COURT_ONLY
    ? 'admin.schedule.dragLockCourt'
    : dragLockMode === DRAG_LOCK_TIME_ONLY
      ? 'admin.schedule.dragLockTime'
      : 'admin.schedule.dragLockFree'

  useEffect(() => {
    setSelectedBooking(null)
    setLinkConfirmation(null)
    setLinkMode(null)
    setLinkDrag(null)
    setLinkDropId(null)
    setLinkMenuOpen(false)
    setUnlinkConfirmation(false)
    linkTarget.current = null
    setRelationship(null)
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
  const customerColorMap = useMemo(() => createCustomerColorMap(dayBookings, bookingColorScheme), [bookingColorScheme, dayBookings])
  const dayEvents = useMemo(() => events.filter((item) => (
    item.status === 'scheduled'
      && item.starts_at < `${dateKey}T24:00:00`
      && item.ends_at > `${dateKey}T00:00:00`
  )), [dateKey, events])

  const buildRangeSelection = useCallback((range) => {
    if (!range) return null
    const startIndex = Math.min(range.startIndex, range.currentIndex)
    const endIndex = Math.max(range.startIndex, range.currentIndex) + 1
    const startCourtIndex = Math.min(range.startCourtIndex, range.currentCourtIndex)
    const endCourtIndex = Math.max(range.startCourtIndex, range.currentCourtIndex)
    const courts = COURTS.slice(startCourtIndex, endCourtIndex + 1)
    const startMinutes = openMinutes + startIndex * slotMinutes
    const endMinutes = openMinutes + endIndex * slotMinutes
    const startTime = timeFromMinutes(startMinutes)
    const selectedCourtIds = new Set(courts.map((court) => court.id))
    const bookingConflict = dayBookings.some((booking) => {
      if (!selectedCourtIds.has(booking.court_id)) return false
      const bookingStart = Number(timeFromDateTime(booking.start_at).slice(0, 2)) * 60 + Number(timeFromDateTime(booking.start_at).slice(3))
      const bookingEndText = endTimeFromDateTime(booking.start_at, booking.end_at)
      const bookingEnd = Number(bookingEndText.slice(0, 2)) * 60 + Number(bookingEndText.slice(3))
      return bookingStart < endMinutes && bookingEnd > startMinutes
    })
    const eventConflict = dayEvents.some((item) => {
      if (!item.blocks_booking || (item.court_ids?.length && !item.court_ids.some((courtId) => selectedCourtIds.has(courtId)))) return false
      const eventStart = item.starts_at.slice(0, 10) < dateKey ? openMinutes : Number(item.starts_at.slice(11, 13)) * 60 + Number(item.starts_at.slice(14, 16))
      const eventEnd = item.ends_at.slice(0, 10) > dateKey ? closeMinutes : Number(item.ends_at.slice(11, 13)) * 60 + Number(item.ends_at.slice(14, 16))
      return eventStart < endMinutes && eventEnd > startMinutes
    })
    const invalid = venueClosed
      || startMinutes < openMinutes
      || endMinutes > closeMinutes
      || endMinutes - startMinutes > managerMaxMinutes
      || isPastSlot(dateKey, startTime, now)
      || bookingConflict
      || eventConflict
    return {
      ...range,
      courts,
      startIndex,
      endIndex,
      startMinutes,
      endMinutes,
      startTime,
      endTime: timeFromMinutes(endMinutes),
      duration: endMinutes - startMinutes,
      invalid,
      bookingConflict,
      eventConflict,
    }
  }, [closeMinutes, dateKey, dayBookings, dayEvents, managerMaxMinutes, now, openMinutes, slotMinutes, venueClosed])
  const rangeSelection = useMemo(() => buildRangeSelection(rangeDraft), [buildRangeSelection, rangeDraft])
  const rangeDisplay = rangeDraft?.dragging ? rangeSelection : rangeFeedback

  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${dateKey}T12:00:00`))
  const draggedBooking = bookings.find((booking) => booking.id === draggedId)
  const draggedCustomerColor = draggedBooking
    ? customerColorForBooking(draggedBooking, customerColorMap, bookingColorScheme)
    : null
  const activeSelection = selectedBooking && (bookings.find((booking) => booking.id === selectedBooking.id) || selectedBooking)
  const activeGroup = activeSelection
    ? activeBookingGroup(bookings, activeSelection).sort((left, right) => left.start_at.localeCompare(right.start_at) || left.court_id.localeCompare(right.court_id))
    : []
  const relationshipGroupCount = Number(relationship?.group_count || 0)
  const hasRelationship = Boolean(relationship?.booking_link_id && relationshipGroupCount > 1)
  const relationshipAllPaid = hasRelationship
    && Number(relationship?.paid_group_count || 0) === relationshipGroupCount
    && !relationship?.partially_paid
  const groupPrice = activeGroup.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0)
  const activeGroupSharesSchedule = activeGroup.every((booking) => (
    booking.start_at === activeSelection?.start_at && booking.end_at === activeSelection?.end_at
  ))
  const nowAtVenue = venueNow(now)
  const historicalDragCanUsePastDates = Boolean(
    draggedBooking
    && !historyLocked
    && bookingPhaseAtVenue(draggedBooking, nowAtVenue) !== 'future',
  )
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
    setLinkMenuOpen(false)
    setUnlinkConfirmation(false)
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

  const markRelationshipPaid = async () => {
    if (!activeSelection || !hasRelationship || relationshipAllPaid || busy) return
    await onMarkPaid(activeSelection.id, 'linked')
  }

  useEffect(() => {
    const requestId = relationshipRequest.current + 1
    relationshipRequest.current = requestId
    if (!activeSelection) {
      setRelationship(null)
      setRelationshipLoading(false)
      return undefined
    }
    setRelationshipLoading(true)
    Promise.resolve(onLoadRelationship(activeSelection)).then((next) => {
      if (relationshipRequest.current !== requestId) return
      setRelationship(next)
      setRelationshipLoading(false)
    }).catch(() => {
      if (relationshipRequest.current !== requestId) return
      setRelationship(null)
      setRelationshipLoading(false)
    })
    return undefined
  }, [activeSelection, onLoadRelationship])

  useEffect(() => {
    if (!linkMode && !linkConfirmation && !linkMenuOpen && !unlinkConfirmation) return undefined
    const cancelRelationshipMode = (event) => {
      if (event.key !== 'Escape') return
      setLinkMode(null)
      setLinkConfirmation(null)
      setLinkMenuOpen(false)
      setUnlinkConfirmation(false)
    }
    document.addEventListener('keydown', cancelRelationshipMode)
    return () => document.removeEventListener('keydown', cancelRelationshipMode)
  }, [linkConfirmation, linkMenuOpen, linkMode, unlinkConfirmation])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => window.clearTimeout(rangeFeedbackTimer.current), [])

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
    setLinkConfirmation(null)
    setLinkMode(null)
    setLinkDrag(null)
    setLinkDropId(null)
    setLinkMenuOpen(false)
    setUnlinkConfirmation(false)
    linkTarget.current = null
    setRelationship(null)
    setDateKey(next)
    onDateChange(next)
  }
  const moveWeek = (amount) => {
    const next = toDateKey(addDays(new Date(`${weekStart}T12:00:00`), amount * 7))
    setWeekStart(next)
    selectDate(next)
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
      const deltaX = event.clientX - pointerDrag.startX
      const deltaY = event.clientY - pointerDrag.startY
      const allowedDistance = dragLockMode === DRAG_LOCK_COURT_ONLY
        ? Math.abs(deltaX)
        : dragLockMode === DRAG_LOCK_TIME_ONLY
          ? Math.abs(deltaY)
          : Math.hypot(deltaX, deltaY)
      if (!pointerMoved.current && allowedDistance < 5) return
      pointerMoved.current = true
      setDraggedId(pointerDrag.booking.id)
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const pointInside = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return null
        const rect = node.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom ? node : null
      }
      const dayButton = dragLockMode === DRAG_LOCK_FREE ? element?.closest('[data-transfer-date]') : null
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
      const pointerCourt = COURTS.find((item) => item.id === lane.dataset.courtId)
      const sourceCourt = COURTS.find((item) => item.id === pointerDrag.booking.court_id)
      const court = dragLockMode === DRAG_LOCK_TIME_ONLY ? sourceCourt : pointerCourt
      if (!court || !pointerCourt) return
      const rect = lane.getBoundingClientRect()
      const slotHeight = rect.height / timeSlots.length
      const duration = durationMinutes(pointerDrag.booking)
      const maxIndex = Math.max(0, Math.floor((closeMinutes - openMinutes - duration) / slotMinutes))
      const sourceTime = timeFromDateTime(pointerDrag.booking.start_at)
      const sourceStartMinutes = Number(sourceTime.slice(0, 2)) * 60 + Number(sourceTime.slice(3))
      const pointerIndex = Math.max(0, Math.min(maxIndex, Math.round((event.clientY - rect.top - pointerDrag.grabOffset) / slotHeight)))
      const sourceIndex = Math.max(0, Math.min(maxIndex, Math.round((sourceStartMinutes - openMinutes) / slotMinutes)))
      const index = dragLockMode === DRAG_LOCK_COURT_ONLY ? sourceIndex : pointerIndex
      const startMinutes = openMinutes + index * slotMinutes
      const swap = bookingSwapPreview({
        bookings,
        sourceBooking: pointerDrag.booking,
        targetCourtId: court.id,
        targetDate: dateKey,
        targetStartMinute: startMinutes,
        duration,
      })
      const nextTarget = { court, index, time: timeFromMinutes(startMinutes), endTime: timeFromMinutes(startMinutes + duration), span: duration / slotMinutes, swap }
      const movingHistoricalBooking = bookingPhaseAtVenue(pointerDrag.booking, venueNow(now)) !== 'future'
      if (isPastSlot(dateKey, nextTarget.time, now) && (historyLocked || !movingHistoricalBooking)) {
        pointerTarget.current = { type: 'invalid' }
        setDragPreview({ ...nextTarget, invalid: true, invalidReason: 'past' })
        return
      }
      if (swap.mode === 'invalid') {
        pointerTarget.current = { type: 'invalid' }
        setDragPreview({ ...nextTarget, invalid: true, invalidReason: 'swap' })
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
      const dayButton = dragLockMode === DRAG_LOCK_FREE ? element?.closest('[data-transfer-date]') : null
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
        if (target.swap?.mode === 'swap') {
          await onSwap(booking, target.court, target.time, target.swap.bookings, dateKey)
          return
        }
        const result = pointerDrag.moveScope === BOOKING_MOVE_SCOPE_GROUP
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
  }, [bookings, closeMinutes, dateKey, dragLockMode, historyLocked, now, onCancel, onDateChange, onReschedule, onRescheduleGroup, onSwap, openMinutes, pointerDrag, slotMinutes, timeSlots.length])

  const chooseSlot = useCallback((court, time) => {
    const startMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    if (venueClosed || startMinutes + minimumBookingDuration > closeMinutes || isPastSlot(dateKey, time, now)) return
    if (activeSelection) {
      setSelectedBooking(null)
      return
    }
    onClearFocus?.()
    const durations = bookingDurations(configuration, true).filter((minutes) => startMinutes + minutes <= closeMinutes)
    setDraft({ court, courts: [court], dateKey, time, duration: durations.includes(60) ? 60 : durations[0] || minimumBookingDuration })
  }, [activeSelection, closeMinutes, configuration, dateKey, minimumBookingDuration, now, onClearFocus, venueClosed])

  const chooseTransferDay = (next) => {
    setDraggedId(null)
    selectDate(next)
  }

  const openAudit = (operationId = null) => {
    setAuditFocusId(operationId)
    setAuditOpen(true)
    onOpenAudit?.()
  }

  useEffect(() => {
    if (!rangeDraft) return undefined
    const move = (event) => {
      const activeRange = rangeTarget.current
      if (!activeRange || event.pointerId !== activeRange.pointerId) return
      if (!activeRange.dragging && Math.hypot(event.clientX - activeRange.startX, event.clientY - activeRange.startY) < 5) return
      const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest('.admin-schedule-lane')
      if (!lane) return
      const currentCourtIndex = COURTS.findIndex((court) => court.id === lane.dataset.courtId)
      if (currentCourtIndex < 0) return
      const rect = lane.getBoundingClientRect()
      const slotHeight = rect.height / Math.max(1, timeSlots.length)
      const rawIndex = Math.max(0, Math.min(timeSlots.length - 1, Math.floor((event.clientY - rect.top) / slotHeight)))
      const maxSpan = Math.max(1, Math.floor(managerMaxMinutes / slotMinutes))
      const delta = rawIndex - activeRange.startIndex
      const currentIndex = Math.abs(delta) + 1 > maxSpan
        ? activeRange.startIndex + Math.sign(delta) * (maxSpan - 1)
        : rawIndex
      const nextRange = { ...activeRange, dragging: true, currentCourtIndex, currentIndex }
      rangeTarget.current = nextRange
      setRangeDraft(nextRange)
    }
    const up = (event) => {
      const activeRange = rangeTarget.current
      if (!activeRange || event.pointerId !== activeRange.pointerId) return
      rangeTarget.current = null
      setRangeDraft(null)
      suppressSlotClick.current = true
      window.setTimeout(() => { suppressSlotClick.current = false }, 0)
      if (!activeRange.dragging) {
        chooseSlot(activeRange.court, timeSlots[activeRange.startIndex])
        return
      }
      const selection = buildRangeSelection(activeRange)
      if (selection?.invalid) {
        setRangeFeedback(selection)
        window.clearTimeout(rangeFeedbackTimer.current)
        rangeFeedbackTimer.current = window.setTimeout(() => setRangeFeedback(null), 2400)
        return
      }
      if (selection) setDraft({ court: selection.courts[0], courts: selection.courts, dateKey, time: selection.startTime, duration: Math.max(minimumBookingDuration, selection.duration) })
    }
    const cancel = (event) => {
      const activeRange = rangeTarget.current
      if (!activeRange || event.pointerId !== activeRange.pointerId) return
      rangeTarget.current = null
      setRangeDraft(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
  }, [buildRangeSelection, chooseSlot, dateKey, managerMaxMinutes, minimumBookingDuration, rangeDraft, slotMinutes, timeSlots])

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
      resizeDrag.moveScope === BOOKING_MOVE_SCOPE_GROUP
        ? await onRescheduleGroup(booking, timeFromDateTime(booking.start_at), duration, booking.start_at.slice(0, 10))
        : await onReschedule(booking, court, timeFromDateTime(booking.start_at), duration, booking.start_at.slice(0, 10))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [closeMinutes, managerMaxMinutes, onReschedule, onRescheduleGroup, resizeDrag, slotMinutes])

  const cancelRelationshipMode = () => {
    setLinkMode(null)
    setLinkConfirmation(null)
    setLinkMenuOpen(false)
    setUnlinkConfirmation(false)
    setLinkDrag(null)
    setLinkDropId(null)
    linkTarget.current = null
  }

  const confirmRelationship = async () => {
    if (!linkConfirmation || busy) return
    const saved = await onLink(linkConfirmation.source, linkConfirmation.target)
    if (saved) cancelRelationshipMode()
  }

  const unlinkActiveRelationship = async () => {
    if (!activeSelection || !hasRelationship || busy) return
    const saved = await onUnlink(activeSelection.id)
    if (saved) cancelRelationshipMode()
  }

  const showScheduleContext = Boolean(linkDrag || rangeDisplay || (draggedBooking && dragPreview) || focusTime)

  return (
    <section
      ref={editorRef}
      className={`admin-schedule-editor ${linkMode || linkDrag ? 'relationship-selecting' : ''}`}
      aria-label={t('admin.schedule.aria')}
      onContextMenu={(event) => {
        if (!rangeDraft && !activeSelection) return
        event.preventDefault()
        rangeTarget.current = null
        setRangeDraft(null)
        setRangeFeedback(null)
        setSelectedBooking(null)
        cancelRelationshipMode()
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
              {!editingDetails && <button
                type="button"
                className={`admin-link-handle ${hasRelationship ? 'linked' : ''} ${linkDrag ? 'dragging' : ''}`}
                aria-label={t('admin.schedule.linkHandle')}
                aria-haspopup="menu"
                aria-expanded={linkMenuOpen}
                aria-busy={relationshipLoading}
                title={t('admin.schedule.linkHandle')}
                onPointerDown={(event) => {
                  if (event.button !== 0 || busy) return
                  event.stopPropagation()
                  window.getSelection()?.removeAllRanges()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  linkPointerMoved.current = false
                  linkPointerStart.current = { booking: activeSelection, startX: event.clientX, startY: event.clientY }
                  suppressLinkClick.current = false
                  linkTarget.current = null
                  setLinkMenuOpen(false)
                  setUnlinkConfirmation(false)
                  setLinkConfirmation(null)
                  setLinkDropId(null)
                }}
                onPointerMove={(event) => {
                  const start = linkPointerStart.current
                  if (!start) return
                  if (!linkPointerMoved.current && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 5) return
                  if (!linkPointerMoved.current) {
                    linkPointerMoved.current = true
                    setLinkDrag(start)
                  }
                  const targetId = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-booking-id]')?.dataset.bookingId
                  const target = bookings.find((booking) => booking.id === targetId)
                  const nextTargetId = canLinkBookings(start.booking, target) ? target.id : null
                  linkTarget.current = nextTargetId
                  setLinkDropId(nextTargetId)
                }}
                onPointerUp={(event) => {
                  const start = linkPointerStart.current
                  if (!start) return
                  const moved = linkPointerMoved.current
                  const target = bookings.find((booking) => booking.id === linkTarget.current)
                  if (moved && target) {
                    setLinkConfirmation({ source: start.booking, target })
                    setLinkMenuOpen(false)
                    setUnlinkConfirmation(false)
                  }
                  suppressLinkClick.current = moved
                  linkPointerStart.current = null
                  linkPointerMoved.current = false
                  linkTarget.current = null
                  setLinkDrag(null)
                  setLinkDropId(null)
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                }}
                onPointerCancel={(event) => {
                  suppressLinkClick.current = true
                  linkPointerStart.current = null
                  linkPointerMoved.current = false
                  linkTarget.current = null
                  setLinkDrag(null)
                  setLinkDropId(null)
                  event.currentTarget.releasePointerCapture?.(event.pointerId)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  if (suppressLinkClick.current) {
                    suppressLinkClick.current = false
                    return
                  }
                  setLinkDrag(null)
                  setLinkDropId(null)
                  linkTarget.current = null
                  setLinkMenuOpen((current) => !current)
                  setUnlinkConfirmation(false)
                }}
              ><Link2 size={15} /><small>{hasRelationship ? relationshipGroupCount : ''}</small></button>}
              {linkMenuOpen && !editingDetails && <div className="admin-link-menu" role="menu">
                <header><strong>{t('admin.relationship.menuTitle')}</strong><small>{t('admin.relationship.dragToConnect')}</small></header>
                <button type="button" role="menuitem" onClick={() => { setLinkMenuOpen(false); setLinkMode(activeSelection) }}><Link2 size={13} /><span>{t('admin.relationship.chooseBooking')}</span></button>
                {hasRelationship && <button type="button" role="menuitem" className="danger" onClick={() => { setLinkMenuOpen(false); setUnlinkConfirmation(true) }}><Unlink size={13} /><span>{t('admin.relationship.disconnectCurrent')}</span></button>}
              </div>}
            </div>
            {!editingDetails && linkMode && <div className="admin-link-selecting" role="status"><Link2 size={13} /><span><strong>{t('admin.relationship.chooseTarget')}</strong><small>{t('admin.relationship.chooseTargetHelp')}</small></span><button type="button" onClick={cancelRelationshipMode}><X size={12} /> {t('admin.relationship.cancel')}</button></div>}
            {!editingDetails && linkConfirmation && <div className="admin-link-confirm" role="status" aria-live="polite">
              <span>{t('admin.relationship.confirmTitle')}</span>
              <strong>{linkConfirmation.source.customer_name} <Link2 size={13} /> {linkConfirmation.target.customer_name}</strong>
              <small>{t('admin.relationship.confirmHelp')}</small>
              <div><button type="button" onClick={cancelRelationshipMode}>{t('admin.relationship.cancel')}</button><button type="button" className="confirm" disabled={busy} onClick={confirmRelationship}>{busy ? t('admin.relationship.saving') : t('admin.relationship.confirm')}</button></div>
            </div>}
            {!editingDetails && unlinkConfirmation && <div className="admin-link-confirm danger" role="alert">
              <span>{t('admin.relationship.unlinkConfirmTitle')}</span>
              <strong>{activeSelection.customer_name}</strong>
              <small>{t(relationshipGroupCount > 2 ? 'admin.relationship.unlinkConfirmMany' : 'admin.relationship.unlinkConfirmTwo')}</small>
              <div><button type="button" onClick={() => setUnlinkConfirmation(false)}>{t('admin.relationship.cancel')}</button><button type="button" className="confirm danger" disabled={busy} onClick={unlinkActiveRelationship}>{busy ? t('admin.relationship.saving') : t('admin.relationship.confirmDisconnect')}</button></div>
            </div>}
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
                {activeGroup.length > 1 && <div className={`admin-move-scope-note ${multiCourtMoveTogether ? 'group' : 'single'}`}>
                  <dt>{t('admin.schedule.moveScope')}</dt>
                  <dd>
                    {multiCourtMoveTogether ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                    <span><strong>{t(multiCourtMoveTogether ? 'admin.schedule.moveTogetherOn' : 'admin.schedule.moveTogetherOff')}</strong><small>{t('admin.schedule.moveScopeVenueSetting')}</small></span>
                  </dd>
                </div>}
                <div><dt>{t('admin.schedule.courtTime')}</dt><dd>{(activeGroupSharesSchedule ? activeGroup : [activeSelection]).map((booking) => courtTitle(COURTS.find((court) => court.id === booking.court_id) || COURTS[0])).join(' + ')} · {activeSelection.start_at.slice(0, 10).replaceAll('-', '.')} · {timeFromDateTime(activeSelection.start_at)}–{endTimeFromDateTime(activeSelection.start_at, activeSelection.end_at)}</dd></div>
                {!activeGroupSharesSchedule && <div className="admin-group-schedule"><dt>{t('admin.schedule.groupSchedule')}</dt><dd>{activeGroup.map((booking) => <span key={booking.id}>{courtTitle(COURTS.find((court) => court.id === booking.court_id) || COURTS[0])} · {booking.start_at.slice(0, 10).replaceAll('-', '.')} · {timeFromDateTime(booking.start_at)}–{endTimeFromDateTime(booking.start_at, booking.end_at)}</span>)}</dd></div>}
                <div><dt>{t('admin.schedule.bookedAt')}</dt><dd>{activeSelection.created_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activeSelection.created_at)) : t('admin.schedule.notRecorded')}</dd></div>
                <div><dt>{t('admin.schedule.contact')}</dt><dd>{activeSelection.customer_email || t('admin.schedule.notProvided')} · {activeSelection.customer_phone || t('admin.schedule.notProvided')}</dd></div>
                <div className="admin-booking-status"><dt>{t('admin.schedule.bookingMeta')}</dt><dd className="admin-booking-meta">
                  <span className="admin-party-count"><UsersRound aria-hidden="true" /> {t('admin.people', { count: activeSelection.party_size })}</span>
                  <span className="admin-payment-actions">
                    <label className={`admin-quick-payment ${activeSelection.payment_status === 'paid' ? 'paid' : 'unpaid'}`} title={t(activeSelection.payment_status === 'paid' ? 'admin.schedule.paidEditHint' : 'admin.schedule.quickMarkPaid')}>
                      <input type="checkbox" checked={activeSelection.payment_status === 'paid'} disabled={busy || activeSelection.payment_status === 'paid'} onChange={markSelectionPaid} />
                      <span>{t(activeSelection.payment_status === 'paid' ? 'admin.schedule.paymentPaid' : 'admin.schedule.quickMarkPaid')}</span>
                    </label>
                    {hasRelationship && <button type="button" className={`admin-related-payment ${relationshipAllPaid ? 'paid' : ''}`} disabled={busy || relationshipAllPaid} onClick={markRelationshipPaid}><Check aria-hidden="true" /> <span>{t(relationshipAllPaid ? 'admin.relationship.allPaidTogether' : 'admin.relationship.payAllTogether')}</span></button>}
                  </span>
                </dd></div>
                <div className="admin-price-summary">
                  <dt>{t('admin.relationship.bookingSubtotal')}</dt>
                  <dd>
                    <span><small>{t('admin.relationship.currentBookingPrice')}</small><strong>{formatMoney(groupPrice, locale, currency, true)}</strong></span>
                    {hasRelationship && <span><small>{t('admin.relationship.allLinkedPrice')}</small><strong>{formatMoney(relationship.linked_total, locale, relationship.currency || currency, true)}</strong></span>}
                  </dd>
                </div>
                {activeSelection.recurrence_series_id && <div><dt>{t('admin.schedule.recurrence')}</dt><dd>{t('admin.schedule.recurrenceWeek', { count: activeSelection.recurrence_week })}</dd></div>}
                <div className="notes"><dt>{t('admin.schedule.customerNotes')}</dt><dd>{activeSelection.customer_notes || t('admin.schedule.noNotes')}</dd></div>
              </dl>
            )}
          </>
        ) : (
          <div className="admin-inspector-empty"><strong>{t('admin.schedule.noSelectionTitle')}</strong><span>{t('admin.schedule.noSelectionText')}</span></div>
        )}
      </section>
      {showScheduleContext && <div className={`admin-schedule-context ${draggedBooking && dragPreview ? `dragging ${dragPreview.invalid ? 'invalid' : ''}` : linkDrag ? 'linking' : focusTime ? 'phone-focus' : ''}`}>
        {linkDrag ? (
          <div className="admin-link-readout" role="status" aria-live="polite"><Link2 size={15} /><span>{t('admin.schedule.linkDragHint')}</span><strong>{linkDrag.booking.customer_name}{linkDropId ? ` → ${bookings.find((booking) => booking.id === linkDropId)?.customer_name || ''}` : ''}</strong></div>
        ) : rangeDisplay ? (
          <div className={`admin-drag-readout range-create ${rangeDisplay.invalid ? 'invalid' : ''}`} role="status" aria-live="polite">
            <span>{t('admin.schedule.rangeTitle')}</span>
            <strong><Link2 size={13} /> {t(rangeDisplay.courts.length > 1 ? 'admin.schedule.rangeCourtSummary' : 'admin.schedule.rangeSingleCourt', {
              from: courtTitle(rangeDisplay.courts[0]),
              to: courtTitle(rangeDisplay.courts.at(-1)),
              count: rangeDisplay.courts.length,
            })}</strong>
            <b>{t('admin.schedule.dragStart')} {rangeDisplay.startTime} → {t('admin.schedule.dragEnd')} {rangeDisplay.endTime}</b>
            <small>{t(rangeDisplay.invalid ? 'admin.schedule.rangeBlocked' : 'admin.schedule.rangeRelease')}</small>
          </div>
        ) : draggedBooking && dragPreview ? (
          <div className="admin-drag-readout" role="status" aria-live="polite">
            <span>{t('admin.schedule.preview')}</span>
            <strong>{draggedBooking.customer_name}</strong>
            <b>{dateKey.replaceAll('-', '.')} · {courtTitle(dragPreview.court)} · {t('admin.schedule.dragStart')} {dragPreview.time} → {t('admin.schedule.dragEnd')} {dragPreview.endTime}</b>
            <small><em>{t(pointerDrag?.moveScope === BOOKING_MOVE_SCOPE_GROUP ? 'admin.schedule.moveScopeActiveGroup' : 'admin.schedule.moveScopeActiveSingle')} · {t('admin.schedule.dragLockActive', { mode: t(dragLockLabelKey) })}</em>{t(dragPreview.invalid ? (dragPreview.invalidReason === 'past' ? 'admin.schedule.pastDropBlocked' : 'admin.schedule.swapBlocked') : dragPreview.swap?.mode === 'swap' ? 'admin.schedule.releaseToSwap' : 'admin.schedule.releaseToMove', { count: dragPreview.swap?.bookings?.length || 0 })}</small>
          </div>
        ) : focusTime ? (
          <div className="admin-phone-focus-guide" role="status" aria-live="polite">
            <PhoneCall size={15} />
            <strong>{t('admin.schedule.phoneFocusTitle')}</strong>
            <span>{t('admin.schedule.phoneFocusText', { date: dateKey.replaceAll('-', '.'), time: focusTime })}</span>
            <button onClick={onClearFocus}><X size={13} /> {t('admin.schedule.clearPhoneFocus')}</button>
          </div>
        ) : null}
      </div>}
      <div className="admin-schedule-workbench">
        <aside className="admin-schedule-side admin-schedule-side-left">
          <div className="admin-schedule-day-strip" aria-label={t('admin.schedule.quickDays')}>
            <ScheduleDatePicker dateKey={dateKey} dayLabel={dayLabel} locale={locale} todayKey={nowAtVenue.dateKey} onSelect={selectDate} t={t} />
            <button className="today-nav" onClick={() => selectDate(nowAtVenue.dateKey)} aria-label={t('admin.schedule.goToday')}><CalendarDays size={15} /><small>{t('admin.today')}</small></button>
            <button className="week-nav" onClick={() => moveWeek(-1)} aria-label={t('admin.schedule.previousWeek')}><ChevronLeft size={18} /><small>{t('admin.schedule.previousWeekShort')}</small></button>
            {quickDays.map((day) => (
              <button
                className={`${dateKey === day.key ? 'active' : ''} ${day.key < nowAtVenue.dateKey ? 'past' : ''} ${dragDay === day.key ? 'drop-target' : ''}`}
                data-transfer-date={dragLockMode === DRAG_LOCK_FREE && (day.key >= nowAtVenue.dateKey || historicalDragCanUsePastDates) ? day.key : undefined}
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
          {COURTS.map((court) => {
            const rangeCourtPosition = rangeSelection?.courts.findIndex((selectedCourt) => selectedCourt.id === court.id) ?? -1
            const rangeSegment = rangeCourtPosition < 0
              ? ''
              : rangeSelection.courts.length === 1
                ? 'single'
                : rangeCourtPosition === 0
                  ? 'start'
                  : rangeCourtPosition === rangeSelection.courts.length - 1
                    ? 'end'
                    : 'middle'
            return (
            <div
              className={`admin-schedule-lane ${court.tone} ${dragPreview?.court.id === court.id ? 'previewing' : ''} ${rangeCourtPosition >= 0 ? 'range-selecting' : ''}`}
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
                  onClick={() => {
                    if (suppressSlotClick.current) {
                      suppressSlotClick.current = false
                      return
                    }
                    if (!rangeDraft) chooseSlot(court, time)
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || busy || activeSelection) return
                    event.preventDefault()
                    onClearFocus?.()
                    window.clearTimeout(rangeFeedbackTimer.current)
                    setRangeFeedback(null)
                    const courtIndex = COURTS.findIndex((item) => item.id === court.id)
                    const nextRange = {
                      dragging: false,
                      court,
                      startCourtIndex: courtIndex,
                      currentCourtIndex: courtIndex,
                      startIndex: index,
                      currentIndex: index,
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                    }
                    rangeTarget.current = nextRange
                    setRangeDraft(nextRange)
                  }}
                  aria-label={t('admin.schedule.emptySlot', { court: courtTitle(court), time })}
                />
                )
              })}
              {rangeDraft?.dragging && rangeCourtPosition >= 0 && <div
                className={`admin-range-preview ${rangeSelection.invalid ? 'invalid' : ''} ${rangeSelection.duration <= slotMinutes ? 'compact' : ''} ${rangeSelection.courts.length > 1 ? 'multi' : ''} segment-${rangeSegment}`}
                style={{ '--start': rangeSelection.startIndex, '--span': rangeSelection.endIndex - rangeSelection.startIndex }}
                aria-hidden="true"
              >
                {rangeCourtPosition === 0 && <><strong>{rangeSelection.startTime}–{rangeSelection.endTime}</strong><span>{t('admin.schedule.rangeCourtCount', { count: rangeSelection.courts.length })}</span></>}
              </div>}
              {draggedBooking && dragPreview?.court.id === court.id && (
                <div
                  className={`admin-schedule-drop-preview ${dragPreview.span <= 1 ? 'compact' : ''} ${dragPreview.invalid ? 'invalid' : ''} ${dragPreview.swap?.mode === 'swap' ? 'swap' : ''}`}
                  style={{
                    '--start': dragPreview.index,
                    '--span': dragPreview.span,
                    '--customer-color-start': draggedCustomerColor?.start,
                    '--customer-color-end': draggedCustomerColor?.end,
                    '--customer-color-ink': draggedCustomerColor?.foreground,
                    '--customer-text-shadow': draggedCustomerColor?.textShadow,
                  }}
                  aria-hidden="true"
                >
                  <div className="admin-drop-preview-customer"><GripVertical size={13} /><strong>{draggedBooking.customer_name}</strong></div>
                  <span className="admin-drop-preview-time">{dragPreview.time}–{dragPreview.endTime}</span>
                  <small>{t(dragPreview.invalid ? (dragPreview.invalidReason === 'past' ? 'admin.schedule.pastDropBlockedShort' : 'admin.schedule.swapBlockedShort') : dragPreview.swap?.mode === 'swap' ? 'admin.schedule.swapHere' : 'admin.schedule.dropHere', { count: dragPreview.swap?.bookings?.length || 0 })}</small>
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
                const groupSize = activeBookingGroupSize(bookings, booking)
                const resizeAffectsCurrentBooking = resizeAppliesToBooking(resizeDrag, booking)
                const minutes = resizeAffectsCurrentBooking ? resizeDrag.duration : durationMinutes(booking)
                const bookingPhase = bookingPhaseAtVenue(booking, nowAtVenue)
                const historicalEditable = !historyLocked && bookingPhase !== 'future'
                const canMove = bookingPhase === 'future' || historicalEditable
                const nowSeconds = Number(nowAtVenue.dateTime.slice(17, 19))
                const minimumEndMinutes = Math.ceil((nowAtVenue.minutes + (nowSeconds > 0 ? 1 / 60 : 0)) / slotMinutes) * slotMinutes
                const minimumResizeDuration = bookingPhase === 'in-progress' && !historicalEditable ? Math.max(minimumBookingDuration, minimumEndMinutes - startMinutes) : minimumBookingDuration
                const maximumResizeDuration = Math.min(managerMaxMinutes, closeMinutes - startMinutes)
                const canResize = (bookingPhase !== 'ended' || historicalEditable) && minimumResizeDuration <= maximumResizeDuration
                const hasBusinessLink = Boolean(booking.booking_link_id)
                const linkedGroupCount = relationship?.booking_link_id === booking.booking_link_id
                  ? Number(relationship.group_count || 0)
                  : hasBusinessLink ? new Set(dayBookings.filter((item) => item.booking_link_id === booking.booking_link_id).map((item) => item.booking_group_id || item.id)).size : 0
                const hasMultiCourtGroup = groupSize > 1
                const indicatorCount = Number(hasBusinessLink || hasMultiCourtGroup) + Number(Boolean(booking.recurrence_series_id))
                const isRelationshipSource = linkMode?.id === booking.id || linkDrag?.booking.id === booking.id
                const isRelationshipTarget = Boolean((linkMode && canLinkBookings(linkMode, booking)) || linkDropId === booking.id)
                const isLinkedContext = Boolean(activeSelection?.booking_link_id && activeSelection.booking_link_id === booking.booking_link_id && activeSelection.id !== booking.id)
                const customerColor = customerColorForBooking(booking, customerColorMap, bookingColorScheme)
                return (
                  <article
                    className={`admin-schedule-booking ${bookingPhase} ${minutes <= 60 ? 'short' : ''} ${minutes === 30 ? 'half-hour' : ''} ${indicatorCount ? 'has-indicators' : ''} ${indicatorCount > 1 ? 'has-two-indicators' : ''} ${draggedId === booking.id ? 'dragging' : ''} ${draggedId === booking.id && dragPreview?.invalid ? 'invalid-target' : ''} ${isRelationshipSource ? 'relationship-source' : ''} ${isRelationshipTarget ? 'relationship-target' : ''} ${isLinkedContext ? 'linked-context' : ''} ${selectedBooking?.id === booking.id ? 'selected' : ''}`}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    role="button"
                    tabIndex="0"
                    aria-pressed={activeSelection?.id === booking.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (pointerMoved.current) { pointerMoved.current = false; return }
                      event.currentTarget.blur()
                      if (linkMode) {
                        if (canLinkBookings(linkMode, booking)) {
                          setLinkConfirmation({ source: linkMode, target: booking })
                          setLinkMode(null)
                        }
                        return
                      }
                      setSelectedBooking((current) => current?.id === booking.id ? null : booking)
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (linkMode) { if (canLinkBookings(linkMode, booking)) { setLinkConfirmation({ source: linkMode, target: booking }); setLinkMode(null) } } else setSelectedBooking((current) => current?.id === booking.id ? null : booking) } }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || busy || !canMove || linkMode) return
                      event.preventDefault()
                      window.getSelection()?.removeAllRanges()
                      event.currentTarget.setPointerCapture?.(event.pointerId)
                      const grabOffset = event.clientY - event.currentTarget.getBoundingClientRect().top
                      const moveScope = bookingMoveScope({
                        booking,
                        groupSize,
                        selectedBookingId: activeSelection?.id,
                        moveTogether: multiCourtMoveTogether,
                      })
                      pointerMoved.current = false
                      pointerTarget.current = null
                      setSelectedBooking(null)
                      setPointerDrag({ booking, grabOffset, startX: event.clientX, startY: event.clientY, moveScope })
                    }}
                    style={{ '--start': offset / slotMinutes, '--span': minutes / slotMinutes, '--customer-color-start': customerColor.start, '--customer-color-end': customerColor.end, '--customer-color-ink': customerColor.foreground, '--customer-text-shadow': customerColor.textShadow }}
                    data-customer-color={customerColor.index}
                    data-booking-id={booking.id}
                    data-origin-label={draggedId === booking.id ? `${t('admin.schedule.originPosition')} · ${timeFromDateTime(booking.start_at)}–${endTimeFromDateTime(booking.start_at, booking.end_at)}` : undefined}
                    key={booking.id}
                    title={linkMode ? t(isRelationshipTarget ? 'admin.relationship.chooseThisTarget' : 'admin.relationship.invalidTarget') : t(canMove ? 'admin.schedule.dragTitle' : bookingPhase === 'in-progress' ? 'admin.schedule.inProgressResizeTitle' : 'admin.schedule.endedReadOnly', { name: booking.customer_name })}
                  >
                    {linkMode && isRelationshipTarget && <span className="admin-relationship-target-action"><Plus size={11} /> {t('admin.relationship.choose')}</span>}
                    {canMove ? <GripVertical size={14} /> : <Clock3 className="admin-booking-state-icon" size={14} />}
                    <div>
                      <strong>{booking.customer_name}</strong>
                      <span>{timeFromDateTime(booking.start_at)}–{resizeAffectsCurrentBooking ? timeFromMinutes(startMinutes + minutes) : endTimeFromDateTime(booking.start_at, booking.end_at)}</span>
                      <span className="admin-booking-tags">
                        <small className={`admin-booking-payment ${booking.payment_status === 'paid' ? 'paid' : 'unpaid'}`}>{t(booking.payment_status === 'paid' ? 'admin.schedule.paymentPaid' : 'admin.schedule.paymentUnpaid')}</small>
                        {booking.customer_notes?.trim() && <small className="admin-booking-note" title={booking.customer_notes}><MessageSquareText size={8} /> {t('admin.schedule.hasNote')}</small>}
                      </span>
                    </div>
                    {indicatorCount > 0 && <span className="admin-booking-indicators">
                      {hasBusinessLink ? <span className="admin-booking-indicator is-link" title={t('admin.schedule.businessLinked', { count: linkedGroupCount })}><Link2 size={11} /><small>{linkedGroupCount || '·'}</small></span> : hasMultiCourtGroup && <span className="admin-booking-indicator is-group" title={t('admin.schedule.multiCourtLinked', { count: groupSize })}><Layers3 size={11} /></span>}
                      {booking.recurrence_series_id && <span className="admin-booking-indicator" title={t('admin.schedule.recurrenceCard', { count: booking.recurrence_week })}><Repeat2 size={12} /></span>}
                    </span>}
                    {canResize && <button className="admin-resize-handle" aria-label={t('admin.schedule.resize')} title={t('admin.schedule.resize')} onPointerDown={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      event.preventDefault()
                      setResizeDrag({
                        booking,
                        startY: event.clientY,
                        initialDuration: durationMinutes(booking),
                        duration: durationMinutes(booking),
                        minimumDuration: minimumResizeDuration,
                        moveScope: bookingMoveScope({
                          booking,
                          groupSize,
                          selectedBookingId: activeSelection?.id,
                          moveTogether: multiCourtMoveTogether,
                        }),
                      })
                    }} />}
                  </article>
                )
              })}
            </div>
            )
          })}
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
            <AdminAuditQuickPanel operations={auditOperations} loading={auditLoading} onOpen={openAudit} onViewAll={onViewAuditLog} />
          )}
        </aside>
      </div>
      <AdminAuditDrawer
        open={auditOpen}
        operations={auditOperations}
        loading={auditLoading}
        revertingId={auditRevertingId}
        focusOperationId={auditFocusId}
        onClose={() => { setAuditOpen(false); setAuditFocusId(null) }}
        onRevert={onRevertAudit}
      />
      {draft && <NewBookingModal draft={draft} busy={busy} configuration={configuration} onPreviewPrice={onPreviewPrice} onClose={() => setDraft(null)} onSubmit={async (details) => { const result = await onCreate(details); if (result?.saved) setDraft(null); return result }} />}
    </section>
  )
}
