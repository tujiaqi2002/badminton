import { AlertTriangle } from 'lucide-react'
import { addDays, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'
import WeeklyCapacityMonitor from './WeeklyCapacityMonitor'

export default function AdminCapacity({ bookings, events, loading, scheduleReadError, startDate, onRangeChange, onInspect, configuration }) {
  const { t } = useI18n()
  return (
    <main className="admin-bookings-page admin-capacity-page" aria-busy={loading}>
      {scheduleReadError ? (
        <section className="admin-schedule-read-error" role="alert">
          <AlertTriangle size={22} />
          <div><strong>{t('admin.schedule.readErrorTitle')}</strong><p>{t('admin.schedule.readErrorText')}</p></div>
        </section>
      ) : <WeeklyCapacityMonitor
        bookings={bookings}
        events={events}
        configuration={configuration}
        weekDate={startDate}
        onWeekChange={(date) => onRangeChange({
          start: date,
          end: toDateKey(addDays(new Date(`${date}T12:00:00`), 6)),
        })}
        onInspect={onInspect}
      />}
    </main>
  )
}
