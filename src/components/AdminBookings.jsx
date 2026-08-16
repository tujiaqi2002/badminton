import { useEffect, useMemo, useState } from 'react'
import {
  CalendarRange,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { addDays, COURTS, formatMoney, mondayOfWeek, timeFromDateTime, toDateKey, venueNow } from '../lib/booking'
import { useI18n } from '../lib/i18n'
import AdminSchedule from './AdminSchedule'
import AdminRescheduleModal from './AdminRescheduleModal'

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

export default function AdminBookings({
  bookings,
  events,
  loading,
  orderBookings,
  orderSummary,
  orderFilters,
  onOrderFiltersChange,
  orderPagination,
  onPreviousOrderPage,
  onNextOrderPage,
  loadingOrders,
  startDate,
  endDate,
  onRangeChange,
  onCancel,
  cancellingId,
  scheduleBusy,
  onCreate,
  onPreviewPrice,
  onReschedule,
  onRescheduleGroup,
  onSwap,
  onUndo,
  undoDepth,
  onUpdateDetails,
  auditOperations,
  auditLoading,
  auditRevertingId,
  onOpenAudit,
  onRevertAudit,
  focusTarget,
  onClearFocus,
  configuration,
  onScheduleDateChange,
}) {
  const { courtName, courtTitle, locale, t } = useI18n()
  const currency = configuration?.settings?.currency || 'CAD'
  const [query, setQuery] = useState(orderFilters.query)
  const [editingBooking, setEditingBooking] = useState(null)
  const [focusTime, setFocusTime] = useState(null)
  // The report range starts on Monday, but the live editor should open on today.
  // Keeping these as separate concepts also lets managers browse historical weeks
  // without changing the editor's initial landing date back to a past Monday.
  const [scheduleDate, setScheduleDate] = useState(() => venueNow().dateKey)

  useEffect(() => {
    setQuery(orderFilters.query)
  }, [orderFilters.query])

  useEffect(() => {
    if (query === orderFilters.query) return undefined
    const timeout = window.setTimeout(() => {
      onOrderFiltersChange((current) => ({ ...current, query }))
    }, 280)
    return () => window.clearTimeout(timeout)
  }, [onOrderFiltersChange, orderFilters.query, query])

  useEffect(() => {
    if (!focusTarget) return
    setScheduleDate(focusTarget.date)
    onScheduleDateChange?.(focusTarget.date)
    setFocusTime(focusTarget.time)
    window.setTimeout(() => document.querySelector('.admin-schedule-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }, [focusTarget, onScheduleDateChange])

  const clearScheduleFocus = () => {
    setFocusTime(null)
    onClearFocus?.()
  }

  useEffect(() => {
    const undo = (event) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      event.preventDefault()
      if (!scheduleBusy && undoDepth > 0) onUndo()
    }
    window.addEventListener('keydown', undo)
    return () => window.removeEventListener('keydown', undo)
  }, [onUndo, scheduleBusy, undoDepth])

  const applyPreset = (days) => {
    const today = venueNow().dateKey
    onOrderFiltersChange((current) => ({
      ...current,
      start: today,
      end: toDateKey(addDays(new Date(`${today}T12:00:00`), days - 1)),
    }))
  }

  const filteredBookings = orderBookings

  const groupedBookings = useMemo(() => filteredBookings.reduce((groups, booking) => {
    const date = booking.start_at.slice(0, 10)
    if (!groups[date]) groups[date] = []
    groups[date].push(booking)
    return groups
  }, {}), [filteredBookings])

  const totalHours = (orderSummary.total_minutes || 0) / 60
  const uniqueCustomers = orderSummary.customers || 0
  const todayCount = orderSummary.today || 0
  const resultCount = orderSummary.results || 0
  const totalPages = Math.max(1, Math.ceil(resultCount / 50))
  const firstResult = resultCount === 0 ? 0 : (orderPagination.page - 1) * 50 + 1
  const lastResult = Math.min((orderPagination.page - 1) * 50 + filteredBookings.length, resultCount)
  const formatDuration = (minutes) => minutes % 60 === 0
    ? t('duration.hours', { hours: minutes / 60 })
    : t('duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  const formatDay = (dateKey) => new Intl.DateTimeFormat(locale, {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date(`${dateKey}T12:00:00`))

  return (
    <main className="admin-bookings-page" aria-busy={loading || loadingOrders || scheduleBusy}>
      <AdminSchedule
        bookings={bookings}
        events={events}
        initialDate={scheduleDate}
        busy={scheduleBusy}
        onCreate={onCreate}
        onPreviewPrice={onPreviewPrice}
        onReschedule={onReschedule}
        onRescheduleGroup={onRescheduleGroup}
        onSwap={onSwap}
        onUpdateDetails={onUpdateDetails}
        onCancel={onCancel}
        auditOperations={auditOperations}
        auditLoading={auditLoading}
        auditRevertingId={auditRevertingId}
        onOpenAudit={onOpenAudit}
        onRevertAudit={onRevertAudit}
        focusTime={focusTime}
        onClearFocus={clearScheduleFocus}
        configuration={configuration}
        onDateChange={(date) => {
          setScheduleDate(date)
          onScheduleDateChange?.(date)
          if (focusTarget && date !== focusTarget.date) clearScheduleFocus()
          if (date < startDate || date > endDate) {
            const weekStart = mondayOfWeek(date)
            onRangeChange({ start: weekStart, end: toDateKey(addDays(new Date(`${weekStart}T12:00:00`), 6)) })
          }
        }}
      />

      <section className="admin-summary" aria-label={t('admin.summaryAria')}>
        <article><span>{t('admin.results')}</span><strong>{resultCount}</strong><small>{t('admin.bookingUnit')}</small></article>
        <article><span>{t('admin.totalDuration')}</span><strong>{Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1)}</strong><small>{t('admin.hoursUnit')}</small></article>
        <article><span>{t('admin.customers')}</span><strong>{uniqueCustomers}</strong><small>{t('admin.customerUnit')}</small></article>
        <article><span>{t('admin.today')}</span><strong>{todayCount}</strong><small>{t('admin.sessionUnit')}</small></article>
      </section>

      <section className="admin-controls" aria-label={t('admin.filterAria')}>
        <div className="admin-presets">
          <button onClick={() => applyPreset(1)}>{t('admin.today')}</button>
          <button onClick={() => applyPreset(7)}>{t('admin.next7')}</button>
          <button onClick={() => applyPreset(30)}>{t('admin.next30')}</button>
        </div>
        <label className="admin-date-field">
          <span>{t('admin.from')}</span>
          <input type="date" value={orderFilters.start} max={orderFilters.end} onChange={(event) => onOrderFiltersChange((current) => ({ ...current, start: event.target.value }))} />
        </label>
        <label className="admin-date-field">
          <span>{t('admin.to')}</span>
          <input type="date" value={orderFilters.end} min={orderFilters.start} onChange={(event) => onOrderFiltersChange((current) => ({ ...current, end: event.target.value }))} />
        </label>
        <label className="admin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('admin.search')} />
        </label>
        <label className="admin-filter-select">
          <span>{t('admin.bookingStatus')}</span>
          <select value={orderFilters.bookingStatus} onChange={(event) => onOrderFiltersChange((current) => ({ ...current, bookingStatus: event.target.value }))} aria-label={t('admin.statusAria')}>
            <option value="not_cancelled">{t('admin.notCancelled')}</option>
            <option value="confirmed">{t('status.confirmed')}</option>
            <option value="held">{t('status.held')}</option>
            <option value="completed">{t('status.completed')}</option>
            <option value="no_show">{t('status.no_show')}</option>
            <option value="expired">{t('status.expired')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
            <option value="all">{t('admin.allStatuses')}</option>
          </select>
        </label>
        <label className="admin-filter-select">
          <span>{t('admin.paymentStatus')}</span>
          <select value={orderFilters.paymentStatus} onChange={(event) => onOrderFiltersChange((current) => ({ ...current, paymentStatus: event.target.value }))} aria-label={t('admin.paymentStatusAria')}>
            <option value="all">{t('admin.allPayments')}</option>
            <option value="unpaid">{t('admin.unpaid')}</option>
            <option value="paid">{t('payment.paid')}</option>
            <option value="pay_at_venue">{t('payment.pay_at_venue')}</option>
            <option value="pending">{t('payment.pending')}</option>
            <option value="refunded">{t('payment.refunded')}</option>
            <option value="failed">{t('payment.failed')}</option>
          </select>
        </label>
      </section>

      <div className="admin-query-meta" aria-live="polite">
        <span>{t('admin.showingPage', { from: firstResult, to: lastResult, total: resultCount })}</span>
        <button type="button" onClick={() => { const today = venueNow().dateKey; setQuery(''); onOrderFiltersChange({ start: today, end: today, query: '', bookingStatus: 'not_cancelled', paymentStatus: 'all' }) }}>{t('admin.resetFilters')}</button>
      </div>

      {editingBooking && (
        <AdminRescheduleModal
          booking={editingBooking}
          busy={scheduleBusy}
          onClose={() => setEditingBooking(null)}
          onSubmit={onReschedule}
          configuration={configuration}
          onMoved={(date, bookingId) => {
            setEditingBooking(null)
            setQuery('')
            onOrderFiltersChange({ start: date, end: date, query: '', bookingStatus: 'not_cancelled', paymentStatus: 'all' })
            onRangeChange({ start: date, end: date })
            window.setTimeout(() => document.querySelector(`[data-booking-id="${bookingId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 450)
          }}
        />
      )}

      {loadingOrders ? (
        <div className="board-loading"><RefreshCw className="spin" /> {t('admin.loading')}</div>
      ) : filteredBookings.length === 0 ? (
        <div className="admin-empty">
          <CalendarRange size={30} />
          <h2>{t('admin.emptyTitle')}</h2>
          <p>{t('admin.emptyText')}</p>
        </div>
      ) : (
        <div className="admin-day-list">
          {Object.entries(groupedBookings).map(([date, dayBookings]) => (
            <section className="admin-day" key={date}>
              <header>
                <div><strong>{formatDay(date)}</strong><span>{date.replaceAll('-', '.')}</span></div>
                <span>{t('admin.sessions', { count: dayBookings.length })}</span>
              </header>
              <div className="admin-booking-list">
                {dayBookings.map((booking) => {
                  const court = COURTS.find((item) => item.id === booking.court_id) || COURTS[0]
                  const minutes = durationMinutes(booking)
                  return (
                    <article className="admin-booking-row" data-booking-id={booking.id} key={booking.id}>
                      <div className="admin-booking-time">
                        <Clock3 size={16} />
                        <strong>{timeFromDateTime(booking.start_at)}</strong>
                        <span>— {timeFromDateTime(booking.end_at)}</span>
                        <small>{formatDuration(minutes)}</small>
                      </div>
                      <div className="admin-booking-court">
                        <span className={`admin-court-seal ${court.tone}`}>{court.name}</span>
                        <div><strong>{courtTitle(court)}</strong><small>{courtName(court)}</small></div>
                      </div>
                      <div className="admin-customer">
                        <UserRound size={17} />
                        <div><strong>{booking.customer_name}</strong><span><Mail size={12} />{booking.customer_email || booking.customer_phone || t('admin.schedule.notProvided')}</span></div>
                      </div>
                      <div className="admin-booking-details">
                        <span className={`status-pill ${booking.status}`}>{t(`status.${booking.status}`)}</span>
                        <span><UsersRound size={14} /> {t('admin.people', { count: booking.party_size })}</span>
                        <span>{t(`payment.${booking.payment_status}`)}</span>
                        <strong>{formatMoney(booking.total_amount || 0, locale, currency)}</strong>
                        {['held', 'confirmed'].includes(booking.status) && (
                          <div className="admin-booking-actions">
                            <button
                              className="admin-reschedule-booking"
                              onClick={() => setEditingBooking(booking)}
                              disabled={scheduleBusy || Boolean(cancellingId)}
                            >
                              <CalendarClock size={13} /> {t('admin.reschedule')}
                            </button>
                            <button
                              className="admin-cancel-booking"
                              onClick={() => onCancel(booking)}
                              disabled={Boolean(cancellingId)}
                            >
                              {cancellingId === booking.id
                                ? <><RefreshCw size={13} className="spin" /> {t('admin.cancelling')}</>
                                : <><Trash2 size={13} /> {t('admin.cancel')}</>}
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
          <nav className="admin-order-pagination" aria-label={t('admin.paginationAria')}>
            <button type="button" onClick={onPreviousOrderPage} disabled={loadingOrders || orderPagination.page <= 1}>
              <ChevronLeft size={15} /> {t('admin.previousPage')}
            </button>
            <div>
              <strong>{t('admin.pageStatus', { page: orderPagination.page, pages: totalPages })}</strong>
              <span>{t('admin.pageSize')}</span>
            </div>
            <button type="button" onClick={onNextOrderPage} disabled={loadingOrders || !orderPagination.hasMore}>
              {t('admin.nextPage')} <ChevronRight size={15} />
            </button>
          </nav>
        </div>
      )}
    </main>
  )
}
