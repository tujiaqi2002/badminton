import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, toDateKey } from '../lib/booking'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export default function DateStrip({ selected, onSelect }) {
  const today = new Date()
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, index))

  return (
    <div className="date-strip-wrap">
      <button className="date-arrow" disabled aria-label="上一周"><ChevronLeft size={18} /></button>
      <div className="date-strip" role="list" aria-label="选择日期">
        {dates.map((date, index) => {
          const key = toDateKey(date)
          return (
            <button
              key={key}
              className={`date-card ${selected === key ? 'selected' : ''}`}
              onClick={() => onSelect(key)}
              role="listitem"
            >
              <small>{index === 0 ? '今天' : WEEKDAYS[date.getDay()]}</small>
              <strong>{date.getDate()}</strong>
              <span>{date.getMonth() + 1}月</span>
            </button>
          )
        })}
      </div>
      <button className="date-arrow" disabled aria-label="下一周"><ChevronRight size={18} /></button>
    </div>
  )
}
