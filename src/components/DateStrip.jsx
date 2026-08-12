import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, toDateKey } from '../lib/booking'
import { useI18n } from '../lib/i18n'

export default function DateStrip({ selected, onSelect }) {
  const { locale, t } = useI18n()
  const today = new Date()
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, index))
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' })

  return (
    <div className="date-strip-wrap">
      <button className="date-arrow" disabled aria-label={t('dates.previous')}><ChevronLeft size={18} /></button>
      <div className="date-strip" role="list" aria-label={t('dates.choose')}>
        {dates.map((date, index) => {
          const key = toDateKey(date)
          return (
            <button
              key={key}
              className={`date-card ${selected === key ? 'selected' : ''}`}
              onClick={() => onSelect(key)}
              role="listitem"
            >
              <small>{index === 0 ? t('dates.today') : weekdayFormatter.format(date)}</small>
              <strong>{date.getDate()}</strong>
              <span>{monthFormatter.format(date)}</span>
            </button>
          )
        })}
      </div>
      <button className="date-arrow" disabled aria-label={t('dates.next')}><ChevronRight size={18} /></button>
    </div>
  )
}
