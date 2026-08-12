import { LoaderCircle, Radio } from 'lucide-react'
import { COURTS, SLOTS, overlaps, slotDateTime } from '../lib/booking'

function isOccupied(schedule, courtId, dateKey, time) {
  const start = slotDateTime(dateKey, time)
  const endHour = String(Number(time.slice(0, 2)) + 1).padStart(2, '0')
  const end = slotDateTime(dateKey, `${endHour}:00`)
  return schedule.some((item) => item.court_id === courtId && overlaps(start, end, item.start_at, item.end_at))
}

function SlotButton({ court, time, dateKey, schedule, onSelect }) {
  const occupied = isOccupied(schedule, court.id, dateKey, time)
  return (
    <button
      className={`slot ${occupied ? 'occupied' : 'available'}`}
      disabled={occupied}
      onClick={() => onSelect({ court, time, dateKey })}
      aria-label={`${court.name}场 ${time} ${occupied ? '已订' : '可订'}`}
    >
      <span className="mobile-time">{time}</span>
      <span className="slot-state">{occupied ? '已订' : '可订'}</span>
    </button>
  )
}

export default function BookingBoard({ dateKey, schedule, loading, onSelect }) {
  const availableCount = COURTS.length * SLOTS.length - COURTS.reduce(
    (count, court) => count + SLOTS.filter((time) => isOccupied(schedule, court.id, dateKey, time)).length,
    0,
  )

  return (
    <section className="board-section" id="availability">
      <div className="section-heading">
        <div>
          <span className="eyebrow"><Radio size={13} /> 实时更新</span>
          <h2>选择一段属于你的时间</h2>
        </div>
        <div className="availability-summary">
          <strong>{availableCount}</strong><span>个时段可订</span>
        </div>
      </div>

      <div className="legend" aria-label="状态说明">
        <span><i className="legend-dot available-dot" />可预订</span>
        <span><i className="legend-dot occupied-dot" />已预订</span>
        <span>营业时间 07:00—22:00</span>
      </div>

      {loading ? (
        <div className="board-loading"><LoaderCircle className="spin" /> 正在同步场地状态</div>
      ) : (
        <>
          <div className="schedule-table" role="grid" aria-label="五片场地可订时间表">
            <div className="schedule-corner">场地 / 时间</div>
            {SLOTS.map((time) => <div className="time-header" key={time}>{time}</div>)}
            {COURTS.map((court) => (
              <div className="schedule-row" key={court.id}>
                <div className={`court-label ${court.tone}`}>
                  <strong>{court.name}</strong>
                  <span>{court.english}</span>
                </div>
                {SLOTS.map((time) => (
                  <SlotButton key={time} court={court} time={time} dateKey={dateKey} schedule={schedule} onSelect={onSelect} />
                ))}
              </div>
            ))}
          </div>

          <div className="mobile-schedule">
            {COURTS.map((court) => (
              <article className="mobile-court-card" key={court.id}>
                <div className="mobile-court-heading">
                  <div className={`court-seal ${court.tone}`}>{court.name}</div>
                  <div><h3>{court.name} · {court.english}</h3><p>{court.note}</p></div>
                </div>
                <div className="mobile-slot-grid">
                  {SLOTS.map((time) => (
                    <SlotButton key={time} court={court} time={time} dateKey={dateKey} schedule={schedule} onSelect={onSelect} />
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
