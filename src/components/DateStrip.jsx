import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, toDateKey, venueNow } from '../lib/booking'
import { useI18n } from '../lib/i18n'

export default function DateStrip({ selected, onSelect, bookingWindowDays = 7 }) {
  const { locale, t } = useI18n()
  const todayKey = venueNow().dateKey
  const today = useMemo(() => new Date(`${todayKey}T12:00:00`), [todayKey])
  const windowDays = Math.max(1, Number(bookingWindowDays) || 7)
  const maximumOffset = Math.max(0, windowDays - 7)
  const selectedOffset = Math.max(0, Math.round((new Date(`${selected}T12:00:00`) - today) / 86_400_000))
  const [pageOffset, setPageOffset] = useState(() => Math.min(maximumOffset, Math.floor(selectedOffset / 7) * 7))
  useEffect(() => {
    setPageOffset((current) => {
      if (selectedOffset >= current && selectedOffset < current + 7) return Math.min(current, maximumOffset)
      return Math.min(maximumOffset, Math.floor(selectedOffset / 7) * 7)
    })
  }, [maximumOffset, selectedOffset])
  const dates = Array.from({ length: Math.min(7, windowDays - pageOffset) }, (_, index) => addDays(today, pageOffset + index))
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' })

  return (
    <div className="date-strip-wrap">
      <button className="date-arrow" disabled={pageOffset === 0} onClick={() => setPageOffset((current) => Math.max(0, current - 7))} aria-label={t('dates.previous')}><ChevronLeft size={18} /></button>
      <div className="date-strip" role="list" aria-label={t('dates.choose')}>
        {dates.map((date) => {
          const key = toDateKey(date)
          return (
            <button
              key={key}
              className={`date-card ${selected === key ? 'selected' : ''}`}
              onClick={() => onSelect(key)}
              role="listitem"
            >
              <small>{key === todayKey ? t('dates.today') : weekdayFormatter.format(date)}</small>
              <strong>{date.getDate()}</strong>
              <span>{monthFormatter.format(date)}</span>
            </button>
          )
        })}
      </div>
      <button className="date-arrow" disabled={pageOffset >= maximumOffset} onClick={() => setPageOffset((current) => Math.min(maximumOffset, current + 7))} aria-label={t('dates.next')}><ChevronRight size={18} /></button>
    </div>
  )
}
