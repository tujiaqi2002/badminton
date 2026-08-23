import { useMemo, useState } from 'react'
import { CalendarDays, CalendarX2, Clock3, MapPin, ReceiptText, Search, SlidersHorizontal, X } from 'lucide-react'
import { addDays, COURTS, formatMoney, mondayOfWeek, timeFromDateTime, toDateKey, venueNow } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const DEFAULT_FILTERS = {
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
  status: 'all',
  court: 'all',
  type: 'all',
  payment: 'all',
}

const ACTIVE_STATUSES = new Set(['confirmed', 'held'])

const durationMinutes = (booking) => Math.round(
  (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000,
)

const groupIdentity = (booking) => [
  booking.booking_group_id || booking.id,
  booking.start_at,
  booking.end_at,
].join('|')

const uniqueValues = (items, getValue) => [...new Set(items.map(getValue))]

const groupView = (group, nowTime) => {
  if (group.bookings.every((booking) => booking.status === 'cancelled')) return 'cancelled'
  return group.bookings.some((booking) => ACTIVE_STATUSES.has(booking.status) && new Date(booking.end_at).getTime() > nowTime)
    ? 'upcoming'
    : 'past'
}

const normalize = (value) => String(value ?? '').toLowerCase()

const paymentValue = (booking) => booking.payment_status || 'pending'

const isWithinDateFilter = (dateKey, filters, todayKey) => {
  if (filters.datePreset === 'all') return true
  if (filters.datePreset === 'today') return dateKey === todayKey
  if (filters.datePreset === 'week') {
    const weekStart = mondayOfWeek(todayKey)
    const weekEnd = toDateKey(addDays(new Date(`${weekStart}T12:00:00`), 6))
    return dateKey >= weekStart && dateKey <= weekEnd
  }
  if (filters.datePreset === 'month') return dateKey.slice(0, 7) === todayKey.slice(0, 7)
  if (filters.datePreset === 'custom') {
    if (filters.dateFrom && dateKey < filters.dateFrom) return false
    if (filters.dateTo && dateKey > filters.dateTo) return false
  }
  return true
}

export default function MyBookings({ user, bookings, loading, onLogin, onCancel, configuration }) {
  const { courtName, courtTitle, language, locale, t } = useI18n()
  const [activeTab, setActiveTab] = useState('upcoming')
  const [searchTerm, setSearchTerm] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const cancellationHours = Number(configuration?.settings?.cancellation_notice_hours ?? 12)
  const currency = configuration?.settings?.currency || 'CAD'
  const venueName = configuration?.settings?.[language === 'zh' ? 'name_zh' : 'name_en'] || t('venue.name')
  const groupedBookings = useMemo(() => {
    const groups = []
    const byKey = new Map()
    bookings.forEach((booking) => {
      const key = groupIdentity(booking)
      if (!byKey.has(key)) {
        const group = { key, representative: booking, bookings: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).bookings.push(booking)
    })
    return groups.map((group) => {
      const courts = group.bookings
        .map((booking) => COURTS.find((item) => item.id === booking.court_id) || COURTS[0])
        .filter((court, index, list) => list.findIndex((item) => item.id === court.id) === index)
        .sort((left, right) => COURTS.findIndex((item) => item.id === left.id) - COURTS.findIndex((item) => item.id === right.id))
      return {
        ...group,
        courts,
        status: uniqueValues(group.bookings, (booking) => booking.status).length === 1 ? group.bookings[0].status : 'mixed',
        paymentStatus: uniqueValues(group.bookings, (booking) => booking.payment_status || 'pending').length === 1 ? group.bookings[0].payment_status || 'pending' : 'mixed',
        dateKey: group.representative.start_at.slice(0, 10),
        totalAmount: group.bookings.reduce((total, booking) => total + Number(booking.total_amount || 0), 0),
      }
    })
  }, [bookings])
  const formatBookingDate = (dateTime) => {
    const dateKey = dateTime.slice(0, 10)
    const date = new Date(`${dateKey}T12:00:00`)
    return {
      day: new Intl.DateTimeFormat(locale, { day: '2-digit' }).format(date),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      full: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date),
      numeric: dateKey.replaceAll('-', '.'),
    }
  }
  const formatCreatedAt = (dateTime) => {
    if (!dateTime) return t('my.notAvailable')
    const parsed = new Date(dateTime)
    if (Number.isNaN(parsed.getTime())) return t('my.notAvailable')
    return new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(parsed)
  }
  const canCancelBooking = (booking) => ['confirmed', 'held'].includes(booking.status)
    && new Date(booking.start_at).getTime() > Date.now() + cancellationHours * 60 * 60 * 1000
  const formatDuration = (minutes) => minutes < 60
    ? t('duration.minutes', { minutes })
    : minutes % 60 === 0
      ? t('duration.hours', { hours: minutes / 60 })
      : t('duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  const todayKey = venueNow().dateKey
  const nowTime = Date.now()
  const tabOptions = ['upcoming', 'past', 'cancelled'].map((tab) => ({
    id: tab,
    label: t(`my.tab.${tab}`),
    count: groupedBookings.filter((group) => groupView(group, nowTime) === tab).length,
  }))
  const updateFilter = (key, value) => setFilters((current) => ({
    ...current,
    [key]: value,
    ...(key === 'datePreset' && value !== 'custom' ? { dateFrom: '', dateTo: '' } : {}),
  }))
  const resetFilters = () => {
    setSearchTerm('')
    setFilters(DEFAULT_FILTERS)
  }
  const filteredGroups = useMemo(() => {
    const query = normalize(searchTerm.trim())
    return groupedBookings
      .filter((group) => groupView(group, nowTime) === activeTab)
      .filter((group) => isWithinDateFilter(group.dateKey, filters, todayKey))
      .filter((group) => filters.status === 'all' || group.bookings.some((booking) => booking.status === filters.status))
      .filter((group) => filters.court === 'all' || group.bookings.some((booking) => booking.court_id === filters.court))
      .filter((group) => filters.type === 'all' || (filters.type === 'multi' ? group.bookings.length > 1 : group.bookings.length === 1))
      .filter((group) => filters.payment === 'all' || group.bookings.some((booking) => paymentValue(booking) === filters.payment))
      .filter((group) => {
        if (!query) return true
        const searchText = normalize([
          group.key,
          group.dateKey,
          group.dateKey.replaceAll('-', '.'),
          timeFromDateTime(group.representative.start_at),
          timeFromDateTime(group.representative.end_at),
          venueName,
          t(`status.${group.status}`),
          t(`payment.${group.paymentStatus}`),
          ...group.bookings.flatMap((booking) => [booking.id, booking.booking_group_id, booking.start_at, booking.end_at, paymentValue(booking), booking.status]),
          ...group.courts.flatMap((court) => [court.name, court.english, courtTitle(court), courtName(court)]),
        ].join(' '))
        return searchText.includes(query)
      })
      .sort((left, right) => {
        const order = activeTab === 'upcoming' ? 1 : -1
        return order * left.representative.start_at.localeCompare(right.representative.start_at)
          || left.key.localeCompare(right.key)
      })
  }, [activeTab, courtName, courtTitle, filters, groupedBookings, nowTime, searchTerm, t, todayKey, venueName])
  const monthSections = useMemo(() => {
    const sections = []
    const byKey = new Map()
    filteredGroups.forEach((group) => {
      const monthKey = group.dateKey.slice(0, 7)
      if (!byKey.has(monthKey)) {
        const monthDate = new Date(`${monthKey}-01T12:00:00`)
        const section = {
          key: monthKey,
          label: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(monthDate),
          groups: [],
        }
        byKey.set(monthKey, section)
        sections.push(section)
      }
      byKey.get(monthKey).groups.push(group)
    })
    return sections
  }, [filteredGroups, locale])
  const activeFilters = []
  if (searchTerm.trim()) activeFilters.push({ id: 'search', label: t('my.filter.search', { value: searchTerm.trim() }) })
  if (filters.datePreset !== 'all') {
    const customLabel = [filters.dateFrom, filters.dateTo].filter(Boolean).join(' — ')
    activeFilters.push({ id: 'datePreset', label: filters.datePreset === 'custom' && customLabel ? customLabel : t(`my.datePreset.${filters.datePreset}`) })
  }
  if (filters.status !== 'all') activeFilters.push({ id: 'status', label: t(`status.${filters.status}`) })
  if (filters.court !== 'all') activeFilters.push({ id: 'court', label: courtName(COURTS.find((court) => court.id === filters.court) || COURTS[0]) })
  if (filters.type !== 'all') activeFilters.push({ id: 'type', label: t(`my.type.${filters.type}`) })
  if (filters.payment !== 'all') activeFilters.push({ id: 'payment', label: t(`payment.${filters.payment}`) })
  const clearActiveFilter = (id) => {
    if (id === 'search') setSearchTerm('')
    if (id === 'datePreset') setFilters((current) => ({ ...current, datePreset: 'all', dateFrom: '', dateTo: '' }))
    if (id === 'status') updateFilter('status', 'all')
    if (id === 'court') updateFilter('court', 'all')
    if (id === 'type') updateFilter('type', 'all')
    if (id === 'payment') updateFilter('payment', 'all')
  }
  const resultLabel = t('my.resultCount', { count: filteredGroups.length })
  const renderBookingCard = (group) => {
    const booking = group.representative
    const primaryCourt = group.courts[0] || COURTS[0]
    const isMultiCourt = group.bookings.length > 1
    const cancellableBookings = group.bookings.filter(canCancelBooking)
    const date = formatBookingDate(booking.start_at)
    const minutes = durationMinutes(booking)
    return (
      <article className={`booking-card is-${group.status} ${isMultiCourt ? 'is-multi-court' : ''}`} key={group.key}>
        <div className="booking-card-date" aria-label={date.full}>
          <span>{date.month}</span>
          <strong>{date.day}</strong>
          <small>{date.weekday}</small>
        </div>
        <div className="booking-card-main">
          <div className="booking-card-title">
            <div>
              <small>{t('my.bookingLabel')} · {date.numeric}</small>
              <h2>{timeFromDateTime(booking.start_at)}—{timeFromDateTime(booking.end_at)}</h2>
            </div>
            <div className="booking-card-badges">
              {isMultiCourt && <span className="multi-court-pill">{t('my.multiCourtLabel')}</span>}
              <span className={`status-pill ${group.status}`}>{t(`status.${group.status}`)}</span>
              <span className={`payment-pill ${group.paymentStatus}`}>{t(`payment.${group.paymentStatus}`)}</span>
            </div>
          </div>
          <div className="booking-meta">
            {isMultiCourt ? (
              <span className="booking-court-chip multi-court">
                <span className="booking-court-stack">{group.courts.map((court) => <strong className={court.tone} key={court.id}>{court.name}</strong>)}</span>
                <span>{t('my.multiCourtCount', { count: group.courts.length })}</span>
              </span>
            ) : (
              <span className={`booking-court-chip ${primaryCourt.tone}`}><strong>{primaryCourt.name}</strong><span>{courtTitle(primaryCourt)}</span></span>
            )}
            <span><CalendarDays size={15} /><span><small>{t('my.date')}</small><strong>{date.full}</strong></span></span>
            <span><Clock3 size={15} /><span><small>{t('my.duration')}</small><strong>{formatDuration(minutes)}</strong></span></span>
            <span><MapPin size={15} /><span><small>{t('my.venue')}</small><strong>{venueName}</strong></span></span>
            <span><ReceiptText size={15} /><span><small>{t('my.amount')}</small><strong>{formatMoney(group.totalAmount, locale, currency)}</strong></span></span>
          </div>
          <div className="booking-card-footer">
            <span>{t('my.createdAt')}: {formatCreatedAt(booking.created_at)}</span>
            {cancellableBookings.length > 0 && (
              <div className="booking-card-actions">
                {cancellableBookings.map((item) => {
                  const court = COURTS.find((courtItem) => courtItem.id === item.court_id) || COURTS[0]
                  return (
                    <button className="text-button danger" key={item.id} onClick={() => onCancel(item)} type="button">
                      {isMultiCourt ? t('my.cancelCourt', { court: courtName(court) }) : t('my.cancel')}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </article>
    )
  }

  if (!user) {
    return (
      <main className="empty-page">
        <div className="empty-ink">予</div>
        <span className="eyebrow">{t('my.eyebrow')}</span>
        <h1>{t('my.loginTitle')}</h1>
        <p>{t('my.loginText')}</p>
        <button className="primary-button" onClick={onLogin}>{t('account.login')}</button>
      </main>
    )
  }

  return (
    <main className="my-bookings-page">
      <div className="page-heading">
        <span className="eyebrow">My bookings</span>
        <h1>{t('my.title')}</h1>
        <p>{t('my.description')}</p>
      </div>
      {loading ? <div className="board-loading">{t('my.loading')}</div> : bookings.length === 0 ? (
        <div className="bookings-empty"><CalendarX2 size={30} /><h2>{t('my.emptyTitle')}</h2><p>{t('my.emptyText')}</p></div>
      ) : (
        <>
          <section className="booking-discovery" aria-label={t('my.discoveryAria')}>
            <div className="booking-tabs" role="tablist" aria-label={t('my.tabsAria')}>
              {tabOptions.map((tab) => (
                <button
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? 'active' : ''}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span>{tab.label}</span>
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>
            <div className="booking-search-row">
              <label className="booking-search">
                <Search size={16} />
                <input
                  aria-label={t('my.searchAria')}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t('my.searchPlaceholder')}
                  value={searchTerm}
                />
              </label>
              <button className={`filter-toggle ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen((current) => !current)} type="button">
                <SlidersHorizontal size={16} />
                <span>{t('my.filters')}</span>
              </button>
            </div>
            {filtersOpen && (
              <div className="booking-filter-panel">
                <label>
                  <span>{t('my.filterDate')}</span>
                  <select value={filters.datePreset} onChange={(event) => updateFilter('datePreset', event.target.value)}>
                    <option value="all">{t('my.filterAny')}</option>
                    <option value="today">{t('my.datePreset.today')}</option>
                    <option value="week">{t('my.datePreset.week')}</option>
                    <option value="month">{t('my.datePreset.month')}</option>
                    <option value="custom">{t('my.datePreset.custom')}</option>
                  </select>
                </label>
                {filters.datePreset === 'custom' && (
                  <div className="booking-filter-range">
                    <label>
                      <span>{t('my.filterFrom')}</span>
                      <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} />
                    </label>
                    <label>
                      <span>{t('my.filterTo')}</span>
                      <input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} />
                    </label>
                  </div>
                )}
                <label>
                  <span>{t('my.filterStatus')}</span>
                  <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
                    <option value="all">{t('my.filterAny')}</option>
                    <option value="confirmed">{t('status.confirmed')}</option>
                    <option value="held">{t('status.held')}</option>
                    <option value="cancelled">{t('status.cancelled')}</option>
                    <option value="completed">{t('status.completed')}</option>
                    <option value="expired">{t('status.expired')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('my.filterCourt')}</span>
                  <select value={filters.court} onChange={(event) => updateFilter('court', event.target.value)}>
                    <option value="all">{t('my.filterAny')}</option>
                    {COURTS.map((court) => <option key={court.id} value={court.id}>{courtName(court)}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('my.filterType')}</span>
                  <select value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
                    <option value="all">{t('my.filterAny')}</option>
                    <option value="single">{t('my.type.single')}</option>
                    <option value="multi">{t('my.type.multi')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('my.filterPayment')}</span>
                  <select value={filters.payment} onChange={(event) => updateFilter('payment', event.target.value)}>
                    <option value="all">{t('my.filterAny')}</option>
                    <option value="paid">{t('payment.paid')}</option>
                    <option value="pay_at_venue">{t('payment.pay_at_venue')}</option>
                    <option value="pending">{t('payment.pending')}</option>
                    <option value="refunded">{t('payment.refunded')}</option>
                  </select>
                </label>
              </div>
            )}
            <div className="booking-active-filters">
              <strong>{resultLabel}</strong>
              {activeFilters.map((filter) => (
                <button key={filter.id} onClick={() => clearActiveFilter(filter.id)} type="button">
                  <span>{filter.label}</span>
                  <X size={13} />
                </button>
              ))}
              {activeFilters.length > 0 && <button className="clear-filters" onClick={resetFilters} type="button">{t('my.clearAll')}</button>}
            </div>
          </section>
          {monthSections.length === 0 ? (
            <div className="bookings-empty compact"><CalendarX2 size={28} /><h2>{t('my.noResultsTitle')}</h2><p>{t('my.noResultsText')}</p></div>
          ) : (
            <div className="booking-month-list">
              {monthSections.map((section) => (
                <section className="booking-month-group" key={section.key}>
                  <header>
                    <h2>{section.label}</h2>
                    <span>{t('my.resultCount', { count: section.groups.length })}</span>
                  </header>
                  <div className="booking-list">
                    {section.groups.map(renderBookingCard)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
