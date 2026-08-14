import { CalendarX2, Clock3, MapPin, ReceiptText } from 'lucide-react'
import { COURTS, formatMoney, timeFromDateTime } from '../lib/booking'
import { useI18n } from '../lib/i18n'

export default function MyBookings({ user, bookings, loading, onLogin, onCancel, configuration }) {
  const { courtTitle, language, locale, t } = useI18n()
  const cancellationHours = Number(configuration?.settings?.cancellation_notice_hours ?? 12)
  const currency = configuration?.settings?.currency || 'CAD'
  const venueName = configuration?.settings?.[language === 'zh' ? 'name_zh' : 'name_en'] || t('venue.name')
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
          {bookings.map((booking) => {
            const court = COURTS.find((item) => item.id === booking.court_id) || COURTS[0]
            const canCancel = ['confirmed', 'held'].includes(booking.status)
              && new Date(booking.start_at).getTime() > Date.now() + cancellationHours * 60 * 60 * 1000
            return (
              <article className="booking-card" key={booking.id}>
                <div className={`booking-card-seal ${court.tone}`}>{court.name}</div>
                <div className="booking-card-main">
                  <div className="booking-card-title"><div><small>{booking.start_at.slice(0, 10).replaceAll('-', '.')}</small><h2>{courtTitle(court)}</h2></div><span className={`status-pill ${booking.status}`}>{t(`status.${booking.status}`)}</span></div>
                  <div className="booking-meta">
                    <span><Clock3 size={15} />{timeFromDateTime(booking.start_at)}—{timeFromDateTime(booking.end_at)}</span>
                    <span><MapPin size={15} />{venueName}</span>
                    <span><ReceiptText size={15} />{formatMoney(booking.total_amount || 0, locale, currency)}</span>
                  </div>
                  {canCancel && <button className="text-button danger" onClick={() => onCancel(booking)}>{t('my.cancel')}</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
