import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileClock,
  Filter,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserRoundSearch,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { addDays, comparePricingRuleMatch, COURTS, toDateKey, venueNow } from '../lib/booking'
import { useI18n } from '../lib/i18n'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MEMBER_STATUSES = ['active', 'paused', 'expired', 'cancelled']
const EVENT_TYPES = ['special_event', 'tournament', 'maintenance', 'private_event', 'promotion', 'closure']
const EVENT_COLORS = ['ink', 'red', 'gold', 'green', 'blue', 'purple']

const COPY = {
  zh: {
    eyebrow: 'VENUE OPERATIONS', title: '馆务中心', subtitle: '把营业规则、定价、活动、会员与操作记录放在同一处管理。',
    overview: '总览', hours: '营业时间', pricing: '定价规则', events: '活动与闭馆', members: '会员查询', audit: '操作记录',
    refresh: '刷新', save: '保存更改', saving: '保存中…', add: '新增', edit: '编辑', close: '关闭', cancel: '取消', delete: '删除',
    todayHours: '今日营业', activePrices: '生效定价', upcomingEvents: '未来活动', activeMembers: '有效会员',
    operationsSummary: '今日运营摘要', quickStart: '快速进入', allVenue: '全馆', court: '指定场地', allDays: '每天', allTiers: '所有会员',
    settingsTitle: '基础设置', settingsHelp: '这些值将成为以后预订、财务与通知模块共同使用的唯一配置来源。',
    nameZh: '中文名称', nameEn: '英文名称', timezone: '时区', currency: '币种', bookingWindow: '开放预订天数',
    slotMinutes: '最小时间刻度', customerMin: '客户最短预订', customerMax: '客户最长预订', managerMax: '馆长最长预订', cancelHours: '免费取消提前小时', minutes: '分钟', hoursUnit: '小时', days: '天',
    hoursTitle: '每周营业时间', hoursHelp: '关闭某一天不会删除历史订单；新的预订会使用这份时间表。', closed: '闭馆', open: '营业', from: '开始', to: '结束', note: '当日说明',
    pricingTitle: '定价规则', pricingHelp: '不再计算优先级数字。系统自动选择范围最具体的规则：限时日期 → 会员专属 → 指定场地 → 指定星期 → 基础价；同层级选择覆盖更窄的时段。', addPrice: '新增定价', ruleNameZh: '规则中文名', ruleNameEn: '规则英文名',
    weekday: '星期', startTime: '开始时间', endTime: '结束时间', hourlyRate: '每小时价格', memberTier: '会员等级', matchOrder: '自动匹配', active: '启用', effective: '有效日期', noLimit: '不限',
    priceSpecial: '限时日期', priceMember: '会员专属', priceCourt: '指定场地', priceWeekday: '指定星期', priceBase: '基础补位', automatic: '系统自动', autoMatchTitle: '系统自动决定匹配顺序', autoMatchHelp: '你只需要设置适用日期、会员、场地和星期；限制越具体，越先采用。无需再猜 0、80 或 100。',
    eventsTitle: '活动与特殊安排', eventsHelp: '可记录比赛、维护、包场和闭馆；阻止预订的活动会检查已有订单冲突。', addEvent: '新增活动',
    titleZh: '中文标题', titleEn: '英文标题', description: '说明', eventType: '类型', status: '状态', startsAt: '开始', endsAt: '结束', blocksBooking: '阻止新的预订', eventCourts: '适用场地（不选代表全馆）', conflicts: '与 {{count}} 笔有效预订冲突',
    eventFormHelp: '安排比赛、包场、维护或闭馆，并同步显示在预定管理日历中。', chooseDate: '选择日期', chooseTime: '选择时间', previousMonth: '上个月', nextMonth: '下个月', today: '今天', color: '标记颜色',
    scheduled: '已排期', draft: '草稿', completed: '已完成', cancelled: '已取消', special_event: '特别活动', tournament: '比赛', maintenance: '维护', private_event: '包场', promotion: '推广活动', closure: '闭馆',
    membersTitle: '会员查询', membersHelp: '会员资料与登录账号分离，未来可继续接入积分、套餐、余额和门禁。', addMember: '新增会员', searchMember: '搜索姓名、会员号、电话或邮箱', allStatuses: '全部状态',
    memberNumber: '会员号', memberName: '姓名', contact: '联系方式', tier: '等级', discount: '折扣', joined: '加入日期', expires: '到期日期', statusLabel: '状态', memberNotes: '会员备注', paused: '暂停', expired: '已过期',
    quickMember: '快速添加会员', quickMemberHelp: '只填姓名并选择等级即可建档；电话和邮箱可稍后补充。', createMember: '立即建档', quickContact: '电话或邮箱至少建议填写一项',
    tierSystem: '会员等级体系', tierSystemHelp: '等级统一控制默认折扣、有效期与权益；单个会员仍可设置例外。', addTier: '新增等级', editTier: '编辑等级', tierCode: '等级代码', tierNameZh: '中文等级名', tierNameEn: '英文等级名', validity: '默认有效期', permanent: '长期有效', memberCount: '{{count}} 位会员', tierBenefits: '权益（每行一项）', rank: '排序', tierColor: '标记颜色', useTierDiscount: '使用等级默认折扣', customDiscount: '个人折扣例外', activeTier: '启用等级',
    auditTitle: '操作记录查询', auditHelp: '日志只追加、不修改。可按时间、操作者、模块和对象筛选，查看每次更改前后的完整数据。', searchAudit: '搜索邮箱、操作、对象 ID 或操作编号',
    last7: '最近 7 天', last30: '最近 30 天', actor: '操作者', module: '模块', entity: '对象', all: '全部', manager: '馆长', user: '用户', system: '系统',
    operation: '操作', occurred: '发生时间', changed: '更改字段', source: '来源', details: '查看详情', before: '更改前', after: '更改后', metadata: '元数据', operationId: '操作编号',
    page: '第 {{page}} 页', previous: '上一页', next: '下一页', max50: '每页最多 50 条', total: '共 {{count}} 条',
    empty: '暂无符合条件的记录', loading: '正在读取馆务数据', loadError: '馆务中心加载失败，请重试。', saveError: '保存失败，请检查填写内容。', saved: '馆务设置已保存', customerDurationInvalid: '客户最短预订不能超过客户最长预订',
    confirmDeletePrice: '删除这条定价规则？历史订单价格不会改变。', confirmCancelEvent: '取消这项活动？', conflictConfirm: '这个安排与已有订单冲突。仍然保存，并保留这些订单吗？',
    eventPrefixAll: '全部模块', booking: '预订', venue_settings: '基础设置', opening_hours: '营业时间', pricing_rule: '定价', venue_event: '活动', event_court: '活动场地', member: '会员', member_tier: '会员等级',
    updatedAt: '最后更新', noEvents: '未来没有特别活动', noMembers: '尚未建立会员资料', unsaved: '有尚未保存的更改',
    mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六', sun: '周日',
  },
  en: {
    eyebrow: 'VENUE OPERATIONS', title: 'Operations Center', subtitle: 'Manage hours, pricing, events, members and the audit trail in one place.',
    overview: 'Overview', hours: 'Opening hours', pricing: 'Pricing', events: 'Events & closures', members: 'Members', audit: 'Audit log',
    refresh: 'Refresh', save: 'Save changes', saving: 'Saving…', add: 'Add', edit: 'Edit', close: 'Close', cancel: 'Cancel', delete: 'Delete',
    todayHours: 'Today’s hours', activePrices: 'Active rates', upcomingEvents: 'Upcoming events', activeMembers: 'Active members',
    operationsSummary: 'Today at a glance', quickStart: 'Quick access', allVenue: 'Entire venue', court: 'Specific court', allDays: 'Every day', allTiers: 'All members',
    settingsTitle: 'Venue settings', settingsHelp: 'These values are the shared source of truth for future booking, finance and notification modules.',
    nameZh: 'Chinese name', nameEn: 'English name', timezone: 'Time zone', currency: 'Currency', bookingWindow: 'Booking window',
    slotMinutes: 'Smallest time step', customerMin: 'Customer minimum', customerMax: 'Customer maximum', managerMax: 'Manager maximum', cancelHours: 'Free-cancellation notice', minutes: 'min', hoursUnit: 'hours', days: 'days',
    hoursTitle: 'Weekly opening hours', hoursHelp: 'Closing a day keeps historical bookings intact; new bookings use this schedule.', closed: 'Closed', open: 'Open', from: 'From', to: 'To', note: 'Day note',
    pricingTitle: 'Pricing rules', pricingHelp: 'No numeric priority is needed. The most specific match wins: dated rule → member → court → weekday → base rate; narrower windows win within a level.', addPrice: 'Add rate', ruleNameZh: 'Chinese rule name', ruleNameEn: 'English rule name',
    weekday: 'Weekday', startTime: 'Start', endTime: 'End', hourlyRate: 'Hourly rate', memberTier: 'Member tier', matchOrder: 'Automatic match', active: 'Active', effective: 'Effective dates', noLimit: 'No limit',
    priceSpecial: 'Dated rate', priceMember: 'Member rate', priceCourt: 'Court rate', priceWeekday: 'Weekday rate', priceBase: 'Base fallback', automatic: 'Automatic', autoMatchTitle: 'Match order is automatic', autoMatchHelp: 'Set the applicable dates, member, court and weekdays. A more specific scope wins, so there are no 0, 80 or 100 values to guess.',
    eventsTitle: 'Events and exceptions', eventsHelp: 'Track tournaments, maintenance, private events and closures. Blocking events are checked against live bookings.', addEvent: 'Add event',
    titleZh: 'Chinese title', titleEn: 'English title', description: 'Description', eventType: 'Type', status: 'Status', startsAt: 'Starts', endsAt: 'Ends', blocksBooking: 'Block new bookings', eventCourts: 'Courts (none means entire venue)', conflicts: 'Conflicts with {{count}} active bookings',
    eventFormHelp: 'Schedule tournaments, private events, maintenance or closures and show them on the booking calendar.', chooseDate: 'Choose date', chooseTime: 'Choose time', previousMonth: 'Previous month', nextMonth: 'Next month', today: 'Today', color: 'Marker color',
    scheduled: 'Scheduled', draft: 'Draft', completed: 'Completed', cancelled: 'Cancelled', special_event: 'Special event', tournament: 'Tournament', maintenance: 'Maintenance', private_event: 'Private event', promotion: 'Promotion', closure: 'Closure',
    membersTitle: 'Member directory', membersHelp: 'Member records stay separate from login accounts and can later support passes, points, balances and access control.', addMember: 'Add member', searchMember: 'Search name, member number, phone or email', allStatuses: 'All statuses',
    memberNumber: 'Member no.', memberName: 'Name', contact: 'Contact', tier: 'Tier', discount: 'Discount', joined: 'Joined', expires: 'Expires', statusLabel: 'Status', memberNotes: 'Member notes', paused: 'Paused', expired: 'Expired',
    quickMember: 'Quick member add', quickMemberHelp: 'A name and tier are enough to create the profile; contact details can be completed later.', createMember: 'Create member', quickContact: 'A phone number or email is recommended',
    tierSystem: 'Membership tiers', tierSystemHelp: 'Tiers define the default discount, validity and benefits while allowing per-member exceptions.', addTier: 'Add tier', editTier: 'Edit tier', tierCode: 'Tier code', tierNameZh: 'Chinese tier name', tierNameEn: 'English tier name', validity: 'Default validity', permanent: 'No expiry', memberCount: '{{count}} members', tierBenefits: 'Benefits (one per line)', rank: 'Order', tierColor: 'Marker colour', useTierDiscount: 'Use tier discount', customDiscount: 'Member discount override', activeTier: 'Active tier',
    auditTitle: 'Audit log query', auditHelp: 'The ledger is append-only. Filter by time, actor, module and entity, then inspect complete before/after data.', searchAudit: 'Search email, action, entity ID or operation ID',
    last7: 'Last 7 days', last30: 'Last 30 days', actor: 'Actor', module: 'Module', entity: 'Entity', all: 'All', manager: 'Manager', user: 'User', system: 'System',
    operation: 'Action', occurred: 'Occurred', changed: 'Changed fields', source: 'Source', details: 'Details', before: 'Before', after: 'After', metadata: 'Metadata', operationId: 'Operation ID',
    page: 'Page {{page}}', previous: 'Previous', next: 'Next', max50: 'Up to 50 per page', total: '{{count}} total',
    empty: 'No matching records', loading: 'Loading venue operations', loadError: 'Could not load the Operations Center.', saveError: 'Could not save. Check the entered values.', saved: 'Venue operations updated', customerDurationInvalid: 'Customer minimum cannot exceed the customer maximum.',
    confirmDeletePrice: 'Delete this pricing rule? Historical booking prices will not change.', confirmCancelEvent: 'Cancel this event?', conflictConfirm: 'This event conflicts with active bookings. Save it and keep those bookings?',
    eventPrefixAll: 'All modules', booking: 'Bookings', venue_settings: 'Venue settings', opening_hours: 'Opening hours', pricing_rule: 'Pricing', venue_event: 'Events', event_court: 'Event courts', member: 'Members', member_tier: 'Member tiers',
    updatedAt: 'Last updated', noEvents: 'No upcoming special events', noMembers: 'No member records yet', unsaved: 'Unsaved changes',
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  },
}

const minuteToTime = (minute) => minute === 1440
  ? '24:00'
  : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const timeToMinute = (time) => time === '24:00' ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const addLocalMinutes = (value, minutes) => {
  const date = new Date(`${value}:00`)
  date.setMinutes(date.getMinutes() + minutes)
  return `${toDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const dateInput = (date = new Date()) => {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return copy.toISOString().slice(0, 10)
}
const emptyPricingRule = () => ({
  name_zh: '', name_en: '', court_id: '', day_of_week: '', days_of_week: null, start_minute: 600,
  end_minute: 1440, hourly_rate: 28, member_tier: '', valid_from: '', valid_to: '', is_active: true,
})
const pricingDays = (rule) => {
  if (Array.isArray(rule?.days_of_week)) {
    return [...new Set(rule.days_of_week.map(Number))].sort((left, right) => left - right)
  }
  if (rule?.day_of_week !== null && rule?.day_of_week !== undefined && rule?.day_of_week !== '') {
    return [Number(rule.day_of_week)]
  }
  return null
}
const pricingRuleForForm = (rule) => {
  const copy = { ...rule, days_of_week: pricingDays(rule) }
  delete copy.priority
  return copy
}
const pricingRuleLevel = (rule) => {
  if (rule?.valid_from || rule?.valid_to) return 'priceSpecial'
  if (rule?.member_tier) return 'priceMember'
  if (rule?.court_id) return 'priceCourt'
  if (pricingDays(rule) !== null) return 'priceWeekday'
  return 'priceBase'
}
const emptyEvent = () => {
  const tomorrow = toDateKey(addDays(new Date(`${venueNow().dateKey}T12:00:00`), 1))
  return { title_zh: '', title_en: '', description: '', event_type: 'special_event', status: 'scheduled', starts_at: `${tomorrow}T10:00`, ends_at: `${tomorrow}T12:00`, blocks_booking: false, color: 'ink', court_ids: [] }
}
const emptyMember = () => ({
  member_number: '', display_name: '', email: '', phone: '', tier: 'standard', status: 'active',
  discount_percent: 0, discount_override_percent: null, joined_on: dateInput(), expires_on: '', notes: '', metadata: {},
})
const emptyQuickMember = () => ({ display_name: '', email: '', phone: '', tier: 'standard' })
const emptyMemberTier = (rank = 50) => ({
  code: '', name_zh: '', name_en: '', description_zh: '', description_en: '', rank,
  discount_percent: 0, default_validity_days: 365, color: 'ink', benefits: [], is_active: true,
})
const MEMBER_TIER_COLORS = ['ink', 'jade', 'silver', 'gold', 'cinnabar']

function PanelHeader({ eyebrow, title, help, action }) {
  return <header className="operations-panel-header">
    <div><span>{eyebrow}</span><h2>{title}</h2><p>{help}</p></div>
    {action}
  </header>
}

function Modal({ title, onClose, children, wide = false }) {
  return <div className="operations-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`operations-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      {children}
    </section>
  </div>
}

const EVENT_TIMES = Array.from({ length: 28 }, (_, index) => minuteToTime(600 + index * 30))

function EventDateTimeField({ label, value, minValue = '', locale, c, onChange }) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const dateKey = value.slice(0, 10)
  const time = value.slice(11, 16)
  const [monthCursor, setMonthCursor] = useState(() => {
    const selected = new Date(`${dateKey}T12:00:00`)
    return new Date(selected.getFullYear(), selected.getMonth(), 1, 12)
  })

  useEffect(() => {
    const selected = new Date(`${dateKey}T12:00:00`)
    setMonthCursor(new Date(selected.getFullYear(), selected.getMonth(), 1, 12))
  }, [dateKey])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const calendarDays = useMemo(() => {
    const firstDayOffset = (monthCursor.getDay() + 6) % 7
    const firstCell = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1 - firstDayOffset, 12)
    return Array.from({ length: 42 }, (_, index) => addDays(firstCell, index))
  }, [monthCursor])
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => (
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(addDays(new Date('2026-08-10T12:00:00'), index))
  )), [locale])
  const timeOptions = useMemo(() => [...new Set([...EVENT_TIMES, time])].filter(Boolean).sort(), [time])
  const selectedLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${dateKey}T12:00:00`))
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(monthCursor)
  const todayKey = venueNow().dateKey
  const minimumDate = minValue.slice(0, 10)
  const chooseDate = (key) => {
    let next = `${key}T${time}`
    if (minValue && next <= minValue) {
      const minimumTime = minValue.slice(11, 16)
      const nextTime = EVENT_TIMES.find((item) => item > minimumTime) || '23:30'
      next = `${key}T${nextTime}`
    }
    onChange(next)
    setOpen(false)
  }

  return <label className="operations-datetime-field">
    <span>{label}</span>
    <div className="operations-datetime-control" ref={rootRef}>
      <button type="button" className="operations-date-trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open}>
        <CalendarDays size={15} /><span><strong>{selectedLabel}</strong><small>{dateKey.replaceAll('-', '.')}</small></span>
      </button>
      <div className="operations-time-select"><Clock3 size={14} /><select aria-label={`${label} · ${c.chooseTime}`} value={time} onChange={(event) => onChange(`${dateKey}T${event.target.value}`)}>
        {timeOptions.map((item) => <option key={item} value={item} disabled={Boolean(minValue && dateKey === minimumDate && `${dateKey}T${item}` <= minValue)}>{item}</option>)}
      </select></div>
      {open && <div className="admin-calendar-popover operations-calendar-popover" role="dialog" aria-label={`${label} · ${c.chooseDate}`}>
        <header><button type="button" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))} aria-label={c.previousMonth}><ChevronLeft size={17} /></button><strong>{monthLabel}</strong><button type="button" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))} aria-label={c.nextMonth}><ChevronRight size={17} /></button></header>
        <div className="admin-calendar-weekdays" aria-hidden="true">{weekdays.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}</div>
        <div className="admin-calendar-days">{calendarDays.map((date) => {
          const key = toDateKey(date)
          const disabled = Boolean(minimumDate && key < minimumDate)
          return <button type="button" disabled={disabled} className={`${key === dateKey ? 'selected' : ''} ${key === todayKey ? 'today' : ''} ${date.getMonth() !== monthCursor.getMonth() ? 'outside' : ''}`} onClick={() => chooseDate(key)} key={key}>{date.getDate()}</button>
        })}</div>
        <button type="button" className="admin-calendar-today" disabled={Boolean(minimumDate && todayKey < minimumDate)} onClick={() => chooseDate(todayKey)}><CalendarDays size={13} /> {c.today}</button>
      </div>}
    </div>
  </label>
}

export default function VenueOperations({ onNotify, onConfigurationLoaded }) {
  const { language, locale } = useI18n()
  const c = COPY[language] || COPY.en
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(null)
  const [hours, setHours] = useState([])
  const [pricingForm, setPricingForm] = useState(null)
  const [eventForm, setEventForm] = useState(null)
  const [memberForm, setMemberForm] = useState(null)
  const [tierForm, setTierForm] = useState(null)
  const [quickMember, setQuickMember] = useState(emptyQuickMember)
  const [memberTiers, setMemberTiers] = useState([])
  const [members, setMembers] = useState({ items: [], total: 0, has_more: false, next_cursor: null, tiers: [] })
  const [memberFilters, setMemberFilters] = useState({ query: '', status: 'all', tier: 'all' })
  const [memberCursorStack, setMemberCursorStack] = useState([null])
  const [memberPage, setMemberPage] = useState(1)
  const [audit, setAudit] = useState({ items: [], total: 0, has_more: false, next_cursor: null, event_prefixes: [], entity_types: [] })
  const [auditFilters, setAuditFilters] = useState(() => ({
    start: dateInput(new Date(Date.now() - 29 * 24 * 60 * 60_000)), end: dateInput(), query: '', eventPrefix: 'all', entityType: 'all', actorKind: 'all',
  }))
  const [auditCursorStack, setAuditCursorStack] = useState([null])
  const [auditPage, setAuditPage] = useState(1)
  const [auditDetail, setAuditDetail] = useState(null)
  const configurationLoadedRef = useRef(onConfigurationLoaded)

  useEffect(() => {
    configurationLoadedRef.current = onConfigurationLoaded
  }, [onConfigurationLoaded])

  const notify = useCallback((message, tone = 'success') => {
    if (onNotify) onNotify(message, tone)
  }, [onNotify])

  const loadOverview = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      setError(c.loadError)
      return
    }
    setLoading(true)
    const [{ data: result, error: requestError }, { data: tierResult, error: tierError }] = await Promise.all([
      supabase.rpc('admin_get_venue_operations'),
      supabase.rpc('admin_get_member_tiers'),
    ])
    setLoading(false)
    if (requestError || tierError) { setError(c.loadError); return }
    setError('')
    setData(result)
    setSettings(result.settings)
    setHours(result.hours || [])
    setMemberTiers(tierResult || [])
    configurationLoadedRef.current?.(result)
  }, [c.loadError])

  const queryMembers = useCallback(async (cursor = null, page = 1) => {
    const { data: result, error: requestError } = await supabase.rpc('admin_search_members', {
      p_query: memberFilters.query, p_status: memberFilters.status, p_tier: memberFilters.tier, p_limit: 50,
      p_after_created_at: cursor?.created_at || null, p_after_id: cursor?.id || null,
    })
    if (requestError) { notify(c.loadError, 'error'); return }
    setMembers(result)
    setMemberPage(page)
  }, [c.loadError, memberFilters, notify])

  const queryAudit = useCallback(async (cursor = null, page = 1) => {
    const { data: result, error: requestError } = await supabase.rpc('admin_search_audit_events', {
      p_start_at: `${auditFilters.start}T00:00:00-04:00`, p_end_at: `${auditFilters.end}T23:59:59-04:00`,
      p_query: auditFilters.query, p_event_prefix: auditFilters.eventPrefix, p_entity_type: auditFilters.entityType,
      p_actor_kind: auditFilters.actorKind, p_limit: 50, p_after_occurred_at: cursor?.occurred_at || null, p_after_id: cursor?.id || null,
    })
    if (requestError) { notify(c.loadError, 'error'); return }
    setAudit(result)
    setAuditPage(page)
  }, [auditFilters, c.loadError, notify])

  useEffect(() => { loadOverview() }, [loadOverview])
  useEffect(() => {
    if (tab !== 'members') return
    const timeout = window.setTimeout(() => { setMemberCursorStack([null]); queryMembers(null, 1) }, 220)
    return () => window.clearTimeout(timeout)
  }, [memberFilters, queryMembers, tab])
  useEffect(() => {
    if (tab !== 'audit') return
    const timeout = window.setTimeout(() => { setAuditCursorStack([null]); queryAudit(null, 1) }, 220)
    return () => window.clearTimeout(timeout)
  }, [auditFilters, queryAudit, tab])

  const mutate = async (rpc, payload, after) => {
    setBusy(true)
    const response = await supabase.rpc(rpc, payload)
    setBusy(false)
    if (response.error) {
      const message = response.error.message?.includes('Pricing rules must cover every open court and time slot')
        ? (language === 'zh' ? '定价规则必须覆盖所有营业中的场地与时段' : 'Pricing must cover every open court and time slot.')
        : response.error.message || c.saveError
      notify(message, 'error')
      return response
    }
    notify(c.saved)
    await loadOverview()
    if (after) await after(response.data)
    return response
  }

  const saveSettings = () => {
    if (Number(settings?.customer_min_minutes || 60) > Number(settings?.customer_max_minutes || 120)) {
      notify(c.customerDurationInvalid, 'error')
      return
    }
    mutate('admin_update_venue_settings', { p_settings: settings })
  }
  const saveHours = () => mutate('admin_replace_opening_hours', { p_hours: hours })
  const savePricing = async (event) => {
    event.preventDefault()
    const selectedDays = pricingDays(pricingForm)
    const rulePayload = {
      ...pricingForm,
      days_of_week: selectedDays,
      day_of_week: selectedDays?.length === 1 ? selectedDays[0] : '',
    }
    delete rulePayload.priority
    const response = await mutate('admin_upsert_pricing_rule', {
      p_rule: rulePayload,
    })
    if (!response.error) setPricingForm(null)
  }
  const deletePricing = async (rule) => {
    if (!window.confirm(c.confirmDeletePrice)) return
    await mutate('admin_delete_pricing_rule', { p_rule_id: rule.id })
  }
  const saveEvent = async (event, allowConflicts = false) => {
    event.preventDefault()
    const response = await mutate('admin_upsert_venue_event', { p_event: eventForm, p_allow_conflicts: allowConflicts })
    if (response.error?.message?.includes('Event conflicts') && !allowConflicts && window.confirm(c.conflictConfirm)) {
      await saveEvent({ preventDefault() {} }, true)
      return
    }
    if (!response.error) setEventForm(null)
  }
  const cancelEvent = async (event) => {
    if (!window.confirm(c.confirmCancelEvent)) return
    await mutate('admin_cancel_venue_event', { p_event_id: event.id })
  }
  const saveMember = async (event) => {
    event.preventDefault()
    const payload = { ...memberForm }
    // A blank expiry on a new member means "use this tier's default". Existing
    // members can still deliberately clear the field to create no expiry.
    if (!payload.id && !payload.expires_on) delete payload.expires_on
    const response = await mutate('admin_upsert_member', { p_member: payload }, () => queryMembers(null, 1))
    if (!response.error) setMemberForm(null)
  }
  const saveQuickMember = async (event) => {
    event.preventDefault()
    const response = await mutate('admin_upsert_member', {
      p_member: { ...quickMember, status: 'active', joined_on: dateInput(), metadata: { created_from: 'quick_add' } },
    }, () => queryMembers(null, 1))
    if (!response.error) setQuickMember(emptyQuickMember())
  }
  const saveMemberTier = async (event) => {
    event.preventDefault()
    const payload = {
      ...tierForm,
      benefits: Array.isArray(tierForm.benefits) ? tierForm.benefits : String(tierForm.benefits || '').split('\n').map((item) => item.trim()).filter(Boolean),
    }
    const response = await mutate('admin_upsert_member_tier', { p_tier: payload }, async () => {
      const { data: tiers } = await supabase.rpc('admin_get_member_tiers')
      setMemberTiers(tiers || [])
      await queryMembers(null, 1)
    })
    if (!response.error) setTierForm(null)
  }

  const todayDow = new Date(`${venueNow().dateKey}T12:00:00`).getDay()
  const todayHours = data?.hours?.find((item) => item.day_of_week === todayDow)
  const upcoming = (data?.events || []).filter((item) => item.status === 'scheduled' && item.ends_at?.slice(0, 19) >= venueNow().dateTime)
  const activeRules = (data?.pricing_rules || []).filter((item) => item.is_active)
  const pricingRules = useMemo(() => [...(data?.pricing_rules || [])].sort(comparePricingRuleMatch), [data?.pricing_rules])
  const formatDateTime = (value) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
  const formatDate = (value) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : '—'
  const formatCurrency = (value) => new Intl.NumberFormat(locale, { style: 'currency', currency: settings?.currency || 'CAD' }).format(value || 0)
  const eventLabel = (value) => c[value] || value?.replaceAll('_', ' ') || '—'
  const eventTitle = (item) => language === 'zh' ? item.title_zh : item.title_en
  const priceTitle = (item) => language === 'zh' ? item.name_zh : item.name_en
  const dayLabel = (rule) => {
    const days = pricingDays(rule)
    return days === null ? c.allDays : days.map((day) => c[DAY_KEYS[day]]).join(language === 'zh' ? '、' : ', ')
  }
  const courtLabel = (courtId) => courtId ? (COURTS.find((court) => court.id === courtId)?.[language === 'zh' ? 'name' : 'english'] || c.court) : c.allVenue
  const tierLabel = (tier) => language === 'zh' ? tier.name_zh : tier.name_en
  const selectedMemberTier = (code) => memberTiers.find((tier) => tier.code === code)
  const togglePricingDay = (day) => setPricingForm((current) => {
    const selected = pricingDays(current)
    if (selected === null) return { ...current, days_of_week: [day], day_of_week: day }
    const next = selected.includes(day) ? selected.filter((item) => item !== day) : [...selected, day].sort((left, right) => left - right)
    const days = next.length ? next : null
    return { ...current, days_of_week: days, day_of_week: days?.length === 1 ? days[0] : '' }
  })

  const tabs = [
    ['overview', <Activity size={16} />, c.overview], ['hours', <Clock3 size={16} />, c.hours], ['pricing', <BadgeDollarSign size={16} />, c.pricing],
    ['events', <CalendarClock size={16} />, c.events], ['members', <UsersRound size={16} />, c.members], ['audit', <FileClock size={16} />, c.audit],
  ]

  if (loading && !data) return <main className="operations-page"><div className="operations-loading"><LoaderCircle className="spin" /><span>{c.loading}</span></div></main>

  return <main className="operations-page">
    <header className="operations-hero">
      <div><span><Building2 size={14} /> {c.eyebrow}</span><h1>{c.title}</h1><p>{c.subtitle}</p></div>
      <button type="button" onClick={loadOverview} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />{c.refresh}</button>
    </header>
    {error && <div className="operations-error"><CircleAlert size={17} /><span>{error}</span><button onClick={loadOverview}>{c.refresh}</button></div>}

    <nav className="operations-tabs" aria-label={c.title}>
      {tabs.map(([key, icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{icon}<span>{label}</span></button>)}
    </nav>

    {tab === 'overview' && <section className="operations-panel operations-overview">
      <PanelHeader eyebrow={c.operationsSummary} title={settings?.[language === 'zh' ? 'name_zh' : 'name_en'] || c.title} help={c.settingsHelp} />
      <div className="operations-metrics">
        <button onClick={() => setTab('hours')}><Clock3 /><span>{c.todayHours}</span><strong>{todayHours?.is_closed ? c.closed : `${minuteToTime(todayHours?.open_minute ?? 600)}—${minuteToTime(todayHours?.close_minute ?? 1440)}`}</strong></button>
        <button onClick={() => setTab('pricing')}><BadgeDollarSign /><span>{c.activePrices}</span><strong>{activeRules.length}</strong></button>
        <button onClick={() => setTab('events')}><CalendarClock /><span>{c.upcomingEvents}</span><strong>{upcoming.length}</strong></button>
        <button onClick={() => setTab('members')}><UsersRound /><span>{c.activeMembers}</span><strong>{data?.member_summary?.active || 0}</strong></button>
      </div>
      <div className="operations-overview-grid">
        <article className="operations-settings-card">
          <header><div><span>{c.settingsTitle}</span><p>{c.settingsHelp}</p></div><button type="button" onClick={saveSettings} disabled={busy}><Save size={14} />{busy ? c.saving : c.save}</button></header>
          <div className="operations-form-grid compact">
            <label><span>{c.nameZh}</span><input value={settings?.name_zh || ''} onChange={(e) => setSettings({ ...settings, name_zh: e.target.value })} /></label>
            <label><span>{c.nameEn}</span><input value={settings?.name_en || ''} onChange={(e) => setSettings({ ...settings, name_en: e.target.value })} /></label>
            <label><span>{c.timezone}</span><input value={settings?.timezone || ''} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} /></label>
            <label><span>{c.currency}</span><input maxLength="3" value={settings?.currency || ''} onChange={(e) => setSettings({ ...settings, currency: e.target.value.toUpperCase() })} /></label>
            <label><span>{c.bookingWindow}</span><div className="input-unit"><input type="number" min="1" max="365" value={settings?.booking_window_days || 30} onChange={(e) => setSettings({ ...settings, booking_window_days: Number(e.target.value) })} /><small>{c.days}</small></div></label>
            <label><span>{c.slotMinutes}</span><select value={settings?.slot_minutes || 30} onChange={(e) => setSettings({ ...settings, slot_minutes: Number(e.target.value) })}><option value="15">15 {c.minutes}</option><option value="30">30 {c.minutes}</option><option value="60">60 {c.minutes}</option></select></label>
            <label><span>{c.customerMin}</span><div className="input-unit"><input type="number" step="30" min="30" max="480" value={settings?.customer_min_minutes || 60} onChange={(e) => setSettings({ ...settings, customer_min_minutes: Number(e.target.value) })} /><small>{c.minutes}</small></div></label>
            <label><span>{c.customerMax}</span><div className="input-unit"><input type="number" step="30" min="30" max="480" value={settings?.customer_max_minutes || 120} onChange={(e) => setSettings({ ...settings, customer_max_minutes: Number(e.target.value) })} /><small>{c.minutes}</small></div></label>
            <label><span>{c.managerMax}</span><div className="input-unit"><input type="number" step="30" min="30" max="720" value={settings?.manager_max_minutes || 240} onChange={(e) => setSettings({ ...settings, manager_max_minutes: Number(e.target.value) })} /><small>{c.minutes}</small></div></label>
            <label><span>{c.cancelHours}</span><div className="input-unit"><input type="number" min="0" max="168" value={settings?.cancellation_notice_hours ?? 12} onChange={(e) => setSettings({ ...settings, cancellation_notice_hours: Number(e.target.value) })} /><small>{c.hoursUnit}</small></div></label>
          </div>
        </article>
        <article className="operations-next-events">
          <header><span>{c.upcomingEvents}</span><button onClick={() => setTab('events')}>{c.events}<ChevronRight size={14} /></button></header>
          {upcoming.slice(0, 5).map((item) => <button key={item.id} onClick={() => { setEventForm({ ...item, starts_at: item.starts_at.slice(0, 16), ends_at: item.ends_at.slice(0, 16) }); setTab('events') }}>
            <i className={item.color} /><span><strong>{eventTitle(item)}</strong><small>{formatDateTime(item.starts_at)} · {item.court_ids?.length ? `${item.court_ids.length} ${c.court}` : c.allVenue}</small></span><b>{eventLabel(item.event_type)}</b>
          </button>)}
          {!upcoming.length && <div className="operations-empty small"><CalendarClock /><span>{c.noEvents}</span></div>}
        </article>
      </div>
    </section>}

    {tab === 'hours' && <section className="operations-panel">
      <PanelHeader eyebrow={c.hours} title={c.hoursTitle} help={c.hoursHelp} action={<button className="operations-primary" onClick={saveHours} disabled={busy}><Save size={15} />{busy ? c.saving : c.save}</button>} />
      <div className="hours-editor">
        {hours.map((row, index) => <article key={row.day_of_week} className={row.is_closed ? 'closed' : ''}>
          <div className="hours-day"><strong>{c[DAY_KEYS[row.day_of_week]]}</strong><small>{row.is_closed ? c.closed : c.open}</small></div>
          <label className="switch-field"><input type="checkbox" checked={!row.is_closed} onChange={(e) => setHours(hours.map((item, i) => i === index ? { ...item, is_closed: !e.target.checked } : item))} /><span /></label>
          <label><span>{c.from}</span><input type="time" disabled={row.is_closed} value={minuteToTime(row.open_minute)} onChange={(e) => setHours(hours.map((item, i) => i === index ? { ...item, open_minute: timeToMinute(e.target.value) } : item))} /></label>
          <label><span>{c.to}</span><select disabled={row.is_closed} value={row.close_minute} onChange={(e) => setHours(hours.map((item, i) => i === index ? { ...item, close_minute: Number(e.target.value) } : item))}>{Array.from({ length: 29 }, (_, i) => 600 + i * 30).filter((minute) => minute <= 1440).map((minute) => <option key={minute} value={minute}>{minuteToTime(minute)}</option>)}</select></label>
          <label className="hours-note"><span>{c.note}</span><input value={row.label || ''} onChange={(e) => setHours(hours.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} /></label>
        </article>)}
      </div>
    </section>}

    {tab === 'pricing' && <section className="operations-panel">
      <PanelHeader eyebrow={c.pricing} title={c.pricingTitle} help={c.pricingHelp} action={<button className="operations-primary" onClick={() => setPricingForm(emptyPricingRule())}><Plus size={15} />{c.addPrice}</button>} />
      <div className="operations-table-wrap"><table className="operations-table pricing-table"><thead><tr><th>{c.operation}</th><th>{c.court}</th><th>{c.weekday}</th><th>{c.startTime}—{c.endTime}</th><th>{c.memberTier}</th><th>{c.hourlyRate}</th><th>{c.matchOrder}</th><th /></tr></thead><tbody>
        {pricingRules.map((rule) => <tr key={rule.id} className={!rule.is_active ? 'muted' : ''}>
          <td><strong>{priceTitle(rule)}</strong><small>{rule.is_active ? c.active : c.cancelled}</small></td><td>{courtLabel(rule.court_id)}</td><td>{dayLabel(rule)}</td><td>{minuteToTime(rule.start_minute)}—{minuteToTime(rule.end_minute)}</td><td>{rule.member_tier || c.allTiers}</td><td className="money">{formatCurrency(rule.hourly_rate)}</td><td><span className={`pricing-match-level ${pricingRuleLevel(rule)}`}>{c[pricingRuleLevel(rule)]}</span><small>{c.automatic}</small></td>
          <td><div className="row-actions"><button onClick={() => setPricingForm(pricingRuleForForm(rule))} aria-label={c.edit}><Pencil size={14} /></button><button className="danger" onClick={() => deletePricing(rule)} aria-label={c.delete}><Trash2 size={14} /></button></div></td>
        </tr>)}
      </tbody></table></div>
    </section>}

    {tab === 'events' && <section className="operations-panel">
      <PanelHeader eyebrow={c.events} title={c.eventsTitle} help={c.eventsHelp} action={<button className="operations-primary" onClick={() => setEventForm(emptyEvent())}><Plus size={15} />{c.addEvent}</button>} />
      <div className="event-list">
        {(data?.events || []).map((item) => <article key={item.id} className={`${item.status} ${item.color}`}>
          <i /><div className="event-date"><strong>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(item.starts_at))}</strong><small>{item.starts_at.slice(11, 16)}—{item.ends_at.slice(11, 16)}</small></div>
          <div className="event-main"><span><b>{eventLabel(item.event_type)}</b>{item.blocks_booking && <em>{c.blocksBooking}</em>}</span><h3>{eventTitle(item)}</h3><p>{item.description || '—'}</p><small>{item.court_ids?.length ? item.court_names_zh?.join('、') : c.allVenue}</small></div>
          <div className="event-state"><span>{eventLabel(item.status)}</span>{item.active_booking_conflicts > 0 && <b>{c.conflicts.replace('{{count}}', item.active_booking_conflicts)}</b>}</div>
          <div className="row-actions"><button onClick={() => setEventForm({ ...item, starts_at: item.starts_at.slice(0, 16), ends_at: item.ends_at.slice(0, 16) })}><Pencil size={14} /></button>{item.status !== 'cancelled' && <button className="danger" onClick={() => cancelEvent(item)}><X size={14} /></button>}</div>
        </article>)}
      </div>
    </section>}

    {tab === 'members' && <section className="operations-panel">
      <PanelHeader eyebrow={c.members} title={c.membersTitle} help={c.membersHelp} action={<button className="operations-primary" onClick={() => setMemberForm(emptyMember())}><Plus size={15} />{c.addMember}</button>} />
      <div className="member-command-center">
        <form className="quick-member-card" onSubmit={saveQuickMember}>
          <header><span><UserPlus size={17} /></span><div><h3>{c.quickMember}</h3><p>{c.quickMemberHelp}</p></div></header>
          <div className="quick-member-fields">
            <label><span>{c.memberName}</span><input required value={quickMember.display_name} onChange={(event) => setQuickMember({ ...quickMember, display_name: event.target.value })} /></label>
            <label><span>Phone</span><input value={quickMember.phone} onChange={(event) => setQuickMember({ ...quickMember, phone: event.target.value })} /></label>
            <label><span>Email</span><input type="email" value={quickMember.email} onChange={(event) => setQuickMember({ ...quickMember, email: event.target.value })} /></label>
          </div>
          <fieldset className="quick-tier-picker"><legend>{c.tier}</legend>{memberTiers.filter((tier) => tier.is_active).map((tier) => <button type="button" className={`${tier.color} ${quickMember.tier === tier.code ? 'selected' : ''}`} onClick={() => setQuickMember({ ...quickMember, tier: tier.code })} key={tier.code}><i /> <span><strong>{tierLabel(tier)}</strong><small>{tier.discount_percent}%</small></span>{quickMember.tier === tier.code && <Check size={14} />}</button>)}</fieldset>
          <footer><small>{c.quickContact}</small><button className="operations-primary" disabled={busy}><Plus size={14} />{busy ? c.saving : c.createMember}</button></footer>
        </form>
        <section className="member-tier-system">
          <header><div><h3>{c.tierSystem}</h3><p>{c.tierSystemHelp}</p></div><button type="button" onClick={() => setTierForm(emptyMemberTier((memberTiers.at(-1)?.rank || 40) + 10))}><Plus size={14} />{c.addTier}</button></header>
          <div className="member-tier-cards">{memberTiers.map((tier) => <button type="button" className={`${tier.color} ${tier.is_active ? '' : 'inactive'}`} onClick={() => setTierForm({ ...tier })} key={tier.code}>
            <i /><span><small>{tier.code}</small><strong>{tierLabel(tier)}</strong><em>{c.memberCount.replace('{{count}}', tier.member_count || 0)}</em></span><b>{tier.discount_percent}%</b><Pencil size={13} />
          </button>)}</div>
        </section>
      </div>
      <div className="operations-query-bar">
        <label className="query-search"><Search size={15} /><input value={memberFilters.query} onChange={(e) => setMemberFilters({ ...memberFilters, query: e.target.value })} placeholder={c.searchMember} /></label>
        <label><Filter size={14} /><select value={memberFilters.status} onChange={(e) => setMemberFilters({ ...memberFilters, status: e.target.value })}><option value="all">{c.allStatuses}</option>{MEMBER_STATUSES.map((status) => <option key={status} value={status}>{eventLabel(status)}</option>)}</select></label>
        <label><select value={memberFilters.tier} onChange={(e) => setMemberFilters({ ...memberFilters, tier: e.target.value })}><option value="all">{c.allTiers}</option>{memberTiers.map((tier) => <option key={tier.code} value={tier.code}>{tierLabel(tier)}</option>)}</select></label>
      </div>
      <div className="operations-table-wrap"><table className="operations-table members-table"><thead><tr><th>{c.memberNumber}</th><th>{c.memberName}</th><th>{c.contact}</th><th>{c.tier}</th><th>{c.discount}</th><th>{c.expires}</th><th>{c.statusLabel}</th><th /></tr></thead><tbody>
        {(members.items || []).map((member) => <tr key={member.id}><td><strong>{member.member_number}</strong></td><td>{member.display_name}</td><td><span>{member.phone || '—'}</span><small>{member.email || '—'}</small></td><td><span className={`member-tier-chip ${member.tier_color || 'ink'}`}>{language === 'zh' ? member.tier_name_zh : member.tier_name_en}</span></td><td>{member.discount_percent}%{member.discount_override_percent !== null && <small>{c.customDiscount}</small>}</td><td>{formatDate(member.expires_on)}</td><td><span className={`status-chip ${member.status}`}>{eventLabel(member.status)}</span></td><td><button className="row-edit" onClick={() => setMemberForm(member)}><Pencil size={14} /></button></td></tr>)}
      </tbody></table></div>
      {!members.items?.length && <div className="operations-empty"><UserRoundSearch /><span>{c.noMembers}</span></div>}
      <div className="operations-pagination"><span>{c.total.replace('{{count}}', members.total || 0)} · {c.max50}</span><div><button disabled={memberPage === 1} onClick={() => { const page = memberPage - 1; queryMembers(memberCursorStack[page - 1], page) }}><ChevronLeft />{c.previous}</button><b>{c.page.replace('{{page}}', memberPage)}</b><button disabled={!members.has_more} onClick={() => { const next = members.next_cursor; setMemberCursorStack((stack) => [...stack.slice(0, memberPage), next]); queryMembers(next, memberPage + 1) }}>{c.next}<ChevronRight /></button></div></div>
    </section>}

    {tab === 'audit' && <section className="operations-panel audit-panel">
      <PanelHeader eyebrow={c.audit} title={c.auditTitle} help={c.auditHelp} />
      <div className="audit-presets"><button onClick={() => setAuditFilters({ ...auditFilters, start: dateInput(new Date(Date.now() - 6 * 24 * 60 * 60_000)), end: dateInput() })}>{c.last7}</button><button onClick={() => setAuditFilters({ ...auditFilters, start: dateInput(new Date(Date.now() - 29 * 24 * 60 * 60_000)), end: dateInput() })}>{c.last30}</button></div>
      <div className="operations-query-bar audit-query">
        <label><span>{c.from}</span><input type="date" value={auditFilters.start} max={auditFilters.end} onChange={(e) => setAuditFilters({ ...auditFilters, start: e.target.value })} /></label>
        <label><span>{c.to}</span><input type="date" value={auditFilters.end} min={auditFilters.start} onChange={(e) => setAuditFilters({ ...auditFilters, end: e.target.value })} /></label>
        <label className="query-search"><Search size={15} /><input value={auditFilters.query} onChange={(e) => setAuditFilters({ ...auditFilters, query: e.target.value })} placeholder={c.searchAudit} /></label>
        <label><span>{c.module}</span><select value={auditFilters.eventPrefix} onChange={(e) => setAuditFilters({ ...auditFilters, eventPrefix: e.target.value })}><option value="all">{c.eventPrefixAll}</option>{['booking', 'venue_settings', 'opening_hours', 'pricing_rule', 'venue_event', 'event_court', 'member', 'member_tier'].map((prefix) => <option key={prefix} value={prefix}>{c[prefix] || prefix}</option>)}</select></label>
        <label><span>{c.actor}</span><select value={auditFilters.actorKind} onChange={(e) => setAuditFilters({ ...auditFilters, actorKind: e.target.value })}><option value="all">{c.all}</option><option value="manager">{c.manager}</option><option value="user">{c.user}</option><option value="system">{c.system}</option></select></label>
      </div>
      <div className="audit-list-table">
        <header><span>{c.occurred}</span><span>{c.operation}</span><span>{c.actor}</span><span>{c.entity}</span><span>{c.changed}</span><span /></header>
        {(audit.items || []).map((item) => <button key={item.id} onClick={() => setAuditDetail(item)}>
          <time>{formatDateTime(item.occurred_at)}</time><span><strong>{item.event_type}</strong><small>{item.source}</small></span><span>{item.actor_email || eventLabel(item.actor_kind)}</span><span><b>{c[item.entity_type] || item.entity_type}</b><small>{item.entity_id || '—'}</small></span><span className="changed-fields">{item.changed_fields?.slice(0, 3).map((field) => <i key={field}>{field}</i>)}{item.changed_fields?.length > 3 && <em>+{item.changed_fields.length - 3}</em>}</span><ChevronRight />
        </button>)}
      </div>
      {!audit.items?.length && <div className="operations-empty"><FileClock /><span>{c.empty}</span></div>}
      <div className="operations-pagination"><span>{c.total.replace('{{count}}', audit.total || 0)} · {c.max50}</span><div><button disabled={auditPage === 1} onClick={() => { const page = auditPage - 1; queryAudit(auditCursorStack[page - 1], page) }}><ChevronLeft />{c.previous}</button><b>{c.page.replace('{{page}}', auditPage)}</b><button disabled={!audit.has_more} onClick={() => { const next = audit.next_cursor; setAuditCursorStack((stack) => [...stack.slice(0, auditPage), next]); queryAudit(next, auditPage + 1) }}>{c.next}<ChevronRight /></button></div></div>
    </section>}

    {pricingForm && <Modal title={pricingForm.id ? c.edit : c.addPrice} onClose={() => setPricingForm(null)}><form className="operations-form" onSubmit={savePricing}>
      <div className="operations-form-grid"><div className="pricing-order-preview full"><BadgeDollarSign size={18} /><div><strong>{c.autoMatchTitle}</strong><p>{c.autoMatchHelp}</p></div><span className={`pricing-match-level ${pricingRuleLevel(pricingForm)}`}>{c[pricingRuleLevel(pricingForm)]}</span></div><label><span>{c.ruleNameZh}</span><input required value={pricingForm.name_zh} onChange={(e) => setPricingForm({ ...pricingForm, name_zh: e.target.value })} /></label><label><span>{c.ruleNameEn}</span><input required value={pricingForm.name_en} onChange={(e) => setPricingForm({ ...pricingForm, name_en: e.target.value })} /></label>
        <label><span>{c.court}</span><select value={pricingForm.court_id || ''} onChange={(e) => setPricingForm({ ...pricingForm, court_id: e.target.value })}><option value="">{c.allVenue}</option>{COURTS.map((court) => <option key={court.id} value={court.id}>{language === 'zh' ? court.name : court.english}</option>)}</select></label>
        <fieldset className="pricing-weekday-field"><legend>{c.weekday}</legend><div className="pricing-weekday-options">
          <button type="button" className={pricingDays(pricingForm) === null ? 'active' : ''} aria-pressed={pricingDays(pricingForm) === null} onClick={() => setPricingForm({ ...pricingForm, days_of_week: null, day_of_week: '' })}>{c.allDays}</button>
          {DAY_KEYS.map((day, index) => <button type="button" key={day} className={pricingDays(pricingForm)?.includes(index) ? 'active' : ''} aria-pressed={Boolean(pricingDays(pricingForm)?.includes(index))} onClick={() => togglePricingDay(index)}>{c[day]}</button>)}
        </div></fieldset>
        <label><span>{c.startTime}</span><input type="time" required value={minuteToTime(pricingForm.start_minute)} onChange={(e) => setPricingForm({ ...pricingForm, start_minute: timeToMinute(e.target.value) })} /></label><label><span>{c.endTime}</span><select value={pricingForm.end_minute} onChange={(e) => setPricingForm({ ...pricingForm, end_minute: Number(e.target.value) })}>{Array.from({ length: 48 }, (_, i) => (i + 1) * 30).filter((minute) => minute > pricingForm.start_minute).map((minute) => <option key={minute} value={minute}>{minuteToTime(minute)}</option>)}</select></label>
        <label><span>{c.hourlyRate}</span><input type="number" min="0" step="0.01" required value={pricingForm.hourly_rate} onChange={(e) => setPricingForm({ ...pricingForm, hourly_rate: Number(e.target.value) })} /></label><label><span>{c.memberTier}</span><select value={pricingForm.member_tier || ''} onChange={(e) => setPricingForm({ ...pricingForm, member_tier: e.target.value })}><option value="">{c.allTiers}</option>{memberTiers.filter((tier) => tier.is_active).map((tier) => <option key={tier.code} value={tier.code}>{tierLabel(tier)}</option>)}</select></label>
        <label className="check-field"><input type="checkbox" checked={pricingForm.is_active} onChange={(e) => setPricingForm({ ...pricingForm, is_active: e.target.checked })} /><span>{c.active}</span></label>
        <label><span>{c.from}</span><input type="date" value={pricingForm.valid_from || ''} onChange={(e) => setPricingForm({ ...pricingForm, valid_from: e.target.value })} /></label><label><span>{c.to}</span><input type="date" value={pricingForm.valid_to || ''} onChange={(e) => setPricingForm({ ...pricingForm, valid_to: e.target.value })} /></label>
      </div><footer><button type="button" onClick={() => setPricingForm(null)}>{c.cancel}</button><button className="operations-primary" disabled={busy}><Save size={14} />{busy ? c.saving : c.save}</button></footer>
    </form></Modal>}

    {eventForm && <Modal title={eventForm.id ? c.edit : c.addEvent} onClose={() => setEventForm(null)} wide><form className="operations-form operations-event-form" onSubmit={saveEvent}>
      <div className="operations-form-grid"><div className="event-form-intro full"><span><CalendarClock size={18} /></span><div><strong>{eventForm.id ? c.edit : c.addEvent}</strong><p>{c.eventFormHelp}</p></div></div><label><span>{c.titleZh}</span><input required value={eventForm.title_zh} onChange={(e) => setEventForm({ ...eventForm, title_zh: e.target.value })} /></label><label><span>{c.titleEn}</span><input required value={eventForm.title_en} onChange={(e) => setEventForm({ ...eventForm, title_en: e.target.value })} /></label>
        <label><span>{c.eventType}</span><select value={eventForm.event_type} onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{eventLabel(type)}</option>)}</select></label><label><span>{c.status}</span><select value={eventForm.status} onChange={(e) => setEventForm({ ...eventForm, status: e.target.value })}>{['draft', 'scheduled', 'completed', 'cancelled'].map((status) => <option key={status} value={status}>{eventLabel(status)}</option>)}</select></label>
        <EventDateTimeField label={c.startsAt} value={eventForm.starts_at} locale={locale} c={c} onChange={(value) => setEventForm((current) => ({ ...current, starts_at: value, ends_at: current.ends_at <= value ? addLocalMinutes(value, 60) : current.ends_at }))} />
        <EventDateTimeField label={c.endsAt} value={eventForm.ends_at} minValue={eventForm.starts_at} locale={locale} c={c} onChange={(value) => setEventForm({ ...eventForm, ends_at: value })} />
        <fieldset className="court-checks"><legend>{c.eventCourts}</legend>{COURTS.map((court) => <label key={court.id}><input type="checkbox" checked={eventForm.court_ids?.includes(court.id)} onChange={(e) => setEventForm({ ...eventForm, court_ids: e.target.checked ? [...(eventForm.court_ids || []), court.id] : (eventForm.court_ids || []).filter((id) => id !== court.id) })} /><span>{language === 'zh' ? court.name : court.english}</span></label>)}</fieldset>
        <label className="check-field"><input type="checkbox" checked={eventForm.blocks_booking} onChange={(e) => setEventForm({ ...eventForm, blocks_booking: e.target.checked })} /><span>{c.blocksBooking}</span></label><fieldset className="event-color-picker"><legend>{c.color}</legend>{EVENT_COLORS.map((color) => <label className={eventForm.color === color ? 'selected' : ''} key={color}><input type="radio" name="event-color" value={color} checked={eventForm.color === color} onChange={(e) => setEventForm({ ...eventForm, color: e.target.value })} /><span className={color} /></label>)}</fieldset>
        <label className="full"><span>{c.description}</span><textarea rows="4" value={eventForm.description || ''} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></label>
      </div><footer><button type="button" onClick={() => setEventForm(null)}>{c.cancel}</button><button className="operations-primary" disabled={busy}><Save size={14} />{busy ? c.saving : c.save}</button></footer>
    </form></Modal>}

    {memberForm && <Modal title={memberForm.id ? c.edit : c.addMember} onClose={() => setMemberForm(null)}><form className="operations-form" onSubmit={saveMember}>
      <div className="operations-form-grid"><label><span>{c.memberName}</span><input required value={memberForm.display_name} onChange={(e) => setMemberForm({ ...memberForm, display_name: e.target.value })} /></label><label><span>{c.memberNumber}</span><input value={memberForm.member_number || ''} onChange={(e) => setMemberForm({ ...memberForm, member_number: e.target.value.toUpperCase() })} placeholder="Auto" /></label>
        <label><span>Email</span><input type="email" value={memberForm.email || ''} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} /></label><label><span>Phone</span><input value={memberForm.phone || ''} onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} /></label>
        <label><span>{c.tier}</span><select required value={memberForm.tier} onChange={(e) => setMemberForm({ ...memberForm, tier: e.target.value, discount_percent: selectedMemberTier(e.target.value)?.discount_percent || 0, discount_override_percent: null })}>{memberTiers.filter((tier) => tier.is_active || tier.code === memberForm.tier).map((tier) => <option key={tier.code} value={tier.code}>{tierLabel(tier)}</option>)}</select></label><label><span>{c.statusLabel}</span><select value={memberForm.status} onChange={(e) => setMemberForm({ ...memberForm, status: e.target.value })}>{MEMBER_STATUSES.map((status) => <option key={status} value={status}>{eventLabel(status)}</option>)}</select></label>
        <div className="member-discount-field"><span>{c.discount}</span><label className="inline-check"><input type="checkbox" checked={memberForm.discount_override_percent === null || memberForm.discount_override_percent === undefined} onChange={(e) => setMemberForm({ ...memberForm, discount_override_percent: e.target.checked ? null : Number(memberForm.discount_percent || selectedMemberTier(memberForm.tier)?.discount_percent || 0) })} /><span>{c.useTierDiscount}</span></label><div className="input-unit"><input type="number" min="0" max="100" step="0.01" disabled={memberForm.discount_override_percent === null || memberForm.discount_override_percent === undefined} value={memberForm.discount_override_percent ?? selectedMemberTier(memberForm.tier)?.discount_percent ?? memberForm.discount_percent ?? 0} onChange={(e) => setMemberForm({ ...memberForm, discount_override_percent: Number(e.target.value) })} /><small>%</small></div></div><label><span>{c.joined}</span><input type="date" value={memberForm.joined_on || ''} onChange={(e) => setMemberForm({ ...memberForm, joined_on: e.target.value })} /></label>
        <label><span>{c.expires}</span><input type="date" min={memberForm.joined_on} value={memberForm.expires_on || ''} onChange={(e) => setMemberForm({ ...memberForm, expires_on: e.target.value })} /></label><label className="full"><span>{c.memberNotes}</span><textarea rows="4" value={memberForm.notes || ''} onChange={(e) => setMemberForm({ ...memberForm, notes: e.target.value })} /></label>
      </div><footer><button type="button" onClick={() => setMemberForm(null)}>{c.cancel}</button><button className="operations-primary" disabled={busy}><Save size={14} />{busy ? c.saving : c.save}</button></footer>
    </form></Modal>}

    {tierForm && <Modal title={tierForm.created_at ? c.editTier : c.addTier} onClose={() => setTierForm(null)}><form className="operations-form" onSubmit={saveMemberTier}>
      <div className="operations-form-grid">
        <label><span>{c.tierCode}</span><input required disabled={Boolean(tierForm.created_at)} value={tierForm.code} onChange={(event) => setTierForm({ ...tierForm, code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="gold" /></label>
        <label><span>{c.rank}</span><input required type="number" min="1" max="999" value={tierForm.rank} onChange={(event) => setTierForm({ ...tierForm, rank: Number(event.target.value) })} /></label>
        <label><span>{c.tierNameZh}</span><input required value={tierForm.name_zh} onChange={(event) => setTierForm({ ...tierForm, name_zh: event.target.value })} /></label>
        <label><span>{c.tierNameEn}</span><input required value={tierForm.name_en} onChange={(event) => setTierForm({ ...tierForm, name_en: event.target.value })} /></label>
        <label><span>{c.discount}</span><div className="input-unit"><input required type="number" min="0" max="100" step="0.01" value={tierForm.discount_percent} onChange={(event) => setTierForm({ ...tierForm, discount_percent: Number(event.target.value) })} /><small>%</small></div></label>
        <label><span>{c.validity}</span><div className="input-unit"><input type="number" min="1" max="3650" value={tierForm.default_validity_days ?? ''} onChange={(event) => setTierForm({ ...tierForm, default_validity_days: event.target.value ? Number(event.target.value) : '' })} placeholder={c.permanent} /><small>{c.days}</small></div></label>
        <fieldset className="tier-color-picker full"><legend>{c.tierColor}</legend>{MEMBER_TIER_COLORS.map((color) => <label className={`${color} ${tierForm.color === color ? 'selected' : ''}`} key={color}><input type="radio" name="tier-color" checked={tierForm.color === color} value={color} onChange={(event) => setTierForm({ ...tierForm, color: event.target.value })} /><i /></label>)}</fieldset>
        <label className="full"><span>{c.tierBenefits}</span><textarea rows="4" value={(tierForm.benefits || []).join('\n')} onChange={(event) => setTierForm({ ...tierForm, benefits: event.target.value.split('\n') })} /></label>
        <label className="check-field full"><input type="checkbox" checked={tierForm.is_active} onChange={(event) => setTierForm({ ...tierForm, is_active: event.target.checked })} /><span>{c.activeTier}</span></label>
      </div><footer><button type="button" onClick={() => setTierForm(null)}>{c.cancel}</button><button className="operations-primary" disabled={busy}><Save size={14} />{busy ? c.saving : c.save}</button></footer>
    </form></Modal>}

    {auditDetail && <Modal title={auditDetail.event_type} onClose={() => setAuditDetail(null)} wide><div className="audit-detail">
      <dl><div><dt>{c.occurred}</dt><dd>{formatDateTime(auditDetail.occurred_at)}</dd></div><div><dt>{c.actor}</dt><dd>{auditDetail.actor_email || eventLabel(auditDetail.actor_kind)}</dd></div><div><dt>{c.operationId}</dt><dd>{auditDetail.operation_id}</dd></div><div><dt>{c.source}</dt><dd>{auditDetail.source}</dd></div><div className="full"><dt>{c.changed}</dt><dd>{auditDetail.changed_fields?.join(', ') || '—'}</dd></div></dl>
      <div className="audit-json-grid"><section><h3>{c.before}</h3><pre>{JSON.stringify(auditDetail.before_state, null, 2) || 'null'}</pre></section><section><h3>{c.after}</h3><pre>{JSON.stringify(auditDetail.after_state, null, 2) || 'null'}</pre></section></div>
      <section className="audit-metadata"><h3>{c.metadata}</h3><pre>{JSON.stringify(auditDetail.metadata, null, 2)}</pre></section>
    </div></Modal>}
  </main>
}
