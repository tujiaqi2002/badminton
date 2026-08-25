import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, CalendarDays, CircleUserRound, Clock3, Gauge, MapPin, Radio, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import AdminCapacity from './components/AdminCapacity'
import AdminBookings from './components/AdminBookings'
import AuthModal from './components/AuthModal'
import BookingBoard from './components/BookingBoard'
import BookingDrawer from './components/BookingDrawer'
import DateStrip from './components/DateStrip'
import Header from './components/Header'
import MyBookings from './components/MyBookings'
import { ADMIN_ACCESS_STATUS, authRedirectUrl, checkAdminAccess, shouldFetchSchedule } from './lib/authAccess'
import { addDays, addMinutes, bookingDurations, COURTS, customerSlotsFromConfiguration, demoSchedule, isPastSlot, mondayOfWeek, openingHoursForDate, overlaps, priceBreakdownFromConfiguration, setVenueTimezone, slotDateTime, toDateKey, venueNow } from './lib/booking'
import { buildBookingRelationship, bookingGroupKey } from './lib/bookingRelationships'
import { useI18n } from './lib/i18n'
import { runReservationScheduleShadow } from './lib/reservationReadShadow'
import { googleAuthEnabled, isSupabaseConfigured, reservationReadShadowEnabled, stagingPasswordAuthEnabled, stripeEnabled, supabase } from './lib/supabase'
import { useTheme } from './lib/theme'

const getAuthRedirectUrl = () => authRedirectUrl({
  siteUrl: import.meta.env.VITE_SITE_URL,
  baseUrl: import.meta.env.BASE_URL,
  currentUrl: window.location.href,
})
const todayKey = () => venueNow().dateKey
const VenueOperations = lazy(() => import('./components/VenueOperations'))
const defaultAdminOrderFilters = () => ({
  start: todayKey(),
  end: todayKey(),
  query: '',
  bookingStatus: 'not_cancelled',
  paymentStatus: 'all',
})

const emptyAdminOrderSummary = { results: 0, total_minutes: 0, customers: 0, today: 0 }
const defaultAdminOrderPagination = () => ({
  page: 1,
  cursor: null,
  cursors: [null],
  hasMore: false,
  nextCursor: null,
})

const filterDemoAdminOrders = (bookings, filters) => {
  const normalizedQuery = filters.query.trim().toLowerCase()
  return bookings.filter((booking) => {
    const bookingDate = booking.start_at.slice(0, 10)
    const court = COURTS.find((item) => item.id === booking.court_id)
    const matchesQuery = !normalizedQuery || [
      booking.customer_name,
      booking.customer_email,
      booking.customer_phone,
      booking.customer_notes,
      court?.name,
      court?.english,
      court?.note,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery))
    const matchesBookingStatus = filters.bookingStatus === 'all'
      || (filters.bookingStatus === 'not_cancelled' && booking.status !== 'cancelled')
      || booking.status === filters.bookingStatus
    const matchesPaymentStatus = filters.paymentStatus === 'all'
      || (filters.paymentStatus === 'unpaid' && ['pending', 'pay_at_venue'].includes(booking.payment_status))
      || booking.payment_status === filters.paymentStatus
    return bookingDate >= filters.start
      && bookingDate <= filters.end
      && matchesQuery
      && matchesBookingStatus
      && matchesPaymentStatus
  }).sort((left, right) => left.start_at.localeCompare(right.start_at) || left.id.localeCompare(right.id))
}

const cancellationErrorMessage = (message = '', t, hours = 12) => {
  if (message.includes('within 12 hours') || message.includes('cancellation window')) return t('errors.cancelWindowDynamic', { hours })
  if (message.includes('does not belong to you')) return t('errors.notOwner')
  if (message.includes('no longer active')) return t('errors.inactive')
  if (message.includes('Manager access required')) return t('errors.managerRequired')
  if (message.includes('Booking not found')) return t('errors.bookingNotFound')
  return t('errors.cancel')
}

const rescheduleErrorMessage = (message = '', t) => {
  if (message.includes('already booked')) return t('errors.slotTaken')
  if (message.includes('No pricing rule covers')) return t('errors.noPricing')
  if (message.includes('already started') || message.includes('start time and court are locked')) return t('errors.inProgressMove')
  if (message.includes('at least 30 minutes') || message.includes('end after the current time')) return t('errors.inProgressEnd')
  if (message.includes('already ended')) return t('errors.endedBooking')
  return t('errors.adminReschedule')
}

const validateActiveBookingChange = (booking, startAt, endAt, courtId, t, historyLocked = true) => {
  const current = venueNow()
  if (!historyLocked && booking.start_at <= current.dateTime) return null
  if (booking.end_at <= current.dateTime) return t('errors.endedBooking')
  if (booking.start_at > current.dateTime) return null
  if (startAt !== booking.start_at || courtId !== booking.court_id) return t('errors.inProgressMove')
  if (endAt <= venueNow().dateTime) return t('errors.inProgressEnd')
  return null
}

export default function App() {
  const { courtName, language, t } = useI18n()
  const { themeDefinition } = useTheme()
  const heroKey = themeDefinition.heroKey || 'hero'
  const [view, setView] = useState('book')
  const [operationsInitialTab, setOperationsInitialTab] = useState('overview')
  const [dateKey, setDateKey] = useState(todayKey)
  const [schedule, setSchedule] = useState(() => demoSchedule(todayKey()))
  const [bookingConfiguration, setBookingConfiguration] = useState(null)
  const [venueOperationsConfiguration, setVenueOperationsConfiguration] = useState(null)
  const [adminScheduleDate, setAdminScheduleDate] = useState(todayKey)
  const [bookings, setBookings] = useState([])
  const [adminBookings, setAdminBookings] = useState([])
  const [adminVenueEvents, setAdminVenueEvents] = useState([])
  const [adminOrderBookings, setAdminOrderBookings] = useState([])
  const [adminOrderSummary, setAdminOrderSummary] = useState(emptyAdminOrderSummary)
  const [adminOrderFilters, setAdminOrderFilters] = useState(defaultAdminOrderFilters)
  const [adminOrderPagination, setAdminOrderPagination] = useState(defaultAdminOrderPagination)
  const [adminRange, setAdminRange] = useState(() => {
    const start = mondayOfWeek(todayKey())
    return { start, end: toDateKey(addDays(new Date(`${start}T12:00:00`), 6)) }
  })
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [adminAccessStatus, setAdminAccessStatus] = useState(ADMIN_ACCESS_STATUS.CHECKING)
  const isAdmin = adminAccessStatus === ADMIN_ACCESS_STATUS.AUTHORIZED
  const adminAccessReady = adminAccessStatus !== ADMIN_ACCESS_STATUS.CHECKING
  const [selection, setSelection] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [loadingAdminBookings, setLoadingAdminBookings] = useState(false)
  const [loadingAdminOrders, setLoadingAdminOrders] = useState(false)
  const [adminCancellingId, setAdminCancellingId] = useState(null)
  const [adminScheduleBusy, setAdminScheduleBusy] = useState(false)
  const [adminUndoDepth, setAdminUndoDepth] = useState(0)
  const [adminAuditOperations, setAdminAuditOperations] = useState([])
  const [loadingAdminAudit, setLoadingAdminAudit] = useState(false)
  const [revertingAuditOperationId, setRevertingAuditOperationId] = useState(null)
  const [adminFocus, setAdminFocus] = useState(null)
  const adminDemoHistory = useRef([])
  const adminOrderRequestRef = useRef(0)
  const adminScheduleShadowAbortRef = useRef(null)
  const adminAccessRequestRef = useRef(0)
  const authUserIdRef = useRef(null)
  const adminLandingUserRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 3600)
  }, [])

  const rememberAdminAction = useCallback((snapshot = null) => {
    if (snapshot) adminDemoHistory.current = [...adminDemoHistory.current, snapshot].slice(-5)
    setAdminUndoDepth((current) => Math.min(5, current + 1))
  }, [])

  const fetchSchedule = useCallback(async () => {
    if (!shouldFetchSchedule({
      supabaseConfigured: isSupabaseConfigured,
      authReady,
      user,
      isAdmin,
    })) {
      setLoadingSchedule(false)
      return
    }
    if (!isSupabaseConfigured) {
      setSchedule((current) => {
        const userMade = current.filter((item) => item.id.startsWith('local-') && item.start_at.startsWith(dateKey))
        return [...demoSchedule(dateKey), ...userMade]
      })
      return
    }
    setLoadingSchedule(true)
    const { data, error } = await supabase
      .from('court_slots')
      .select('id, court_id, start_at, end_at, status')
      .lt('start_at', `${dateKey}T23:59:59`)
      .gt('end_at', `${dateKey}T00:00:00`)
      .in('status', ['held', 'confirmed'])
      .order('start_at')
    setLoadingSchedule(false)
    if (error) notify(t('errors.schedule'), 'error')
    else setSchedule(data || [])
  }, [authReady, dateKey, isAdmin, notify, t, user])

  const fetchBookingConfiguration = useCallback(async () => {
    if (!isSupabaseConfigured || !user) { setBookingConfiguration(null); return }
    const { data, error } = await supabase.rpc('get_venue_booking_configuration', { p_date: dateKey })
    if (!error) {
      setVenueTimezone(data?.settings?.timezone)
      setBookingConfiguration(data)
    }
  }, [dateKey, user])

  const fetchBookings = useCallback(async () => {
    if (!user) return setBookings([])
    if (!isSupabaseConfigured) return
    setLoadingBookings(true)
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('user_id', user.id)
      .order('start_at', { ascending: false })
    setLoadingBookings(false)
    if (error) notify(t('errors.myBookings'), 'error')
    else setBookings(data || [])
  }, [user, notify, t])

  const fetchAdminAccess = useCallback(async () => {
    const requestId = ++adminAccessRequestRef.current
    if (!user) {
      setAdminAccessStatus(ADMIN_ACCESS_STATUS.DENIED)
      return
    }
    if (!isSupabaseConfigured) {
      setAdminAccessStatus(ADMIN_ACCESS_STATUS.AUTHORIZED)
      return
    }
    setAdminAccessStatus(ADMIN_ACCESS_STATUS.CHECKING)

    const result = await checkAdminAccess({
      expectedUserId: user.id,
      getSession: async () => {
        const { data, error } = await supabase.auth.getSession()
        return { session: data?.session || null, error }
      },
      getVerifiedUser: async (accessToken) => {
        const { data, error } = await supabase.auth.getUser(accessToken)
        return { user: data?.user || null, error }
      },
      getStaffRole: async (userId) => {
        const { data, error, status } = await supabase
          .from('staff_members')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle()
        return { data, error, status }
      },
      isCurrent: () => adminAccessRequestRef.current === requestId,
    })

    if (adminAccessRequestRef.current !== requestId || result.status === 'stale') return
    setAdminAccessStatus(result.status)
  }, [user])

  const fetchVenueOperationsConfiguration = useCallback(async () => {
    if (!user || !isAdmin || !isSupabaseConfigured) {
      setVenueOperationsConfiguration(null)
      return
    }
    const { data, error } = await supabase.rpc('admin_get_venue_operations')
    if (error) notify(t('errors.schedule'), 'error')
    else {
      setVenueTimezone(data?.settings?.timezone)
      setVenueOperationsConfiguration(data)
    }
  }, [isAdmin, notify, t, user])

  const handleVenueOperationsConfiguration = useCallback((configuration) => {
    setVenueTimezone(configuration?.settings?.timezone)
    setVenueOperationsConfiguration(configuration)
  }, [])

  const fetchAdminBookings = useCallback(async () => {
    if (!user || !isAdmin) {
      setAdminBookings([])
      setAdminVenueEvents([])
      return
    }
    if (!isSupabaseConfigured) return
    setLoadingAdminBookings(true)
    const monitorStart = mondayOfWeek(adminRange.start)
    const monitorEnd = toDateKey(addDays(new Date(`${monitorStart}T12:00:00`), 6))
    const queryStart = monitorStart < adminRange.start ? monitorStart : adminRange.start
    const queryEnd = monitorEnd > adminRange.end ? monitorEnd : adminRange.end
    const endExclusive = toDateKey(addDays(new Date(`${queryEnd}T12:00:00`), 1))
    const pageSize = 1000
    const data = []
    let error = null

    for (let from = 0; ; from += pageSize) {
      const result = await supabase
        .from('bookings')
        .select('id, reservation_id, session_id, booking_group_id, booking_link_id, recurrence_series_id, recurrence_week, user_id, court_id, customer_name, customer_email, customer_phone, customer_notes, start_at, end_at, status, payment_status, payment_method, total_amount, currency, system_calculated_amount, price_source, price_override_amount, party_size, created_at, updated_at')
        .gte('start_at', `${queryStart}T00:00:00`)
        .lt('start_at', `${endExclusive}T00:00:00`)
        .order('start_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
      if (result.error) {
        error = result.error
        break
      }
      data.push(...(result.data || []))
      if ((result.data?.length || 0) < pageSize) break
    }

    const eventResult = await supabase.rpc('admin_get_venue_schedule_events', {
      p_start_date: queryStart,
      p_end_date: queryEnd,
    })
    setLoadingAdminBookings(false)
    if (error) notify(t('errors.adminBookings'), 'error')
    else setAdminBookings(data)
    if (eventResult.error) {
      setAdminVenueEvents([])
      notify(t('errors.schedule'), 'error')
    } else setAdminVenueEvents(eventResult.data || [])

    if (reservationReadShadowEnabled && !error) {
      adminScheduleShadowAbortRef.current?.abort()
      const controller = new AbortController()
      adminScheduleShadowAbortRef.current = controller
      void runReservationScheduleShadow({
        client: supabase,
        legacyRows: data,
        startDate: queryStart,
        endDate: queryEnd,
        timeZone: venueOperationsConfiguration?.settings?.timezone || 'America/Toronto',
        signal: controller.signal,
      }).finally(() => {
        if (adminScheduleShadowAbortRef.current === controller) adminScheduleShadowAbortRef.current = null
      })
    }
  }, [adminRange, isAdmin, user, notify, t, venueOperationsConfiguration])

  const fetchAdminOrderBookings = useCallback(async () => {
    const requestId = adminOrderRequestRef.current + 1
    adminOrderRequestRef.current = requestId
    if (!user || !isAdmin) {
      setLoadingAdminOrders(false)
      setAdminOrderBookings([])
      setAdminOrderSummary(emptyAdminOrderSummary)
      setAdminOrderPagination(defaultAdminOrderPagination())
      return
    }
    if (!isSupabaseConfigured) {
      const matches = filterDemoAdminOrders(adminBookings, adminOrderFilters)
      const from = (adminOrderPagination.page - 1) * 50
      const items = matches.slice(from, from + 50)
      const today = todayKey()
      setAdminOrderBookings(items)
      setAdminOrderSummary({
        results: matches.length,
        total_minutes: matches.reduce((sum, booking) => sum + Math.round((new Date(booking.end_at) - new Date(booking.start_at)) / 60_000), 0),
        customers: new Set(matches.map((booking) => booking.customer_email || booking.customer_phone || booking.customer_name)).size,
        today: matches.filter((booking) => booking.start_at.startsWith(today)).length,
      })
      setAdminOrderPagination((current) => ({
        ...current,
        hasMore: from + items.length < matches.length,
        nextCursor: from + items.length < matches.length ? { offset: from + items.length } : null,
      }))
      return
    }
    setLoadingAdminOrders(true)
    const { data, error } = await supabase.rpc('admin_search_bookings', {
      p_start_date: adminOrderFilters.start,
      p_end_date: adminOrderFilters.end,
      p_query: adminOrderFilters.query,
      p_booking_status: adminOrderFilters.bookingStatus,
      p_payment_status: adminOrderFilters.paymentStatus,
      p_limit: 50,
      p_after_start_at: adminOrderPagination.cursor?.start_at || null,
      p_after_id: adminOrderPagination.cursor?.id || null,
    })
    if (requestId !== adminOrderRequestRef.current) return
    setLoadingAdminOrders(false)
    if (error) {
      notify(t('errors.adminOrderSearch'), 'error')
      return
    }
    setAdminOrderBookings(data?.items || [])
    setAdminOrderSummary(data?.summary || emptyAdminOrderSummary)
    setAdminOrderPagination((current) => ({
      ...current,
      hasMore: Boolean(data?.has_more),
      nextCursor: data?.next_cursor || null,
    }))
  }, [adminBookings, adminOrderFilters, adminOrderPagination.cursor, adminOrderPagination.page, isAdmin, notify, t, user])

  const changeAdminOrderFilters = useCallback((updater) => {
    setAdminOrderPagination(defaultAdminOrderPagination())
    setAdminOrderFilters(updater)
  }, [])

  const showNextAdminOrderPage = useCallback(() => {
    setAdminOrderPagination((current) => {
      if (!current.hasMore || !current.nextCursor) return current
      const cursors = [...current.cursors.slice(0, current.page), current.nextCursor]
      return {
        page: current.page + 1,
        cursor: current.nextCursor,
        cursors,
        hasMore: false,
        nextCursor: null,
      }
    })
  }, [])

  const showPreviousAdminOrderPage = useCallback(() => {
    setAdminOrderPagination((current) => {
      if (current.page <= 1) return current
      const page = current.page - 1
      return {
        ...current,
        page,
        cursor: current.cursors[page - 1] || null,
        hasMore: false,
        nextCursor: null,
      }
    })
  }, [])

  const fetchAdminAuditOperations = useCallback(async () => {
    if (!user || !isAdmin) {
      setAdminAuditOperations([])
      setAdminUndoDepth(0)
      return
    }
    if (!isSupabaseConfigured) return
    setLoadingAdminAudit(true)
    const { data, error } = await supabase.rpc('admin_list_recent_audit_operations', { p_limit: 10 })
    setLoadingAdminAudit(false)
    if (error) {
      notify(t('errors.adminAudit'), 'error')
      return
    }
    const operations = data || []
    setAdminAuditOperations(operations)
    setAdminUndoDepth(operations.slice(0, 5).filter((operation) => operation.can_undo).length)
  }, [isAdmin, notify, t, user])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthReady(true)
      setAdminAccessStatus(ADMIN_ACCESS_STATUS.DENIED)
      return
    }
    const applySession = (session) => {
      const nextUser = session?.user || null
      const nextUserId = nextUser?.id || null
      const identityChanged = authUserIdRef.current !== nextUserId
      authUserIdRef.current = nextUserId
      setUser((current) => (
        current?.id === nextUserId && current?.email === nextUser?.email ? current : nextUser
      ))
      if (identityChanged) {
        adminAccessRequestRef.current += 1
        setAdminAccessStatus(nextUser ? ADMIN_ACCESS_STATUS.CHECKING : ADMIN_ACCESS_STATUS.DENIED)
      } else if (!nextUser) {
        setAdminAccessStatus(ADMIN_ACCESS_STATUS.DENIED)
      }
      setAuthReady(true)
    }
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => { fetchSchedule() }, [fetchSchedule])
  useEffect(() => { if (view === 'book' || view === 'mine') fetchBookingConfiguration() }, [view, fetchBookingConfiguration])
  useEffect(() => { if (view === 'mine') fetchBookings() }, [view, fetchBookings])
  useEffect(() => {
    fetchAdminAccess()
    return () => { adminAccessRequestRef.current += 1 }
  }, [fetchAdminAccess])
  useEffect(() => { fetchVenueOperationsConfiguration() }, [fetchVenueOperationsConfiguration])
  useEffect(() => { if (view === 'admin' || view === 'capacity') fetchAdminBookings() }, [view, fetchAdminBookings])
  useEffect(() => { if (view === 'admin') fetchAdminOrderBookings() }, [view, fetchAdminOrderBookings])
  useEffect(() => { if (view === 'admin') fetchAdminAuditOperations() }, [view, fetchAdminAuditOperations])
  useEffect(() => {
    if (!user) {
      adminLandingUserRef.current = null
      return
    }
    if (!adminAccessReady || !isAdmin || adminLandingUserRef.current === user.id) return
    adminLandingUserRef.current = user.id
    setView('admin')
  }, [adminAccessReady, isAdmin, user])
  useEffect(() => {
    if (view !== 'admin') return
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }, [view])
  useEffect(() => {
    if ((view === 'admin' || view === 'capacity' || view === 'operations') && adminAccessStatus === ADMIN_ACCESS_STATUS.DENIED) setView('mine')
  }, [view, adminAccessStatus])

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !isAdmin) return undefined
    const channel = supabase
      .channel('public-court-schedule')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'court_slots' }, fetchSchedule)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchSchedule, isAdmin, user])
  useEffect(() => () => adminScheduleShadowAbortRef.current?.abort(), [])

  const openSelection = (slot) => {
    if (isPastSlot(slot.dateKey, slot.time)) {
      notify(t('errors.pastTime'), 'error')
      return
    }
    const durations = bookingDurations(bookingConfiguration)
    setSelection({
      ...slot,
      courts: [slot.court],
      duration: durations[0] || 60,
      partySize: 2,
      paymentMethod: 'venue',
      phone: '',
      notes: '',
      set: (change) => setSelection((current) => ({ ...current, ...change })),
    })
  }

  const selectedInterval = useMemo(() => {
    if (!selection) return null
    const start = slotDateTime(selection.dateKey, selection.time)
    return { start, end: addMinutes(start, selection.duration) }
  }, [selection])

  const configuredSchedule = useMemo(() => {
    const eventBlocks = (bookingConfiguration?.blocked_intervals || []).flatMap((event) => {
      const courtIds = event.court_ids?.length ? event.court_ids : COURTS.map((court) => court.id)
      return courtIds.map((courtId) => ({
        id: `event-${event.id}-${courtId}`, court_id: courtId,
        start_at: event.start_at, end_at: event.end_at, status: 'confirmed', venue_event: true,
      }))
    })
    return [...schedule, ...eventBlocks]
  }, [bookingConfiguration, schedule])
  const bookingSlots = useMemo(() => customerSlotsFromConfiguration(bookingConfiguration), [bookingConfiguration])
  const adminScheduleConfiguration = useMemo(() => ({
    settings: venueOperationsConfiguration?.settings || {},
    opening_hours: openingHoursForDate(venueOperationsConfiguration, adminScheduleDate),
    pricing_rules: venueOperationsConfiguration?.pricing_rules || [],
  }), [adminScheduleDate, venueOperationsConfiguration])
  const venueName = bookingConfiguration?.settings?.[language === 'zh' ? 'name_zh' : 'name_en']
    || venueOperationsConfiguration?.settings?.[language === 'zh' ? 'name_zh' : 'name_en']
    || t('venue.name')
  const configuredHours = bookingConfiguration?.opening_hours
  const venueHours = configuredHours?.is_closed
    ? t('board.closed')
    : configuredHours
      ? t('board.openingHoursDynamic', {
        start: `${String(Math.floor(configuredHours.open_minute / 60)).padStart(2, '0')}:${String(configuredHours.open_minute % 60).padStart(2, '0')}`,
        end: configuredHours.close_minute === 1440 ? '24:00' : `${String(Math.floor(configuredHours.close_minute / 60)).padStart(2, '0')}:${String(configuredHours.close_minute % 60).padStart(2, '0')}`,
      })
      : t('venue.hours')

  const selectionConflicts = selectedInterval && configuredSchedule.some(
    (item) => (selection.courts || [selection.court]).some((court) => court.id === item.court_id)
      && overlaps(selectedInterval.start, selectedInterval.end, item.start_at, item.end_at),
  )
  const selectionOutsideHours = selectedInterval && (() => {
    const hours = bookingConfiguration?.opening_hours
    if (!hours) return selectedInterval.start.slice(11, 16) < '10:00'
      || new Date(selectedInterval.end).getTime() > new Date(`${selection.dateKey}T24:00:00`).getTime()
    const startMinute = Number(selection.time.slice(0, 2)) * 60 + Number(selection.time.slice(3, 5))
    return hours.is_closed || startMinute < hours.open_minute || startMinute + selection.duration > hours.close_minute
  })()
  const selectionPast = selection && isPastSlot(selection.dateKey, selection.time)
  const selectionInvalid = Boolean(selectionConflicts || selectionOutsideHours || selectionPast)

  const confirmBooking = async (details) => {
    if (!user) {
      setShowAuth(true)
      return
    }
    const selectedCourts = (details.courts || [details.court]).filter(Boolean)
    if (!selectedCourts.length) {
      notify(t('drawer.courtRequiredHelp'), 'error')
      return
    }
    if (selectionInvalid) {
      notify(t(selectionPast ? 'errors.pastTime' : selectionOutsideHours ? 'errors.outsideHours' : 'errors.overlap'), 'error')
      return
    }

    const startAt = slotDateTime(details.dateKey, details.time)
    const endAt = addMinutes(startAt, details.duration)
    if (!details.phone?.trim()) {
      notify(t('drawer.phoneRequired'), 'error')
      return
    }
    setBusy(true)

    if (!isSupabaseConfigured) {
      const groupId = `local-group-${Date.now()}`
      const created = selectedCourts.map((court, index) => ({
        id: `local-${Date.now()}-${index}`, booking_group_id: groupId,
        court_id: court.id,
        start_at: startAt,
        end_at: endAt,
        status: 'confirmed',
        payment_status: 'pay_at_venue',
        total_amount: details.price / selectedCourts.length,
        party_size: details.partySize,
        customer_phone: details.phone,
        customer_notes: details.notes || null,
        created_at: new Date().toISOString(),
      }))
      setSchedule((current) => [...current, ...created])
      setBookings((current) => [...created, ...current])
      setBusy(false)
      setSelection(null)
      notify(t('success.demoBooking'))
      return
    }

    const { data, error } = await supabase.rpc('create_multi_booking', {
      p_court_ids: selectedCourts.map((court) => court.id),
      p_start_at: startAt,
      p_end_at: endAt,
      p_customer_phone: details.phone,
      p_customer_notes: details.notes || null,
      p_party_size: details.partySize,
      p_payment_method: details.paymentMethod,
    })

    if (error) {
      setBusy(false)
      notify(t(error.message.includes('already booked') ? 'errors.slotTaken' : error.message.includes('No pricing rule covers') ? 'errors.noPricing' : 'errors.booking'), 'error')
      await fetchSchedule()
      return
    }

    if (details.paymentMethod === 'stripe') {
      const bookingId = data?.[0]?.id || data?.id
      const bookingIds = Array.isArray(data) ? data.map((item) => item.id) : [bookingId]
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('create-checkout', { body: { bookingId, bookingIds } })
      if (checkoutError || !checkout?.url) {
        setBusy(false)
        notify(t('errors.checkout'), 'error')
        return
      }
      window.location.assign(checkout.url)
      return
    }

    setBusy(false)
    setSelection(null)
    notify(t('success.booking'))
    await Promise.all([fetchSchedule(), fetchBookings()])
  }

  const cancelBooking = async (booking) => {
    if (!window.confirm(t('confirm.cancel'))) return
    if (!isSupabaseConfigured) {
      setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: 'cancelled' } : item))
      setSchedule((current) => current.filter((item) => item.id !== booking.id))
      notify(t('success.cancel'))
      return
    }
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: booking.id })
    if (error) notify(cancellationErrorMessage(error.message, t, bookingConfiguration?.settings?.cancellation_notice_hours), 'error')
    else { notify(t('success.cancel')); await Promise.all([fetchSchedule(), fetchBookings()]) }
  }

  const adminCancelBooking = async (booking) => {
    const court = booking.court_id && COURTS.find((item) => item.id === booking.court_id)
    const bookingLabel = t('confirm.courtLabel', {
      date: booking.start_at.slice(0, 10),
      court: court ? courtName(court) : '',
      start: booking.start_at.slice(11, 16),
      end: booking.end_at.slice(11, 16),
    })
    if (!window.confirm(t('confirm.adminCancel', { name: booking.customer_name, label: bookingLabel }))) return

    if (!isSupabaseConfigured) {
      rememberAdminAction({ adminBookings, schedule })
      setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: 'cancelled' } : item))
      setSchedule((current) => current.filter((item) => item.id !== booking.id))
      notify(t('success.adminCancel'))
      return
    }

    setAdminCancellingId(booking.id)
    const { error } = await supabase.rpc('admin_cancel_booking', { p_booking_id: booking.id })
    setAdminCancellingId(null)
    if (error) {
      notify(cancellationErrorMessage(error.message, t), 'error')
      return
    }

    notify(t('success.adminCancel'))
    rememberAdminAction()
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchBookings(), fetchAdminAuditOperations()])
  }

  const adminPreviewBookingPrice = useCallback(async (details) => {
    const startAt = slotDateTime(details.dateKey, details.time)
    const endAt = addMinutes(startAt, details.duration)
    const courtIds = (details.courts || [details.court]).map((court) => court.id)
    const weekCount = details.recurring ? Number(details.weekCount || 2) : 1

    if (!isSupabaseConfigured) {
      const occurrences = Array.from({ length: weekCount }, (_, index) => {
        const breakdown = priceBreakdownFromConfiguration(
          adminScheduleConfiguration,
          courtIds,
          details.time,
          details.duration,
        )
        const perCourt = courtIds.length ? breakdown.total / courtIds.length : 0
        return {
          week: index + 1,
          start_at: addMinutes(startAt, index * 7 * 24 * 60),
          end_at: addMinutes(endAt, index * 7 * 24 * 60),
          member: breakdown.member || { tier: null, discount_percent: 0 },
          courts: courtIds.map((courtId) => ({ court_id: courtId, amount: perCourt })),
          total: breakdown.total,
        }
      })
      return {
        currency: adminScheduleConfiguration?.settings?.currency || 'CAD',
        occurrences,
        first_occurrence_total: occurrences[0]?.total || 0,
        series_total: occurrences.reduce((sum, occurrence) => sum + Number(occurrence.total || 0), 0),
      }
    }

    const { data, error } = await supabase.rpc('admin_preview_booking_price', {
      p_court_ids: courtIds,
      p_start_at: startAt,
      p_end_at: endAt,
      p_customer_email: details.email || null,
      p_customer_phone: details.phone || null,
      p_week_count: weekCount,
    })
    if (error) throw error
    return data
  }, [adminScheduleConfiguration])

  const adminCreateBooking = async (details) => {
    const startAt = slotDateTime(details.dateKey, details.time)
    const endAt = addMinutes(startAt, details.duration)
    if (isPastSlot(details.dateKey, details.time)) {
      notify(t('errors.pastTime'), 'error')
      return false
    }
    if (new Date(endAt).getTime() > new Date(`${details.dateKey}T24:00:00`).getTime()) {
      notify(t('errors.outsideHours'), 'error')
      return false
    }
    if (!isSupabaseConfigured) {
      const weekCount = details.recurring ? Number(details.weekCount || 2) : 1
      const conflicts = []
      for (let week = 0; week < weekCount; week += 1) {
        const occurrenceStart = addMinutes(startAt, week * 7 * 24 * 60)
        const occurrenceEnd = addMinutes(endAt, week * 7 * 24 * 60)
        const unavailable = (details.courts || [details.court]).filter((court) => adminBookings.some((item) => (
          item.court_id === court.id && ['held', 'confirmed'].includes(item.status)
          && overlaps(occurrenceStart, occurrenceEnd, item.start_at, item.end_at)
        )))
        if (unavailable.length) conflicts.push({ startAt: occurrenceStart, courtIds: unavailable.map((court) => court.id) })
      }
      if (conflicts.length) return { conflicts }
      const seriesId = details.recurring ? `local-series-${Date.now()}` : null
      const created = Array.from({ length: weekCount }, (_, week) => {
        const groupId = `local-admin-group-${Date.now()}-${week}`
        const occurrenceStart = addMinutes(startAt, week * 7 * 24 * 60)
        const occurrenceEnd = addMinutes(endAt, week * 7 * 24 * 60)
        return (details.courts || [details.court]).map((court, index) => ({
          id: `local-admin-${Date.now()}-${week}-${index}`, booking_group_id: groupId,
          recurrence_series_id: seriesId, recurrence_week: details.recurring ? week + 1 : null,
          user_id: 'demo-user', court_id: court.id,
          customer_name: details.name, customer_email: details.email || null, customer_phone: details.phone || null,
          customer_notes: details.notes || null, start_at: occurrenceStart, end_at: occurrenceEnd,
          status: 'confirmed', payment_status: 'pay_at_venue', payment_method: 'venue',
          total_amount: details.priceOverrideTotal ?? 28 * details.duration / 60,
          system_calculated_amount: 28 * details.duration / 60,
          price_source: details.priceOverrideTotal == null ? 'system' : 'manager_override',
          price_override_amount: details.priceOverrideTotal == null
            ? null
            : Number(details.priceOverrideTotal) / (details.courts || [details.court]).length,
          party_size: details.partySize,
          created_at: new Date().toISOString(),
        }))
      }).flat()
      rememberAdminAction({ adminBookings, schedule })
      setAdminBookings((current) => [...current, ...created].sort((a, b) => a.start_at.localeCompare(b.start_at)))
      setSchedule((current) => [...current, ...created])
      notify(t(details.recurring ? 'success.adminRecurringCreate' : 'success.adminCreate', { count: weekCount }))
      return { saved: true }
    }
    setAdminScheduleBusy(true)
    const basePayload = {
      p_court_ids: (details.courts || [details.court]).map((court) => court.id),
      p_start_at: startAt,
      p_end_at: endAt,
      p_customer_name: details.name,
      p_customer_email: details.email || null,
      p_customer_phone: details.phone || null,
      p_customer_notes: details.notes || null,
      p_party_size: details.partySize,
      p_price_override_total: details.priceOverrideTotal == null ? null : Number(details.priceOverrideTotal),
    }
    if (details.recurring) {
      const preview = await supabase.rpc('admin_preview_weekly_booking', {
        p_court_ids: basePayload.p_court_ids,
        p_start_at: startAt,
        p_end_at: endAt,
        p_week_count: Number(details.weekCount),
      })
      if (preview.error) {
        setAdminScheduleBusy(false)
        notify(t('errors.adminCreate'), 'error')
        return false
      }
      if (preview.data?.length) {
        setAdminScheduleBusy(false)
        return { conflicts: preview.data.map((item) => ({ startAt: item.occurrence_start_at, courtIds: item.unavailable_court_ids })) }
      }
    }
    const { data: createdRows, error } = await supabase.rpc(details.recurring ? 'admin_create_weekly_booking_with_price' : 'admin_create_multi_booking_with_price', details.recurring
      ? { ...basePayload, p_week_count: Number(details.weekCount) }
      : basePayload)
    setAdminScheduleBusy(false)
    if (error) {
      notify(t(error.message.includes('already booked') ? 'errors.slotTaken' : error.message.includes('No pricing rule covers') ? 'errors.noPricing' : 'errors.adminCreate'), 'error')
      return error.message.includes('unavailable') ? { conflicts: [{ startAt, courtIds: basePayload.p_court_ids }] } : false
    }
    if ((createdRows?.length || 0) > 0) rememberAdminAction()
    notify(t(details.recurring ? 'success.adminRecurringCreate' : 'success.adminCreate', { count: details.weekCount }))
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return { saved: true }
  }

  const adminRescheduleBooking = async (booking, court, time, duration, targetDate) => {
    const startAt = slotDateTime(targetDate, time)
    const endAt = addMinutes(startAt, duration)
    const historyLocked = adminScheduleConfiguration?.settings?.lock_historical_bookings !== false
    const activeChangeError = validateActiveBookingChange(booking, startAt, endAt, court.id, t, historyLocked)
    if (activeChangeError) {
      notify(activeChangeError, 'error')
      return false
    }
    if (booking.start_at > venueNow().dateTime && isPastSlot(targetDate, time)) {
      notify(t('errors.pastTime'), 'error')
      return false
    }
    if (new Date(endAt).getTime() > new Date(`${targetDate}T24:00:00`).getTime()) {
      notify(t('errors.outsideHours'), 'error')
      return false
    }
    if (booking.court_id === court.id && booking.start_at === startAt && booking.end_at === endAt) return { unchanged: true }
    if (!isSupabaseConfigured) {
      rememberAdminAction({ adminBookings, schedule })
      const update = (item) => item.id === booking.id ? {
        ...item,
        __previous: { court_id: item.court_id, start_at: item.start_at, end_at: item.end_at },
        court_id: court.id,
        start_at: startAt,
        end_at: endAt,
      } : item
      setAdminBookings((current) => current.map(update).sort((a, b) => a.start_at.localeCompare(b.start_at)))
      setSchedule((current) => current.map(update))
      notify(t('success.adminReschedule', { name: booking.customer_name }))
      return { saved: true }
    }
    setAdminScheduleBusy(true)
    const { error } = await supabase.rpc('admin_reschedule_booking', {
      p_booking_id: booking.id,
      p_court_id: court.id,
      p_start_at: startAt,
      p_end_at: endAt,
    })
    setAdminScheduleBusy(false)
    if (error) {
      notify(rescheduleErrorMessage(error.message, t), 'error')
      return false
    }
    notify(t('success.adminReschedule', { name: booking.customer_name }))
    rememberAdminAction()
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return { saved: true }
  }

  const adminSwapBookings = async (booking, court, time, targetBookings = [], targetDate) => {
    if (!targetBookings.length) return false
    const targetStartAt = slotDateTime(targetDate, time)
    if (!isSupabaseConfigured) {
      const sourceStartAt = booking.start_at
      const sourceCourtId = booking.court_id
      let cursor = sourceStartAt
      const replacements = new Map()
      rememberAdminAction({ adminBookings, schedule })
      replacements.set(booking.id, {
        ...booking,
        court_id: court.id,
        start_at: targetStartAt,
        end_at: addMinutes(targetStartAt, Math.round((new Date(booking.end_at) - new Date(booking.start_at)) / 60_000)),
      })
      targetBookings.forEach((item) => {
        const minutes = Math.round((new Date(item.end_at) - new Date(item.start_at)) / 60_000)
        replacements.set(item.id, {
          ...item,
          court_id: sourceCourtId,
          start_at: cursor,
          end_at: addMinutes(cursor, minutes),
        })
        cursor = addMinutes(cursor, minutes)
      })
      const update = (item) => replacements.get(item.id) || item
      setAdminBookings((current) => current.map(update).sort((left, right) => left.start_at.localeCompare(right.start_at)))
      setSchedule((current) => current.map(update))
      notify(t('success.adminSwap', { source: booking.customer_name, count: targetBookings.length }))
      return { saved: true }
    }
    setAdminScheduleBusy(true)
    const { error } = await supabase.rpc('admin_swap_booking_schedule', {
      p_source_booking_id: booking.id,
      p_target_court_id: court.id,
      p_target_start_at: targetStartAt,
    })
    setAdminScheduleBusy(false)
    if (error) {
      notify(t(error.message.includes('exactly fill') || error.message.includes('partially') ? 'errors.swapDurationMismatch' : 'errors.adminSwap'), 'error')
      return false
    }
    notify(t('success.adminSwap', { source: booking.customer_name, count: targetBookings.length }))
    rememberAdminAction()
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return { saved: true }
  }

  const adminRescheduleBookingGroup = async (booking, time, duration, targetDate, anchorCourt = null) => {
    const startAt = slotDateTime(targetDate, time)
    const endAt = addMinutes(startAt, duration)
    const historyLocked = adminScheduleConfiguration?.settings?.lock_historical_bookings !== false
    const activeChangeError = validateActiveBookingChange(booking, startAt, endAt, anchorCourt?.id || booking.court_id, t, historyLocked)
    if (activeChangeError) {
      notify(activeChangeError, 'error')
      return false
    }
    if (booking.start_at > venueNow().dateTime && isPastSlot(targetDate, time)) {
      notify(t('errors.pastTime'), 'error')
      return false
    }
    if (new Date(endAt).getTime() > new Date(`${targetDate}T24:00:00`).getTime()) {
      notify(t('errors.outsideHours'), 'error')
      return false
    }
    const groupId = booking.booking_group_id || booking.id
    const sourceCourt = COURTS.find((court) => court.id === booking.court_id)
    if (booking.start_at === startAt && booking.end_at === endAt && (!anchorCourt || anchorCourt.id === sourceCourt?.id)) return { unchanged: true }
    if (!isSupabaseConfigured) {
      const groupRows = adminBookings.filter((item) => (item.booking_group_id || item.id) === groupId)
      const sourceIndex = COURTS.findIndex((court) => court.id === booking.court_id)
      const targetIndex = anchorCourt ? COURTS.findIndex((court) => court.id === anchorCourt.id) : sourceIndex
      const offset = targetIndex - sourceIndex
      if (groupRows.some((item) => {
        const index = COURTS.findIndex((court) => court.id === item.court_id) + offset
        return index < 0 || index >= COURTS.length
      })) {
        notify(t('errors.adminReschedule'), 'error')
        return false
      }
      rememberAdminAction({ adminBookings, schedule })
      const update = (item) => {
        if ((item.booking_group_id || item.id) !== groupId) return item
        const index = COURTS.findIndex((court) => court.id === item.court_id) + offset
        return {
          ...item,
          __previous: { court_id: item.court_id, start_at: item.start_at, end_at: item.end_at },
          court_id: COURTS[index].id,
          start_at: startAt,
          end_at: endAt,
        }
      }
      setAdminBookings((current) => current.map(update).sort((a, b) => a.start_at.localeCompare(b.start_at)))
      setSchedule((current) => current.map(update))
      notify(t('success.adminReschedule', { name: booking.customer_name }))
      return { saved: true }
    }
    setAdminScheduleBusy(true)
    const rpc = anchorCourt ? 'admin_move_booking_group' : 'admin_reschedule_booking_group'
    const payload = { p_booking_id: booking.id, p_start_at: startAt, p_end_at: endAt }
    if (anchorCourt) payload.p_anchor_court_id = anchorCourt.id
    const { error } = await supabase.rpc(rpc, payload)
    setAdminScheduleBusy(false)
    if (error) { notify(rescheduleErrorMessage(error.message, t), 'error'); return false }
    notify(t('success.adminReschedule', { name: booking.customer_name }))
    rememberAdminAction()
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return { saved: true }
  }

  const adminLinkBookings = async (sourceBooking, targetBooking) => {
    const sourceGroupId = sourceBooking.booking_group_id || sourceBooking.id
    const targetGroupId = targetBooking.booking_group_id || targetBooking.id
    if (sourceGroupId === targetGroupId || (sourceBooking.booking_link_id && sourceBooking.booking_link_id === targetBooking.booking_link_id)) {
      notify(t('errors.adminAlreadyLinked'), 'error')
      return false
    }

    if (!isSupabaseConfigured) {
      const linkId = sourceBooking.booking_link_id || targetBooking.booking_link_id || `local-link-${Date.now()}`
      const sourceLinkId = sourceBooking.booking_link_id
      const targetLinkId = targetBooking.booking_link_id
      const update = (item) => {
        const groupId = item.booking_group_id || item.id
        const belongsToEitherGroup = groupId === sourceGroupId || groupId === targetGroupId
        const belongsToEitherLink = (sourceLinkId && item.booking_link_id === sourceLinkId) || (targetLinkId && item.booking_link_id === targetLinkId)
        return belongsToEitherGroup || belongsToEitherLink ? { ...item, booking_link_id: linkId } : item
      }
      const linkedGroupCount = new Set(adminBookings.filter((item) => {
        const groupId = item.booking_group_id || item.id
        return groupId === sourceGroupId || groupId === targetGroupId || (sourceLinkId && item.booking_link_id === sourceLinkId) || (targetLinkId && item.booking_link_id === targetLinkId)
      }).map((item) => item.booking_group_id || item.id)).size
      rememberAdminAction({ adminBookings, schedule })
      setAdminBookings((current) => current.map(update))
      setSchedule((current) => current.map(update))
      notify(t('success.adminLink', { count: linkedGroupCount }))
      return { saved: true, bookingLinkId: linkId }
    }

    setAdminScheduleBusy(true)
    const { data, error } = await supabase.rpc('admin_link_booking_groups', {
      p_source_booking_id: sourceBooking.id,
      p_target_booking_id: targetBooking.id,
    })
    setAdminScheduleBusy(false)
    if (error) {
      notify(t(error.message.includes('already') || error.message.includes('same reservation') ? 'errors.adminAlreadyLinked' : 'errors.adminLink'), 'error')
      return false
    }
    rememberAdminAction()
    notify(t('success.adminLink', { count: data?.[0]?.linked_group_count || 2 }))
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return { saved: true, bookingLinkId: data?.[0]?.booking_link_id }
  }

  const adminLoadBookingRelationship = useCallback(async (booking) => {
    const localRelationship = buildBookingRelationship(adminBookings, booking)
    if (!isSupabaseConfigured) return localRelationship
    const { data, error } = await supabase.rpc('admin_get_booking_relationship', { p_booking_id: booking.id })
    return error ? { ...localRelationship, limited: true } : data
  }, [adminBookings])

  const adminUnlinkBookingGroup = async (bookingId) => {
    const source = adminBookings.find((booking) => booking.id === bookingId)
    if (!source?.booking_link_id) return false
    if (!isSupabaseConfigured) {
      const linkId = source.booking_link_id
      const sourceGroupId = bookingGroupKey(source)
      const linkedGroups = new Set(adminBookings.filter((booking) => booking.booking_link_id === linkId && ['held', 'confirmed'].includes(booking.status)).map(bookingGroupKey))
      const update = (booking) => {
        if (booking.booking_link_id !== linkId) return booking
        if (linkedGroups.size <= 2 || bookingGroupKey(booking) === sourceGroupId) return { ...booking, booking_link_id: null }
        return booking
      }
      rememberAdminAction({ adminBookings, schedule })
      setAdminBookings((current) => current.map(update))
      setSchedule((current) => current.map(update))
      notify(t('success.adminUnlink'))
      return true
    }
    setAdminScheduleBusy(true)
    const { error } = await supabase.rpc('admin_unlink_booking_group', { p_booking_id: bookingId })
    setAdminScheduleBusy(false)
    if (error) {
      notify(t('errors.adminUnlink'), 'error')
      return false
    }
    rememberAdminAction()
    notify(t('success.adminUnlink'))
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return true
  }

  const adminMarkBookingPaid = async (bookingId, scope = 'linked') => {
    const source = adminBookings.find((booking) => booking.id === bookingId)
    if (!source) return false
    if (!isSupabaseConfigured) {
      const sourceGroupId = bookingGroupKey(source)
      const update = (booking) => {
        const belongsToScope = scope === 'linked'
          ? source.booking_link_id && booking.booking_link_id === source.booking_link_id
          : bookingGroupKey(booking) === sourceGroupId
        return belongsToScope && ['held', 'confirmed'].includes(booking.status) ? { ...booking, payment_status: 'paid' } : booking
      }
      rememberAdminAction({ adminBookings, schedule })
      setAdminBookings((current) => current.map(update))
      setSchedule((current) => current.map(update))
      notify(t(scope === 'linked' ? 'success.adminLinkedPaid' : 'success.adminGroupPaid'))
      return true
    }
    setAdminScheduleBusy(true)
    const { error } = await supabase.rpc('admin_mark_booking_paid', { p_booking_id: bookingId, p_scope: scope })
    setAdminScheduleBusy(false)
    if (error) {
      notify(t('errors.adminPayment'), 'error')
      return false
    }
    rememberAdminAction()
    notify(t(scope === 'linked' ? 'success.adminLinkedPaid' : 'success.adminGroupPaid'))
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return true
  }

  const adminUndoBookingChange = async (operationId = null) => {
    if (!operationId && adminUndoDepth < 1) return false
    if (!isSupabaseConfigured) {
      const snapshot = adminDemoHistory.current.pop()
      if (!snapshot) return false
      setAdminBookings(snapshot.adminBookings)
      setSchedule(snapshot.schedule)
      setAdminUndoDepth(adminDemoHistory.current.length)
      notify(t('success.adminUndo'))
      return true
    }
    setAdminScheduleBusy(true)
    if (operationId) setRevertingAuditOperationId(operationId)
    const { error } = operationId
      ? await supabase.rpc('admin_revert_audit_operation', { p_operation_id: operationId })
      : await supabase.rpc('admin_undo_last_booking_action')
    setRevertingAuditOperationId(null)
    setAdminScheduleBusy(false)
    if (error) {
      const reason = error.message.includes('no longer available')
        ? 'errors.adminUndoConflict'
        : error.message.includes('changed_afterwards')
          ? 'errors.adminUndoChanged'
          : 'errors.adminUndo'
      notify(t(reason), 'error')
      await fetchAdminAuditOperations()
      return false
    }
    notify(t('success.adminUndo'))
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchSchedule(), fetchAdminAuditOperations()])
    return true
  }

  const adminRevertAuditOperation = async (operation) => {
    if (!operation?.can_undo || adminScheduleBusy) return false
    if (!window.confirm(t('confirm.adminAuditUndo'))) return false
    return adminUndoBookingChange(operation.operation_id)
  }

  const adminUpdateBookingDetails = async (booking, details) => {
    const groupId = booking.booking_group_id || booking.id
    const update = (item) => (item.booking_group_id || item.id) === groupId ? {
      ...item,
      customer_name: details.name.trim(),
      customer_email: details.email || null,
      customer_phone: details.phone || null,
      customer_notes: details.notes || null,
      payment_status: details.paymentStatus,
    } : item
    if (!isSupabaseConfigured) {
      setAdminBookings((current) => current.map(update))
      notify(t('success.adminDetails'))
      return true
    }
    setAdminScheduleBusy(true)
    const { error } = await supabase.rpc('admin_update_booking_details', {
      p_booking_id: booking.id,
      p_customer_name: details.name.trim(),
      p_customer_email: details.email || null,
      p_customer_phone: details.phone || null,
      p_customer_notes: details.notes || null,
      p_payment_status: details.paymentStatus,
    })
    setAdminScheduleBusy(false)
    if (error) {
      notify(t(error.message.includes('name') ? 'errors.customerName' : 'errors.adminDetails'), 'error')
      return false
    }
    setAdminBookings((current) => current.map(update))
    notify(t('success.adminDetails'))
    await Promise.all([fetchAdminBookings(), fetchAdminOrderBookings(), fetchAdminAuditOperations()])
    return true
  }

  const loginByEmail = async (email) => {
    if (!isSupabaseConfigured) return false
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: getAuthRedirectUrl(), shouldCreateUser: true },
    })
    if (error) {
      const message = error.message.toLowerCase()
      notify(t(message.includes('rate limit')
        ? 'errors.emailRateLimit'
        : message.includes('not been invited') || message.includes('approved manager')
          ? 'errors.restrictedLogin'
          : 'errors.auth'), 'error')
      return false
    }
    return true
  }

  const loginWithGoogle = async () => {
    if (!isSupabaseConfigured || !googleAuthEnabled) return false
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) {
      notify(t('errors.auth'), 'error')
      return false
    }
    return true
  }

  const loginWithPassword = async (email, password) => {
    if (!isSupabaseConfigured || !stagingPasswordAuthEnabled) return false
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      notify(t('errors.stagingAuth'), 'error')
      return false
    }
    return true
  }

  const enterDemo = () => {
    setUser({ id: 'demo-user', email: 'demo@tiger.local' })
    setAdminAccessStatus(ADMIN_ACCESS_STATUS.AUTHORIZED)
    setView('admin')
    const demoCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    setAdminBookings([
      { id: 'demo-anna-one', booking_group_id: 'demo-anna-group', booking_link_id: 'demo-link', user_id: 'demo-user', court_id: COURTS[0].id, customer_name: 'Anna', customer_email: 'anna@example.com', customer_phone: '416-555-0188', customer_notes: 'Please have two rental racquets ready.', start_at: slotDateTime(todayKey(), '10:00'), end_at: slotDateTime(todayKey(), '11:00'), status: 'confirmed', payment_status: 'pay_at_venue', payment_method: 'venue', total_amount: 28, currency: 'CAD', party_size: 4, created_at: demoCreatedAt },
      { id: 'demo-anna-two', booking_group_id: 'demo-anna-group', booking_link_id: 'demo-link', user_id: 'demo-user', court_id: COURTS[1].id, customer_name: 'Anna', customer_email: 'anna@example.com', customer_phone: '416-555-0188', customer_notes: 'Please have two rental racquets ready.', start_at: slotDateTime(todayKey(), '10:00'), end_at: slotDateTime(todayKey(), '11:00'), status: 'confirmed', payment_status: 'pay_at_venue', payment_method: 'venue', total_amount: 28, currency: 'CAD', party_size: 4, created_at: demoCreatedAt },
      { id: 'demo-anna-followup', booking_group_id: 'demo-followup-group', booking_link_id: 'demo-link', user_id: 'demo-user', court_id: COURTS[2].id, customer_name: 'Anna', customer_email: 'anna@example.com', customer_phone: '416-555-0188', customer_notes: null, start_at: slotDateTime(todayKey(), '11:30'), end_at: slotDateTime(todayKey(), '12:30'), status: 'confirmed', payment_status: 'pay_at_venue', payment_method: 'venue', total_amount: 32, currency: 'CAD', party_size: 2, created_at: demoCreatedAt },
      { id: 'demo-ben', booking_group_id: 'demo-ben-group', booking_link_id: null, user_id: 'demo-user', court_id: COURTS[3].id, customer_name: 'Ben', customer_email: 'ben@example.com', customer_phone: '416-555-0142', customer_notes: null, start_at: slotDateTime(todayKey(), '13:00'), end_at: slotDateTime(todayKey(), '14:00'), status: 'confirmed', payment_status: 'pay_at_venue', payment_method: 'venue', total_amount: 28, currency: 'CAD', party_size: 2, created_at: demoCreatedAt },
    ])
    setVenueOperationsConfiguration((current) => current || {
      settings: { currency: 'CAD', slot_minutes: 30, manager_max_minutes: 240, lock_historical_bookings: true, multi_court_drag_mode: 'group' },
      hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({ day_of_week: dayOfWeek, open_minute: 600, close_minute: 1440, is_closed: false })),
      pricing_rules: [],
    })
    setShowAuth(false)
    notify(t('success.demoMode'))
  }

  const signOut = async () => {
    adminAccessRequestRef.current += 1
    if (isSupabaseConfigured && user?.id !== 'demo-user') await supabase.auth.signOut()
    setUser(null)
    setAdminAccessStatus(ADMIN_ACCESS_STATUS.DENIED)
    setAdminBookings([])
    setAdminOrderBookings([])
    setAdminOrderSummary(emptyAdminOrderSummary)
    setAdminOrderFilters(defaultAdminOrderFilters())
    setAdminOrderPagination(defaultAdminOrderPagination())
    setAdminAuditOperations([])
    setAdminUndoDepth(0)
    setView('book')
  }

  const accessLoading = !authReady || (user && adminAccessStatus === ADMIN_ACCESS_STATUS.CHECKING)
  const accessDenied = authReady && user && adminAccessStatus === ADMIN_ACCESS_STATUS.DENIED
  const accessError = authReady && user && adminAccessStatus === ADMIN_ACCESS_STATUS.ERROR
  const accessLocked = authReady && !user

  if (accessLoading || accessDenied || accessError || accessLocked) {
    return (
      <div className="private-login-shell">
        <div className="private-login-brand"><span>虎</span><strong>TIGER</strong><small>{t('auth.privateSubtitle')}</small></div>
        {accessLoading ? (
          <div className="private-login-loading"><Clock3 size={22} className="spin" /><p>{t('auth.checkingAccess')}</p></div>
        ) : accessDenied ? (
          <div className="private-access-denied"><ShieldCheck size={30} /><h1>{t('auth.deniedTitle')}</h1><p>{t('auth.deniedText')}</p><button className="primary-button" onClick={signOut}>{t('account.signOut')}</button></div>
        ) : accessError ? (
          <div className="private-access-denied private-access-error"><ShieldAlert size={30} /><h1>{t('auth.accessErrorTitle')}</h1><p>{t('auth.accessErrorText')}</p><div className="private-access-actions"><button className="primary-button" onClick={fetchAdminAccess}>{t('auth.retryAccess')}</button><button className="outline-button" onClick={signOut}>{t('account.signOut')}</button></div></div>
        ) : (
          <AuthModal onClose={() => {}} onEmail={loginByEmail} onPassword={loginWithPassword} onGoogle={loginWithGoogle} onDemo={enterDemo} demoMode={!isSupabaseConfigured} googleEnabled={googleAuthEnabled} passwordEnabled={stagingPasswordAuthEnabled} locked />
        )}
        {toast && <div className={`toast ${toast.tone}`} role="status">{toast.message}</div>}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Header
        user={user}
        isAdmin={isAdmin}
        view={view}
        onViewChange={(nextView) => {
          if (nextView === 'operations') setOperationsInitialTab('overview')
          setView(nextView)
        }}
        onAuth={() => setShowAuth(true)}
        onSignOut={signOut}
      />

      {view === 'book' ? (
        <main>
          <section className="hero">
            <div className="hero-art" aria-hidden="true" />
            <div className="hero-content">
              <span className="eyebrow"><Sparkles size={13} /> {t(`${heroKey}.eyebrow`)}</span>
              <h1>{t(`${heroKey}.title1`)}<br /><em>{t(`${heroKey}.title2`)}</em></h1>
              <p>{t(`${heroKey}.description`)}</p>
              <div className="hero-actions">
                <a className="primary-button" href="#availability">{t(`${heroKey}.cta`)}</a>
                <span><Radio size={15} /> {t('hero.realtime')}</span>
              </div>
            </div>
            <div className="venue-note"><MapPin size={16} /><span><strong>{venueName}</strong><small>{venueHours}</small></span></div>
          </section>

          <section className="booking-container">
            {!isSupabaseConfigured && (
              <div className="demo-banner"><span>{t('demo.label')}</span> {t('demo.description')}</div>
            )}
            <DateStrip selected={dateKey} onSelect={setDateKey} bookingWindowDays={bookingConfiguration?.settings?.booking_window_days} />
            <BookingBoard dateKey={dateKey} schedule={configuredSchedule} loading={loadingSchedule} onSelect={openSelection} slots={bookingSlots} configuration={bookingConfiguration} />
          </section>

          <section className="ritual-section">
            <div><span className="eyebrow">Simple by design</span><h2>{t('ritual.title')}</h2></div>
            <div className="ritual-steps">
              <article><span>{t('ritual.oneNumber')}</span><h3>{t('ritual.oneTitle')}</h3><p>{t('ritual.oneText')}</p></article>
              <article><span>{t('ritual.twoNumber')}</span><h3>{t('ritual.twoTitle')}</h3><p>{t('ritual.twoText')}</p></article>
              <article><span>{t('ritual.threeNumber')}</span><h3>{t('ritual.threeTitle')}</h3><p>{t('ritual.threeText')}</p></article>
            </div>
          </section>
        </main>
      ) : view === 'admin' && isAdmin ? (
        <AdminBookings
          bookings={adminBookings}
          events={adminVenueEvents}
          loading={loadingAdminBookings}
          orderBookings={adminOrderBookings}
          orderSummary={adminOrderSummary}
          orderFilters={adminOrderFilters}
          onOrderFiltersChange={changeAdminOrderFilters}
          orderPagination={adminOrderPagination}
          onPreviousOrderPage={showPreviousAdminOrderPage}
          onNextOrderPage={showNextAdminOrderPage}
          loadingOrders={loadingAdminOrders}
          startDate={adminRange.start}
          endDate={adminRange.end}
          onRangeChange={setAdminRange}
          onCancel={adminCancelBooking}
          cancellingId={adminCancellingId}
          scheduleBusy={adminScheduleBusy}
          onCreate={adminCreateBooking}
          onPreviewPrice={adminPreviewBookingPrice}
          onReschedule={adminRescheduleBooking}
          onRescheduleGroup={adminRescheduleBookingGroup}
          onSwap={adminSwapBookings}
          onLink={adminLinkBookings}
          onLoadRelationship={adminLoadBookingRelationship}
          onUnlink={adminUnlinkBookingGroup}
          onMarkPaid={adminMarkBookingPaid}
          onUndo={adminUndoBookingChange}
          undoDepth={adminUndoDepth}
          onUpdateDetails={adminUpdateBookingDetails}
          auditOperations={adminAuditOperations}
          auditLoading={loadingAdminAudit}
          auditRevertingId={revertingAuditOperationId}
          onOpenAudit={fetchAdminAuditOperations}
          onViewAuditLog={() => {
            setOperationsInitialTab('audit')
            setView('operations')
          }}
          onRevertAudit={adminRevertAuditOperation}
          focusTarget={adminFocus}
          onClearFocus={() => setAdminFocus(null)}
          configuration={adminScheduleConfiguration}
          onScheduleDateChange={setAdminScheduleDate}
        />
      ) : view === 'capacity' && isAdmin ? (
        <AdminCapacity
          bookings={adminBookings}
          startDate={adminRange.start}
          onRangeChange={setAdminRange}
          configuration={venueOperationsConfiguration}
          events={adminVenueEvents}
          onInspect={(date, time) => {
            const weekStart = mondayOfWeek(date)
            setAdminRange({ start: weekStart, end: toDateKey(addDays(new Date(`${weekStart}T12:00:00`), 6)) })
            setAdminFocus({ date, time, key: Date.now() })
            setView('admin')
          }}
        />
      ) : view === 'operations' && isAdmin ? (
        <Suspense fallback={<main className="operations-page"><div className="operations-loading"><Clock3 className="spin" /><span>{t('auth.checkingAccess')}</span></div></main>}>
          <VenueOperations initialTab={operationsInitialTab} onNotify={notify} onConfigurationLoaded={handleVenueOperationsConfiguration} isDemo={user?.id === 'demo-user'} demoConfiguration={venueOperationsConfiguration} />
        </Suspense>
      ) : (
        <MyBookings user={user} bookings={bookings} loading={loadingBookings} onLogin={() => setShowAuth(true)} onCancel={cancelBooking} configuration={bookingConfiguration || venueOperationsConfiguration} />
      )}

      <footer><div className="footer-brand">TIGER <span>{t('footer.subtitle')}</span></div><p>{t('footer.motto')}</p><small>© {new Date().getFullYear()} Tiger Badminton Club</small></footer>

      <nav className={`mobile-bottom-nav ${isAdmin ? 'admin-mobile-nav' : ''}`} aria-label={t('nav.mobile')}>
        <button className={view === 'book' ? 'active' : ''} onClick={() => setView('book')}><CalendarDays size={20} /><span>{t('nav.courts')}</span></button>
        <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}><CircleUserRound size={20} /><span>{t('nav.myShort')}</span></button>
        {isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><ShieldCheck size={20} /><span>{t('nav.adminShort')}</span></button>}
        {isAdmin && <button className={view === 'capacity' ? 'active' : ''} onClick={() => setView('capacity')}><Gauge size={20} /><span>{t('nav.capacityShort')}</span></button>}
        {isAdmin && <button className={view === 'operations' ? 'active' : ''} onClick={() => { setOperationsInitialTab('overview'); setView('operations') }}><Building2 size={20} /><span>{t('nav.operationsShort')}</span></button>}
        <button onClick={() => view === 'book' && document.getElementById('availability')?.scrollIntoView({ behavior: 'smooth' })}><Clock3 size={20} /><span>{t('nav.slots')}</span></button>
      </nav>

      <BookingDrawer selection={selection} onClose={() => setSelection(null)} onConfirm={confirmBooking} busy={busy} stripeEnabled={stripeEnabled} invalid={selectionInvalid} configuration={bookingConfiguration} />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onEmail={loginByEmail} onPassword={loginWithPassword} onGoogle={loginWithGoogle} onDemo={enterDemo} demoMode={!isSupabaseConfigured} googleEnabled={googleAuthEnabled} passwordEnabled={stagingPasswordAuthEnabled} />}
      {toast && <div className={`toast ${toast.tone}`} role="status">{toast.message}</div>}
    </div>
  )
}
