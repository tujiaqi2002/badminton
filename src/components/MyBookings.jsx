import { useMemo } from 'react'
import { CalendarDays, CalendarX2, Clock3, MapPin, ReceiptText } from 'lucide-react'
import { COURTS, formatMoney, timeFromDateTime } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

const groupIdentity = (booking) => [
  booking.booking_group_id || booking.id,
  booking.start_at,
  booking.end_at,
].join('|')

const uniqueValues = (items, getValue) => [...new Set(items.map(getValue))]

export default function MyBookings({ user, bookings, loading, onLogin, onCancel, configuration }) {
  const { courtName, courtTitle, language, locale, t } = useI18n()
  const cancellationHours = Number(configuration?.settings?.cancellation_notice_hours ?? 12)
  const currency = configuration?.settings?.currency || 'CAD'
  const venueName = configuration?.settings?.[language === 'zh' ? 'name_zh' : 'name_en'] || t('venue.name')
  const groupedBookings = useMemo(() => {
    const groups = []
    const byKey = new Map()
    bookings.forEach((booking) => {
      const key = groupIdentity(booking)
      if (!byKey.has(key)) {
        const group = { key, representative: booking, bookings: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).bookings.push(booking)
    })
    return groups.map((group) => {
      const courts = group.bookings
        .map((booking) => COURTS.find((item) => item.id === booking.court_id) || COURTS[0])
        .filter((court, index, list) => list.findIndex((item) => item.id === court.id) === index)
        .sort((left, right) => COURTS.findIndex((item) => item.id === left.id) - COURTS.findIndex((item) => item.id === right.id))
      return {
        ...group,
        courts,
        status: uniqueValues(group.bookings, (booking) => booking.status).length === 1 ? group.bookings[0].status : 'mixed',
        paymentStatus: uniqueValues(group.bookings, (booking) => booking.payment_status || 'pending').length === 1 ? group.bookings[0].payment_status || 'pending' : 'mixed',
        totalAmount: group.bookings.reduce((total, booking) => total + Number(booking.total_amount || 0), 0),
      }
    })
  }, [bookings])
  const formatBookingDate = (dateTime) => {
    const dateKey = dateTime.slice(0, 10)
    const date = new Date(`${dateKey}T12:00:00`)
    return {
      day: new Intl.DateTimeFormat(locale, { day: '2-digit' }).format(date),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      full: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date),
      numeric: dateKey.replaceAll('-', '.'),
    }
  }
  const formatCreatedAt = (dateTime) => {
    if (!dateTime) return t('my.notAvailable')
    const parsed = new Date(dateTime)
    if (Number.isNaN(parsed.getTime())) return t('my.notAvailable')
    return new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(parsed)
  }
  const canCancelBooking = (booking) => ['confirmed', 'held'].includes(booking.status)
    && new Date(booking.start_at).getTime() > Date.now() + cancellationHours * 60 * 60 * 1000
  const formatDuration = (minutes) => minutes < 60
    ? t('duration.minutes', { minutes })
    : minutes % 60 === 0
      ? t('duration.hours', { hours: minutes / 60 })
      : t('duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })

  if (!user) {
    return (
      <main className="empty-page">
        <div className="empty-ink">予</div>
        <span className="eyebrow">{t('my.eyebrow')}</span>
        <h1>{t('my.loginTitle')}</h1>
        <p>{t('my.loginText')}</p>
        <button className="primary-button" onClick={onLogin}>{t('account.login')}</button>
      </main>
    )
  }

  return (
    <main className="my-bookings-page">
      <div className="page-heading">
        <span className="eyebrow">My bookings</span>
        <h1>{t('my.title')}</h1>
        <p>{t('my.description')}</p>
      </div>
      {loading ? <div className="board-loading">{t('my.loading')}</div> : bookings.length === 0 ? (
        <div className="bookings-empty"><CalendarX2 size={30} /><h2>{t('my.emptyTitle')}</h2><p>{t('my.emptyText')}</p></div>
      ) : (
        <div className="booking-list">
          {groupedBookings.map((group) => {
            const booking = group.representative
            const primaryCourt = group.courts[0] || COURTS[0]
            const isMultiCourt = group.bookings.length > 1
            const cancellableBookings = group.bookings.filter(canCancelBooking)
            const date = formatBookingDate(booking.start_at)
            const minutes = durationMinutes(booking)
            return (
              <article className={`booking-card is-${group.status} ${isMultiCourt ? 'is-multi-court' : ''}`} key={group.key}>
                <div className="booking-card-date" aria-label={date.full}>
                  <span>{date.month}</span>
                  <strong>{date.day}</strong>
                  <small>{date.weekday}</small>
                </div>
                <div className="booking-card-main">
                  <div className="booking-card-title">
                    <div>
                      <small>{t('my.bookingLabel')} · {date.numeric}</small>
                      <h2>{timeFromDateTime(booking.start_at)}—{timeFromDateTime(booking.end_at)}</h2>
                    </div>
                    <div className="booking-card-badges">
                      {isMultiCourt && <span className="multi-court-pill">{t('my.multiCourtLabel')}</span>}
                      <span className={`status-pill ${group.status}`}>{t(`status.${group.status}`)}</span>
                      <span className={`payment-pill ${group.paymentStatus}`}>{t(`payment.${group.paymentStatus}`)}</span>
                    </div>
                  </div>
                  <div className="booking-meta">
                    {isMultiCourt ? (
                      <span className="booking-court-chip multi-court">
                        <span className="booking-court-stack">{group.courts.map((court) => <strong className={court.tone} key={court.id}>{court.name}</strong>)}</span>
                        <span>{t('my.multiCourtCount', { count: group.courts.length })}</span>
                      </span>
                    ) : (
                      <span className={`booking-court-chip ${primaryCourt.tone}`}><strong>{primaryCourt.name}</strong><span>{courtTitle(primaryCourt)}</span></span>
                    )}
                    <span><CalendarDays size={15} /><span><small>{t('my.date')}</small><strong>{date.full}</strong></span></span>
                    <span><Clock3 size={15} /><span><small>{t('my.duration')}</small><strong>{formatDuration(minutes)}</strong></span></span>
                    <span><MapPin size={15} /><span><small>{t('my.venue')}</small><strong>{venueName}</strong></span></span>
                    <span><ReceiptText size={15} /><span><small>{t('my.amount')}</small><strong>{formatMoney(group.totalAmount, locale, currency)}</strong></span></span>
                  </div>
                  <div className="booking-card-footer">
                    <span>{t('my.createdAt')}: {formatCreatedAt(booking.created_at)}</span>
                    {cancellableBookings.length > 0 && (
                      <div className="booking-card-actions">
                        {cancellableBookings.map((item) => {
                          const court = COURTS.find((courtItem) => courtItem.id === item.court_id) || COURTS[0]
                          return (
                            <button className="text-button danger" key={item.id} onClick={() => onCancel(item)}>
                              {isMultiCourt ? t('my.cancelCourt', { court: courtName(court) }) : t('my.cancel')}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
