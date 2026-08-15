import { useEffect, useMemo, useState } from 'react'
import { Clock3, LoaderCircle, Radio } from 'lucide-react'
import { addMinutes, COURTS, SLOTS, isPastSlot, overlaps, slotDateTime } from '../lib/booking'
import { useI18n } from '../lib/i18n'

function isOccupied(schedule, courtId, dateKey, time, duration) {
  const start = slotDateTime(dateKey, time)
  const end = addMinutes(start, duration)
  return schedule.some((item) => item.court_id === courtId && overlaps(start, end, item.start_at, item.end_at))
}

function AvailabilityCell({ court, time, dateKey, schedule, onSelect, now, duration }) {
  const { courtName, t } = useI18n()
  const occupied = isOccupied(schedule, court.id, dateKey, time, duration)
  const past = isPastSlot(dateKey, time, now)
  const state = past ? 'past' : occupied ? 'booked' : 'available'

  return <button
    type="button"
    className={`customer-monitor-cell ${court.tone} ${state}`}
    disabled={occupied || past}
    onClick={() => onSelect({ court, time, dateKey })}
    aria-label={t('board.slotAria', { court: courtName(court), time, status: t(`board.${state}`) })}
  >
    <i aria-hidden="true" />
    <strong>{t(past ? 'board.pastShort' : occupied ? 'board.bookedShort' : 'board.availableShort')}</strong>
    {!past && !occupied && <small>{t('board.quickBook')}</small>}
  </button>
}

export default function BookingBoard({ dateKey, schedule, loading, onSelect, slots = SLOTS, configuration }) {
  const { courtName, language, t } = useI18n()
  const duration = Math.max(30, Number(configuration?.settings?.customer_min_minutes || 60))
  const hours = configuration?.opening_hours
  const minuteLabel = (minute) => minute === 1440 ? '24:00' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const hoursLabel = hours?.is_closed
    ? t('board.closed')
    : hours ? t('board.openingHoursDynamic', { start: minuteLabel(hours.open_minute), end: minuteLabel(hours.close_minute) }) : t('board.openingHours')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const rowAvailability = useMemo(() => new Map(slots.map((time) => [time, COURTS.filter((court) => (
    !isOccupied(schedule, court.id, dateKey, time, duration) && !isPastSlot(dateKey, time, now)
  )).length])), [dateKey, duration, now, schedule, slots])
  const availableCount = [...rowAvailability.values()].reduce((total, count) => total + count, 0)

  return <section className="board-section customer-booking-monitor" id="availability">
    <div className="section-heading">
      <div>
        <span className="eyebrow"><Radio size={13} /> {t('board.realtime')}</span>
        <h2>{t('board.title')}</h2>
        <p className="customer-monitor-intro">{t('board.monitorHelp', { minutes: duration })}</p>
      </div>
      <div className="availability-summary"><strong>{availableCount}</strong><span>{t('board.availableCount', { count: '' }).trim()}</span></div>
    </div>

    <div className="legend" aria-label={t('board.legend')}>
      <span><i className="legend-dot available-dot" />{t('board.available')}</span>
      <span><i className="legend-dot occupied-dot" />{t('board.booked')}</span>
      <span><Clock3 size={13} />{t('board.minimumBlock', { minutes: duration })}</span>
      <span>{hoursLabel}</span>
    </div>

    {loading ? <div className="board-loading"><LoaderCircle className="spin" /> {t('board.loading')}</div> : (
      <div className="customer-monitor-wrap" tabIndex="0">
        <div className="customer-monitor-grid" role="grid" aria-label={t('board.aria')}>
          <div className="customer-monitor-corner"><Clock3 size={16} /><span>{t('board.time')}</span></div>
          {COURTS.map((court) => <div className={`customer-monitor-court ${court.tone}`} key={court.id}><b>{court.name}</b><span><strong>{courtName(court)}</strong><small>{language === 'zh' ? court.english : court.noteEn}</small></span></div>)}
          {slots.map((time) => <div className="customer-monitor-row" role="row" key={time}>
            <div className="customer-monitor-time"><strong>{time}</strong><small>{t('board.freeCount', { count: rowAvailability.get(time) || 0 })}</small></div>
            {COURTS.map((court) => <AvailabilityCell key={court.id} court={court} time={time} dateKey={dateKey} schedule={schedule} onSelect={onSelect} now={now} duration={duration} />)}
          </div>)}
          {!slots.length && <div className="customer-monitor-empty">{t('board.closed')}</div>}
        </div>
      </div>
    )}
  </section>
}
