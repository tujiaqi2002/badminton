import { addDays, toDateKey } from '../lib/booking'
import WeeklyCapacityMonitor from './WeeklyCapacityMonitor'

export default function AdminCapacity({ bookings, events, startDate, onRangeChange, onInspect, configuration }) {
  return (
    <main className="admin-bookings-page admin-capacity-page">
      <WeeklyCapacityMonitor
        bookings={bookings}
        events={events}
        configuration={configuration}
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
