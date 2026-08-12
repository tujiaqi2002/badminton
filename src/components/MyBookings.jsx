import { CalendarX2, Clock3, MapPin, ReceiptText } from 'lucide-react'
import { COURTS, formatMoney, timeFromDateTime } from '../lib/booking'

export default function MyBookings({ user, bookings, loading, onLogin, onCancel }) {
  if (!user) {
    return (
      <main className="empty-page">
        <div className="empty-ink">äºˆ</div>
        <span className="eyebrow">ä¸ªäººç©ºé—´</span>
        <h1>ç™»å½•åŽæŸ¥çœ‹ä½ çš„æ¯ä¸€æ¬¡æŒ¥æ‹</h1>
        <p>ç®¡ç†å³å°†å¼€å§‹çš„åœºæ¬¡ã€å–æ¶ˆé¢„è®¢å¹¶æŸ¥çœ‹åŽ†å²è®°å½•ã€‚</p>
        <button className="primary-button" onClick={onLogin}>ç™»å½• / æ³¨å†Œ</button>
      </main>
    )
  }

  return (
    <main className="my-bookings-page">
      <div className="page-heading">
        <span className="eyebrow">My bookings</span>
        <h1>æˆ‘çš„é¢„è®¢</h1>
        <p>æ‰€æœ‰åœºæ¬¡éƒ½åœ¨è¿™é‡Œï¼Œæ¸…æ¥šè€Œä»Žå®¹ã€‚</p>
      </div>
      {loading ? <div className="board-loading">æ­£åœ¨åŠ è½½é¢„è®¢â€¦</div> : bookings.length === 0 ? (
        <div className="bookings-empty"><CalendarX2 size={30} /><h2>æš‚æ—¶æ²¡æœ‰é¢„è®¢</h2><p>é€‰æ‹©ä¸€ä¸ªç©ºé—²æ—¶æ®µï¼Œå¼€å§‹ä½ çš„ä¸‹ä¸€åœºçƒã€‚</p></div>
      ) : (
        <div className="booking-list">
          {bookings.map((booking) => {
            const court = COURTS.find((item) => item.id === booking.court_id) || COURTS[0]
            const canCancel = ['confirmed', 'held'].includes(booking.status)
              && new Date(booking.start_at).getTime() > Date.now() + 12 * 60 * 60 * 1000
            return (
              <article className="booking-card" key={booking.id}>
                <div className={`booking-card-seal ${court.tone}`}>{court.name}</div>
                <div className="booking-card-main">
                  <div className="booking-card-title"><div><small>{booking.start_at.slice(0, 10).replaceAll('-', '.')}</small><h2>{court.name} Â· {court.english}</h2></div><span className={`status-pill ${booking.status}`}>{booking.status === 'confirmed' ? 'å·²ç¡®è®¤' : booking.status === 'held' ? 'å¾…æ”¯ä»˜' : 'å·²å–æ¶ˆ'}</span></div>
                  <div className="booking-meta">
                    <span><Clock3 size={15} />{timeFromDateTime(booking.start_at)}â€”{timeFromDateTime(booking.end_at)}</span>
                    <span><MapPin size={15} />Tiger ç¾½çƒé¦†</span>
                    <span><ReceiptText size={15} />{formatMoney(booking.total_amount || 0)}</span>
                  </div>
                  {canCancel && <button className="text-button danger" onClick={() => onCancel(booking)}>å–æ¶ˆé¢„è®¢</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}