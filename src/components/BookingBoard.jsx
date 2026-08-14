import { useEffect, useState } from 'react'
import { LoaderCircle, Radio } from 'lucide-react'
import { addMinutes, COURTS, SLOTS, isPastSlot, overlaps, slotDateTime } from '../lib/booking'
import { useI18n } from '../lib/i18n'

function isOccupied(schedule, courtId, dateKey, time, slotMinutes) {
  const start = slotDateTime(dateKey, time)
  const end = addMinutes(start, slotMinutes)
  return schedule.some((item) => item.court_id === courtId && overlaps(start, end, item.start_at, item.end_at))
}

function SlotButton({ court, time, dateKey, schedule, onSelect, now, slotMinutes }) {
  const { courtName, t } = useI18n()
  const occupied = isOccupied(schedule, court.id, dateKey, time, slotMinutes)
  const past = isPastSlot(dateKey, time, now)
  const state = past ? 'past' : occupied ? 'booked' : 'available'
  return (
    <button
      className={`slot ${court.tone} ${past ? 'past' : occupied ? 'occupied' : 'available'}`}
      disabled={occupied || past}
      onClick={() => onSelect({ court, time, dateKey })}
      aria-label={t('board.slotAria', {
        court: courtName(court),
        time,
        status: t(`board.${state}`),
      })}
    >
      <span className="mobile-time">{time}</span>
      <span className="slot-state">{t(past ? 'board.pastShort' : occupied ? 'board.bookedShort' : 'board.availableShort')}</span>
    </button>
  )
}

export default function BookingBoard({ dateKey, schedule, loading, onSelect, slots = SLOTS, configuration }) {
  const { courtName, courtNote, courtTitle, language, t } = useI18n()
  const slotMinutes = Number(configuration?.settings?.slot_minutes || 60)
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
  const availableCount = COURTS.reduce((count, court) => count + slots.filter((time) => (
    !isOccupied(schedule, court.id, dateKey, time, slotMinutes) && !isPastSlot(dateKey, time, now)
  )).length, 0)

  return (
    <section className="board-section" id="availability">
      <div className="section-heading">
        <div>
          <span className="eyebrow"><Radio size={13} /> {t('board.realtime')}</span>
          <h2>{t('board.title')}</h2>
        </div>
        <div className="availability-summary">
          <strong>{availableCount}</strong><span>{t('board.availableCount', { count: '' }).trim()}</span>
        </div>
      </div>

      <div className="legend" aria-label={t('board.legend')}>
        <span><i className="legend-dot available-dot" />{t('board.available')}</span>
        <span><i className="legend-dot occupied-dot" />{t('board.booked')}</span>
        <span>{hoursLabel}</span>
      </div>

      {loading ? (
        <div className="board-loading"><LoaderCircle className="spin" /> {t('board.loading')}</div>
      ) : (
        <>
          <div className="schedule-table-wrap" tabIndex="0">
            <div className="schedule-table" role="grid" aria-label={t('board.aria')} style={{ '--slot-count': slots.length }}>
              <div className="schedule-corner">{t('board.corner')}</div>
              {slots.map((time) => <div className="time-header" key={time}>{time}</div>)}
              {COURTS.map((court) => (
                <div className="schedule-row" key={court.id}>
                  <div className={`court-label ${court.tone}`}>
                    <strong>{courtName(court)}</strong>
                    <span>{language === 'zh' ? court.english : court.name}</span>
                  </div>
                  {slots.map((time) => (
                    <SlotButton key={time} court={court} time={time} dateKey={dateKey} schedule={schedule} onSelect={onSelect} now={now} slotMinutes={slotMinutes} />
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mobile-schedule">
            {COURTS.map((court) => (
              <article className={`mobile-court-card ${court.tone}`} key={court.id}>
                <div className="mobile-court-heading">
                  <div className={`court-seal ${court.tone}`}>{court.name}</div>
                  <div><h3>{courtTitle(court)}</h3><p>{courtNote(court)}</p></div>
                </div>
                <div className="mobile-slot-grid">
                  {slots.map((time) => (
                    <SlotButton key={time} court={court} time={time} dateKey={dateKey} schedule={schedule} onSelect={onSelect} now={now} slotMinutes={slotMinutes} />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
