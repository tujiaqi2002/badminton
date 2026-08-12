import { useMemo, useState } from 'react'
import {
  CalendarRange,
  CalendarClock,
  Clock3,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { addDays, COURTS, formatMoney, timeFromDateTime, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'
import AdminSchedule from './AdminSchedule'
import AdminRescheduleModal from './AdminRescheduleModal'

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

export default function AdminBookings({
  bookings,
  loading,
  startDate,
  endDate,
  onRangeChange,
  onRefresh,
  onCancel,
  cancellingId,
  scheduleBusy,
  onCreate,
  onReschedule,
  onRescheduleGroup,
  onUndo,
  onUpdateDetails,
}) {
  const { courtName, courtTitle, locale, t } = useI18n()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [editingBooking, setEditingBooking] = useState(null)

  const applyPreset = (days) => {
    const today = new Date()
    onRangeChange({ start: toDateKey(today), end: toDateKey(addDays(today, days - 1)) })
  }

  const filteredBookings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return bookings.filter((booking) => {
      const matchesQuery = !normalizedQuery || [
        booking.customer_name,
        booking.customer_email,
        booking.customer_phone,
        booking.customer_notes,
        COURTS.find((court) => court.id === booking.court_id)?.name,
        COURTS.find((court) => court.id === booking.court_id)?.english,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery))
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && ['held', 'confirmed'].includes(booking.status))
        || booking.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [bookings, query, statusFilter])

  const groupedBookings = useMemo(() => filteredBookings.reduce((groups, booking) => {
    const date = booking.start_at.slice(0, 10)
    if (!groups[date]) groups[date] = []
    groups[date].push(booking)
    return groups
  }, {}), [filteredBookings])

  const totalHours = filteredBookings.reduce((sum, booking) => sum + durationMinutes(booking), 0) / 60
  const uniqueCustomers = new Set(filteredBookings.map((booking) => booking.customer_email || booking.customer_phone || booking.customer_name)).size
  const todayCount = filteredBookings.filter((booking) => booking.start_at.startsWith(toDateKey(new Date()))).length
  const formatDuration = (minutes) => minutes % 60 === 0
    ? t('duration.hours', { hours: minutes / 60 })
    : t('duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  const formatDay = (dateKey) => new Intl.DateTimeFormat(locale, {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date(`${dateKey}T12:00:00`))

  return (
    <main className="admin-bookings-page">
      <div className="admin-heading">
        <div>
          <span className="eyebrow"><ShieldCheck size={13} /> {t('admin.eyebrow')}</span>
          <h1>{t('admin.title')}</h1>
          <p>{t('admin.description')}</p>
        </div>
        <button className="outline-button admin-refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> {t('admin.refresh')}
        </button>
      </div>

      <section className="admin-summary" aria-label={t('admin.summaryAria')}>
        <article><span>{t('admin.results')}</span><strong>{filteredBookings.length}</strong><small>{t('admin.bookingUnit')}</small></article>
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
          <input type="date" value={startDate} max={endDate} onChange={(event) => onRangeChange({ start: event.target.value, end: endDate })} />
        </label>
        <label className="admin-date-field">
          <span>{t('admin.to')}</span>
          <input type="date" value={endDate} min={startDate} onChange={(event) => onRangeChange({ start: startDate, end: event.target.value })} />
        </label>
        <label className="admin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('admin.search')} />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={t('admin.statusAria')}>
          <option value="active">{t('admin.active')}</option>
          <option value="all">{t('admin.allStatuses')}</option>
          <option value="confirmed">{t('status.confirmed')}</option>
          <option value="held">{t('status.held')}</option>
          <option value="cancelled">{t('status.cancelled')}</option>
          <option value="completed">{t('status.completed')}</option>
        </select>
      </section>

      <AdminSchedule
        bookings={bookings}
        initialDate={startDate}
        busy={scheduleBusy}
        onCreate={onCreate}
        onReschedule={onReschedule}
        onRescheduleGroup={onRescheduleGroup}
        onUndo={onUndo}
        onUpdateDetails={onUpdateDetails}
        onCancel={onCancel}
        onDateChange={(date) => {
          if (date < startDate || date > endDate) onRangeChange({ start: date, end: date })
        }}
      />

      {editingBooking && (
        <AdminRescheduleModal
          booking={editingBooking}
          busy={scheduleBusy}
          onClose={() => setEditingBooking(null)}
          onSubmit={onReschedule}
          onMoved={(date, bookingId) => {
            setEditingBooking(null)
            onRangeChange({ start: date, end: date })
            window.setTimeout(() => document.querySelector(`[data-booking-id="${bookingId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
          }}
        />
      )}

      {loading ? (
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
                        <strong>{formatMoney(booking.total_amount || 0, locale)}</strong>
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
        </div>
      )}
    </main>
  )
}
