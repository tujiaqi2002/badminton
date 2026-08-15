import { Check, Clock3, Minus, Plus, ShieldCheck, WalletCards, X } from 'lucide-react'
import { bookingDurations, COURTS, formatMoney, priceBreakdownFromConfiguration } from '../lib/booking'
import { useI18n } from '../lib/i18n'

export default function BookingDrawer({ selection, onClose, onConfirm, busy, stripeEnabled, invalid, configuration }) {
  const { courtNote, courtTitle, locale, t } = useI18n()
  if (!selection) return null

  const { court, courts = [court], time, dateKey, duration, partySize, paymentMethod, phone = '', notes = '' } = selection
  const set = selection.set
  const durations = bookingDurations(configuration)
  const closeMinute = Number(configuration?.opening_hours?.close_minute || 1440)
  const currency = configuration?.settings?.currency || 'CAD'
  const cancellationHours = Number(configuration?.settings?.cancellation_notice_hours ?? 12)
  const priceBreakdown = priceBreakdownFromConfiguration(configuration, courts.map((court) => court.id), time, duration)
  const price = priceBreakdown.total
  const memberName = locale.startsWith('zh')
    ? priceBreakdown.member?.name_zh
    : priceBreakdown.member?.name_en
  const ruleNames = [...new Set(priceBreakdown.rules.map((rule) => (
    locale.startsWith('zh') ? rule.name_zh : rule.name_en
  )).filter(Boolean))]
  const endMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + duration
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="booking-drawer" role="dialog" aria-modal="true" aria-labelledby="booking-title">
        <div className="drawer-handle" />
        <button className="icon-button drawer-close" onClick={onClose} aria-label={t('drawer.close')}><X size={20} /></button>
        <span className="eyebrow">{t('drawer.eyebrow')}</span>
        <h2 id="booking-title">{courtTitle(court)}</h2>
        <p className="drawer-subtitle">{t('drawer.subtitle', { note: courtNote(court) })}</p>

        <div className="booking-summary-card">
          <div className={`summary-seal ${court.tone}`}>{court.name}</div>
          <div><small>{t('drawer.date')}</small><strong>{dateKey.replaceAll('-', '.')}</strong></div>
          <div><small>{t('drawer.time')}</small><strong>{time}—{endTime}</strong></div>
        </div>

        <div className="drawer-field">
          <label>{t('drawer.duration')}</label>
          <div className="segmented-control">
            {durations.map((minutes) => (
              <button key={minutes} disabled={Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes > closeMinute} className={duration === minutes ? 'selected' : ''} onClick={() => set({ duration: minutes })}>
                {minutes === 30 ? t('drawer.thirtyMinutes') : minutes === 60 ? t('drawer.oneHour') : minutes === 90 ? t('drawer.ninetyMinutes') : minutes === 120 ? t('drawer.twoHours') : minutes < 60 ? t('duration.minutes', { minutes }) : minutes % 60 === 0 ? t('duration.hours', { hours: minutes / 60 }) : t('duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}
              </button>
            ))}
          </div>
        </div>

        <div className="drawer-field">
          <label>{t('drawer.courts')}</label>
          <div className="court-multi-picker">
            {COURTS.map((item) => {
              const selected = courts.some((selectedCourt) => selectedCourt.id === item.id)
              return <button type="button" className={selected ? 'selected' : ''} key={item.id} onClick={() => {
                const next = selected ? courts.filter((selectedCourt) => selectedCourt.id !== item.id) : [...courts, item]
                if (next.length) set({ courts: next, court: next[0], paymentMethod: next.length > 1 ? 'venue' : paymentMethod })
              }}><span>{item.name}</span><small>{item.english}</small>{selected && <Check size={15} />}</button>
            })}
          </div>
          <small className="drawer-help">{t('drawer.multiCourtHelp', { count: courts.length })}</small>
        </div>

        <div className="drawer-field party-row">
          <div><label>{t('drawer.partySize')}</label><small>{t('drawer.maxParty')}</small></div>
          <div className="stepper">
            <button onClick={() => set({ partySize: Math.max(1, partySize - 1) })} aria-label={t('drawer.decreaseParty')}><Minus size={16} /></button>
            <strong>{partySize}</strong>
            <button onClick={() => set({ partySize: Math.min(8, partySize + 1) })} aria-label={t('drawer.increaseParty')}><Plus size={16} /></button>
          </div>
        </div>

        <div className="drawer-field drawer-contact-fields">
          <label htmlFor="booking-phone">{t('drawer.phone')}</label>
          <input id="booking-phone" required type="tel" maxLength="40" value={phone} onChange={(event) => set({ phone: event.target.value })} placeholder={t('drawer.phonePlaceholder')} />
          <label htmlFor="booking-notes">{t('drawer.notesOptional')}</label>
          <textarea id="booking-notes" maxLength="2000" rows="3" value={notes} onChange={(event) => set({ notes: event.target.value })} placeholder={t('drawer.notesPlaceholder')} />
        </div>

        <div className="drawer-field">
          <label>{t('drawer.payment')}</label>
          <button className={`payment-option ${paymentMethod === 'venue' ? 'selected' : ''}`} onClick={() => set({ paymentMethod: 'venue' })}>
            <WalletCards size={19} /><span><strong>{t('drawer.payVenue')}</strong><small>{t('drawer.payVenueNote')}</small></span>{paymentMethod === 'venue' && <Check size={18} />}
          </button>
          <button className={`payment-option ${paymentMethod === 'stripe' ? 'selected' : ''}`} disabled={!stripeEnabled || courts.length > 1} onClick={() => set({ paymentMethod: 'stripe' })}>
            <ShieldCheck size={19} /><span><strong>{t('drawer.payOnline')}</strong><small>{t(stripeEnabled ? 'drawer.stripeReady' : 'drawer.stripeUnavailable')}</small></span>{paymentMethod === 'stripe' && <Check size={18} />}
          </button>
        </div>

        <div className="price-breakdown">
          <div><span>{t('drawer.rulePrice')}</span><strong>{formatMoney(priceBreakdown.subtotal, locale, currency, true)}</strong></div>
          {priceBreakdown.discountPercent > 0 && <div className="member-price-discount"><span>{t('drawer.memberDiscount', { tier: memberName || priceBreakdown.member?.tier || t('drawer.member'), discount: priceBreakdown.discountPercent })}</span><strong>−{formatMoney(priceBreakdown.discountAmount, locale, currency, true)}</strong></div>}
          {ruleNames.length > 0 && <small>{t('drawer.rateRule', { rule: ruleNames.join(' + ') })}</small>}
        </div>
        <div className="price-row"><span>{t('drawer.fee')}</span><strong>{formatMoney(price, locale, currency, true)}</strong></div>
        <p className="booking-policy"><Clock3 size={15} /> {t('drawer.policyDynamic', { hours: cancellationHours })}</p>

        <button className="primary-button confirm-button" disabled={busy || invalid || !phone.trim()} onClick={() => onConfirm({ ...selection, phone: phone.trim(), notes: notes.trim(), price })}>
          {busy ? t('drawer.locking') : invalid ? t('drawer.invalid') : !phone.trim() ? t('drawer.phoneRequired') : t('drawer.confirm', { price: formatMoney(price, locale, currency, true) })}
        </button>
      </aside>
    </div>
  )
}
