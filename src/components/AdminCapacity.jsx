import { addDays, toDateKey } from '../lib/booking'
import WeeklyCapacityMonitor from './WeeklyCapacityMonitor'

export default function AdminCapacity({ bookings, startDate, onRangeChange, onInspect }) {
  return (
    <main className="admin-bookings-page admin-capacity-page">
      <WeeklyCapacityMonitor
        bookings={bookings}
        weekDate={startDate}
        onWeekChange={(date) => onRangeChange({
          start: date,
          end: toDateKey(addDays(new Date(`${date}T12:00:00`), 6)),
        })}
        onInspect={onInspect}
      />
    </main>
  )
}
