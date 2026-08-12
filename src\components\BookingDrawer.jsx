import { Check, Clock3, Minus, Plus, ShieldCheck, WalletCards, X } from 'lucide-react'
import { formatMoney, priceFor } from '../lib/booking'

const DURATIONS = [60, 90, 120]

export default function BookingDrawer({ selection, onClose, onConfirm, busy, stripeEnabled, invalid }) {
  if (!selection) return null

  const { court, time, dateKey, duration, partySize, paymentMethod } = selection
  const set = selection.set
  const price = priceFor(time, duration)
  const endMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + duration
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="booking-drawer" role="dialog" aria-modal="true" aria-labelledby="booking-title">
        <div className="drawer-handle" />
        <button className="icon-button drawer-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        <span className="eyebrow">确认场次</span>
        <h2 id="booking-title">{court.name} · {court.english}</h2>
        <p className="drawer-subtitle">{court.note}，一片适合专注挥拍的场地。</p>

        <div className="booking-summary-card">
          <div className={`summary-seal ${court.tone}`}>{court.name}</div>
          <div><small>日期</small><strong>{dateKey.replaceAll('-', '.')}</strong></div>
          <div><small>时间</small><strong>{time}—{endTime}</strong></div>
        </div>

        <div className="drawer-field">
          <label>时长</label>
          <div className="segmented-control">
            {DURATIONS.map((minutes) => (
              <button key={minutes} disabled={Number(time.slice(0, 2)) * 60 + minutes > 22 * 60} className={duration === minutes ? 'selected' : ''} onClick={() => set({ duration: minutes })}>
                {minutes === 60 ? '1 小时' : minutes === 90 ? '90 分钟' : '2 小时'}
              </button>
            ))}
          </div>
        </div>

        <div className="drawer-field party-row">
          <div><label>到场人数</label><small>最多 8 人</small></div>
          <div className="stepper">
            <button onClick={() => set({ partySize: Math.max(1, partySize - 1) })} aria-label="减少人数"><Minus size={16} /></button>
            <strong>{partySize}</strong>
            <button onClick={() => set({ partySize: Math.min(8, partySize + 1) })} aria-label="增加人数"><Plus size={16} /></button>
          </div>
        </div>

        <div className="drawer-field">
          <label>付款方式</label>
          <button className={`payment-option ${paymentMethod === 'venue' ? 'selected' : ''}`} onClick={() => set({ paymentMethod: 'venue' })}>
            <WalletCards size={19} /><span><strong>到店支付</strong><small>前台刷卡或现金</small></span>{paymentMethod === 'venue' && <Check size={18} />}
          </button>
          <button className={`payment-option ${paymentMethod === 'stripe' ? 'selected' : ''}`} disabled={!stripeEnabled} onClick={() => set({ paymentMethod: 'stripe' })}>
            <ShieldCheck size={19} /><span><strong>在线支付</strong><small>{stripeEnabled ? '由 Stripe 安全处理' : '上线 Stripe 后开放'}</small></span>{paymentMethod === 'stripe' && <Check size={18} />}
          </button>
        </div>

        <div className="price-row"><span>场地费用</span><strong>{formatMoney(price)}</strong></div>
        <p className="booking-policy"><Clock3 size={15} /> 开场前 12 小时可免费取消；逾期将收取场地费。</p>

        <button className="primary-button confirm-button" disabled={busy || invalid} onClick={() => onConfirm({ ...selection, price })}>
          {busy ? '正在锁定场地…' : invalid ? '该时长不可预订' : `确认预订 · ${formatMoney(price)}`}
        </button>
      </aside>
    </div>
  )
}
