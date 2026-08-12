import { useMemo, useState } from 'react'
import {
  CalendarRange,
  Clock3,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { addDays, COURTS, formatMoney, timeFromDateTime, toDateKey } from '../lib/booking'

const STATUS_LABELS = {
  held: '待支付',
  confirmed: '已确认',
  cancelled: '已取消',
  completed: '已完成',
  expired: '已过期',
  no_show: '未到场',
}

const PAYMENT_LABELS = {
  pending: '等待付款',
  paid: '已付款',
  pay_at_venue: '到店付款',
  refunded: '已退款',
  failed: '付款失败',
}

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

const formatDuration = (minutes) => minutes % 60 === 0
  ? `${minutes / 60} 小时`
  : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`

const formatDay = (dateKey) => new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'long',
}).format(new Date(`${dateKey}T12:00:00`))

export default function AdminBookings({
  bookings,
  loading,
  startDate,
  endDate,
  onRangeChange,
  onRefresh,
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

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
        COURTS.find((court) => court.id === booking.court_id)?.name,
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
  const uniqueCustomers = new Set(filteredBookings.map((booking) => booking.customer_email)).size
  const todayCount = filteredBookings.filter((booking) => booking.start_at.startsWith(toDateKey(new Date()))).length

  return (
    <main className="admin-bookings-page">
      <div className="admin-heading">
        <div>
          <span className="eyebrow"><ShieldCheck size={13} /> Manager access</span>
          <h1>预订管理</h1>
          <p>每位客人、每片场地、每段时间，一目了然。</p>
        </div>
        <button className="outline-button admin-refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> 刷新
        </button>
      </div>

      <section className="admin-summary" aria-label="预订概览">
        <article><span>查询结果</span><strong>{filteredBookings.length}</strong><small>笔预订</small></article>
        <article><span>总时长</span><strong>{Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1)}</strong><small>小时</small></article>
        <article><span>客户</span><strong>{uniqueCustomers}</strong><small>位客人</small></article>
        <article><span>今天</span><strong>{todayCount}</strong><small>个场次</small></article>
      </section>

      <section className="admin-controls" aria-label="筛选预订">
        <div className="admin-presets">
          <button onClick={() => applyPreset(1)}>今天</button>
          <button onClick={() => applyPreset(7)}>未来 7 天</button>
          <button onClick={() => applyPreset(30)}>未来 30 天</button>
        </div>
        <label className="admin-date-field">
          <span>从</span>
          <input type="date" value={startDate} max={endDate} onChange={(event) => onRangeChange({ start: event.target.value, end: endDate })} />
        </label>
        <label className="admin-date-field">
          <span>到</span>
          <input type="date" value={endDate} min={startDate} onChange={(event) => onRangeChange({ start: startDate, end: event.target.value })} />
        </label>
        <label className="admin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、邮箱或场地" />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="预订状态">
          <option value="active">进行中</option>
          <option value="all">全部状态</option>
          <option value="confirmed">已确认</option>
          <option value="held">待支付</option>
          <option value="cancelled">已取消</option>
          <option value="completed">已完成</option>
        </select>
      </section>

      {loading ? (
        <div className="board-loading"><RefreshCw className="spin" /> 正在读取球馆预订</div>
      ) : filteredBookings.length === 0 ? (
        <div className="admin-empty">
          <CalendarRange size={30} />
          <h2>这个范围内没有预订</h2>
          <p>调整日期、状态或搜索条件后再看看。</p>
        </div>
      ) : (
        <div className="admin-day-list">
          {Object.entries(groupedBookings).map(([date, dayBookings]) => (
            <section className="admin-day" key={date}>
              <header>
                <div><strong>{formatDay(date)}</strong><span>{date.replaceAll('-', '.')}</span></div>
                <span>{dayBookings.length} 个场次</span>
              </header>
              <div className="admin-booking-list">
                {dayBookings.map((booking) => {
                  const court = COURTS.find((item) => item.id === booking.court_id) || COURTS[0]
                  const minutes = durationMinutes(booking)
                  return (
                    <article className="admin-booking-row" key={booking.id}>
                      <div className="admin-booking-time">
                        <Clock3 size={16} />
                        <strong>{timeFromDateTime(booking.start_at)}</strong>
                        <span>— {timeFromDateTime(booking.end_at)}</span>
                        <small>{formatDuration(minutes)}</small>
                      </div>
                      <div className="admin-booking-court">
                        <span className={`admin-court-seal ${court.tone}`}>{court.name}</span>
                        <div><strong>{court.name}场 · {court.english}</strong><small>场地 {court.name}</small></div>
                      </div>
                      <div className="admin-customer">
                        <UserRound size={17} />
                        <div><strong>{booking.customer_name}</strong><span><Mail size={12} />{booking.customer_email}</span></div>
                      </div>
                      <div className="admin-booking-details">
                        <span className={`status-pill ${booking.status}`}>{STATUS_LABELS[booking.status] || booking.status}</span>
                        <span><UsersRound size={14} /> {booking.party_size} 人</span>
                        <span>{PAYMENT_LABELS[booking.payment_status] || booking.payment_status}</span>
                        <strong>{formatMoney(booking.total_amount || 0)}</strong>
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
