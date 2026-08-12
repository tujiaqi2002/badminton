import { CalendarX2, Clock3, MapPin, ReceiptText } from 'lucide-react'
import { COURTS, formatMoney, timeFromDateTime } from '../lib/booking'

export default function MyBookings({ user, bookings, loading, onLogin, onCancel }) {
  if (!user) {
    return (
      <main className="empty-page">
        <div className="empty-ink">予</div>
        <span className="eyebrow">个人空间</span>
        <h1>登录后查看你的每一次挥拍</h1>
        <p>管理即将开始的场次、取消预订并查看历史记录。</p>
        <button className="primary-button" onClick={onLogin}>登录 / 注册</button>
      </main>
    )
  }

  return (
    <main className="my-bookings-page">
      <div className="page-heading">
        <span className="eyebrow">My bookings</span>
        <h1>我的预订</h1>
        <p>所有场次都在这里，清楚而从容。</p>
      </div>
      {loading ? <div className="board-loading">正在加载预订…</div> : bookings.length === 0 ? (
        <div className="bookings-empty"><CalendarX2 size={30} /><h2>暂时没有预订</h2><p>选择一个空闲时段，开始你的下一场球。</p></div>
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
                  <div className="booking-card-title"><div><small>{booking.start_at.slice(0, 10).replaceAll('-', '.')}</small><h2>{court.name} · {court.english}</h2></div><span className={`status-pill ${booking.status}`}>{booking.status === 'confirmed' ? '已确认' : booking.status === 'held' ? '待支付' : '已取消'}</span></div>
                  <div className="booking-meta">
                    <span><Clock3 size={15} />{timeFromDateTime(booking.start_at)}—{timeFromDateTime(booking.end_at)}</span>
                    <span><MapPin size={15} />Tiger 羽球馆</span>
                    <span><ReceiptText size={15} />{formatMoney(booking.total_amount || 0)}</span>
                  </div>
                  {canCancel && <button className="text-button danger" onClick={() => onCancel(booking)}>取消预订</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
