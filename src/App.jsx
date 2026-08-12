import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CircleUserRound, Clock3, MapPin, Radio, ShieldCheck, Sparkles } from 'lucide-react'
import AdminBookings from './components/AdminBookings'
import AuthModal from './components/AuthModal'
import BookingBoard from './components/BookingBoard'
import BookingDrawer from './components/BookingDrawer'
import DateStrip from './components/DateStrip'
import Header from './components/Header'
import MyBookings from './components/MyBookings'
import { addDays, addMinutes, COURTS, demoSchedule, overlaps, slotDateTime, toDateKey } from './lib/booking'
import { useI18n } from './lib/i18n'
import { googleAuthEnabled, isSupabaseConfigured, stripeEnabled, supabase } from './lib/supabase'

const todayKey = () => toDateKey(new Date())
const cancellationErrorMessage = (message = '', t) => {
  if (message.includes('within 12 hours')) return t('errors.cancelWindow')
  if (message.includes('does not belong to you')) return t('errors.notOwner')
  if (message.includes('no longer active')) return t('errors.inactive')
  if (message.includes('Manager access required')) return t('errors.managerRequired')
  if (message.includes('Booking not found')) return t('errors.bookingNotFound')
  return t('errors.cancel')
}

export default function App() {
  const { courtName, t } = useI18n()
  const [view, setView] = useState('book')
  const [dateKey, setDateKey] = useState(todayKey)
  const [schedule, setSchedule] = useState(() => demoSchedule(todayKey()))
  const [bookings, setBookings] = useState([])
  const [adminBookings, setAdminBookings] = useState([])
  const [adminRange, setAdminRange] = useState(() => ({
    start: todayKey(),
    end: toDateKey(addDays(new Date(), 6)),
  }))
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [selection, setSelection] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [loadingAdminBookings, setLoadingAdminBookings] = useState(false)
  const [adminCancellingId, setAdminCancellingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 3600)
  }, [])

  const fetchSchedule = useCallback(async () => {
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
  }, [dateKey, notify, t])

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
    if (!user || !isSupabaseConfigured) {
      setIsAdmin(false)
      return
    }
    const { data, error } = await supabase
      .from('staff_members')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) {
      setIsAdmin(false)
      notify(t('errors.adminAccess'), 'error')
      return
    }
    setIsAdmin(data?.role === 'admin')
  }, [user, notify, t])

  const fetchAdminBookings = useCallback(async () => {
    if (!user || !isAdmin || !isSupabaseConfigured) return setAdminBookings([])
    setLoadingAdminBookings(true)
    const endExclusive = toDateKey(addDays(new Date(`${adminRange.end}T12:00:00`), 1))
    const pageSize = 1000
    const data = []
    let error = null

    for (let from = 0; ; from += pageSize) {
      const result = await supabase
        .from('bookings')
        .select('id, user_id, court_id, customer_name, customer_email, start_at, end_at, status, payment_status, payment_method, total_amount, currency, party_size, created_at')
        .gte('start_at', `${adminRange.start}T00:00:00`)
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

    setLoadingAdminBookings(false)
    if (error) notify(t('errors.adminBookings'), 'error')
    else setAdminBookings(data)
  }, [adminRange, isAdmin, user, notify, t])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user || null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => { fetchSchedule() }, [fetchSchedule])
  useEffect(() => { if (view === 'mine') fetchBookings() }, [view, fetchBookings])
  useEffect(() => { fetchAdminAccess() }, [fetchAdminAccess])
  useEffect(() => { if (view === 'admin') fetchAdminBookings() }, [view, fetchAdminBookings])
  useEffect(() => { if (view === 'admin' && !isAdmin) setView('mine') }, [view, isAdmin])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const channel = supabase
      .channel('public-court-schedule')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'court_slots' }, fetchSchedule)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchSchedule])

  const openSelection = (slot) => {
    setSelection({
      ...slot,
      duration: 60,
      partySize: 2,
      paymentMethod: 'venue',
      set: (change) => setSelection((current) => ({ ...current, ...change })),
    })
  }

  const selectedInterval = useMemo(() => {
    if (!selection) return null
    const start = slotDateTime(selection.dateKey, selection.time)
    return { start, end: addMinutes(start, selection.duration) }
  }, [selection])

  const selectionConflicts = selectedInterval && schedule.some(
    (item) => item.court_id === selection.court.id && overlaps(selectedInterval.start, selectedInterval.end, item.start_at, item.end_at),
  )
  const selectionOutsideHours = selectedInterval && selectedInterval.end.slice(11, 16) > '22:00'
  const selectionInvalid = Boolean(selectionConflicts || selectionOutsideHours)

  const confirmBooking = async (details) => {
    if (!user) {
      setShowAuth(true)
      return
    }
    if (selectionInvalid) {
      notify(t(selectionOutsideHours ? 'errors.outsideHours' : 'errors.overlap'), 'error')
      return
    }

    const startAt = slotDateTime(details.dateKey, details.time)
    const endAt = addMinutes(startAt, details.duration)
    setBusy(true)

    if (!isSupabaseConfigured) {
      const booking = {
        id: `local-${Date.now()}`,
        court_id: details.court.id,
        start_at: startAt,
        end_at: endAt,
        status: 'confirmed',
        payment_status: 'pay_at_venue',
        total_amount: details.price,
        party_size: details.partySize,
      }
      setSchedule((current) => [...current, booking])
      setBookings((current) => [booking, ...current])
      setBusy(false)
      setSelection(null)
      notify(t('success.demoBooking'))
      return
    }

    const { data, error } = await supabase.rpc('create_booking', {
      p_court_id: details.court.id,
      p_start_at: startAt,
      p_end_at: endAt,
      p_party_size: details.partySize,
      p_payment_method: details.paymentMethod,
    })

    if (error) {
      setBusy(false)
      notify(t(error.message.includes('already booked') ? 'errors.slotTaken' : 'errors.booking'), 'error')
      await fetchSchedule()
      return
    }

    if (details.paymentMethod === 'stripe') {
      const bookingId = data?.id || data?.[0]?.id
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('create-checkout', { body: { bookingId } })
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
    if (error) notify(cancellationErrorMessage(error.message, t), 'error')
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

    setAdminCancellingId(booking.id)
    const { error } = await supabase.rpc('admin_cancel_booking', { p_booking_id: booking.id })
    setAdminCancellingId(null)
    if (error) {
      notify(cancellationErrorMessage(error.message, t), 'error')
      return
    }

    notify(t('success.adminCancel'))
    await Promise.all([fetchAdminBookings(), fetchSchedule(), fetchBookings()])
  }

  const loginByEmail = async (email) => {
    if (!isSupabaseConfigured) return false
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split('#')[0] } })
    if (error) {
      notify(t(error.message.toLowerCase().includes('rate limit') ? 'errors.emailRateLimit' : 'errors.auth'), 'error')
      return false
    }
    return true
  }

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href.split('#')[0] } })
    if (error) notify(t('errors.auth'), 'error')
  }

  const enterDemo = () => {
    setUser({ id: 'demo-user', email: 'demo@tiger.local' })
    setShowAuth(false)
    notify(t('success.demoMode'))
  }

  const signOut = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut()
    setUser(null)
    setIsAdmin(false)
    setAdminBookings([])
    setView('book')
  }

  return (
    <div className="app-shell">
      <Header user={user} isAdmin={isAdmin} view={view} onViewChange={setView} onAuth={() => setShowAuth(true)} onSignOut={signOut} />

      {view === 'book' ? (
        <main>
          <section className="hero">
            <div className="hero-art" aria-hidden="true" />
            <div className="hero-content">
              <span className="eyebrow"><Sparkles size={13} /> {t('hero.eyebrow')}</span>
              <h1>{t('hero.title1')}<br /><em>{t('hero.title2')}</em></h1>
              <p>{t('hero.description')}</p>
              <div className="hero-actions">
                <a className="primary-button" href="#availability">{t('hero.cta')}</a>
                <span><Radio size={15} /> {t('hero.realtime')}</span>
              </div>
            </div>
            <div className="venue-note"><MapPin size={16} /><span><strong>{t('venue.name')}</strong><small>{t('venue.hours')}</small></span></div>
          </section>

          <section className="booking-container">
            {!isSupabaseConfigured && (
              <div className="demo-banner"><span>{t('demo.label')}</span> {t('demo.description')}</div>
            )}
            <DateStrip selected={dateKey} onSelect={setDateKey} />
            <BookingBoard dateKey={dateKey} schedule={schedule} loading={loadingSchedule} onSelect={openSelection} />
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
          loading={loadingAdminBookings}
          startDate={adminRange.start}
          endDate={adminRange.end}
          onRangeChange={setAdminRange}
          onRefresh={fetchAdminBookings}
          onCancel={adminCancelBooking}
          cancellingId={adminCancellingId}
        />
      ) : (
        <MyBookings user={user} bookings={bookings} loading={loadingBookings} onLogin={() => setShowAuth(true)} onCancel={cancelBooking} />
      )}

      <footer><div className="footer-brand">TIGER <span>{t('footer.subtitle')}</span></div><p>{t('footer.motto')}</p><small>© {new Date().getFullYear()} Tiger Badminton Club</small></footer>

      <nav className={`mobile-bottom-nav ${isAdmin ? 'admin-mobile-nav' : ''}`} aria-label={t('nav.mobile')}>
        <button className={view === 'book' ? 'active' : ''} onClick={() => setView('book')}><CalendarDays size={20} /><span>{t('nav.courts')}</span></button>
        <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}><CircleUserRound size={20} /><span>{t('nav.myShort')}</span></button>
        {isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><ShieldCheck size={20} /><span>{t('nav.adminShort')}</span></button>}
        <button onClick={() => view === 'book' && document.getElementById('availability')?.scrollIntoView({ behavior: 'smooth' })}><Clock3 size={20} /><span>{t('nav.slots')}</span></button>
      </nav>

      <BookingDrawer selection={selection} onClose={() => setSelection(null)} onConfirm={confirmBooking} busy={busy} stripeEnabled={stripeEnabled} invalid={selectionInvalid} />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onEmail={loginByEmail} onGoogle={loginWithGoogle} onDemo={enterDemo} demoMode={!isSupabaseConfigured} googleEnabled={googleAuthEnabled} />}
      {toast && <div className={`toast ${toast.tone}`} role="status">{toast.message}</div>}
    </div>
  )
}
