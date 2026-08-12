import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CircleUserRound, Clock3, MapPin, Radio, Sparkles } from 'lucide-react'
import AuthModal from './components/AuthModal'
import BookingBoard from './components/BookingBoard'
import BookingDrawer from './components/BookingDrawer'
import DateStrip from './components/DateStrip'
import Header from './components/Header'
import MyBookings from './components/MyBookings'
import { addMinutes, demoSchedule, overlaps, slotDateTime, toDateKey } from './lib/booking'
import { googleAuthEnabled, isSupabaseConfigured, stripeEnabled, supabase } from './lib/supabase'

const todayKey = () => toDateKey(new Date())

export default function App() {
  const [view, setView] = useState('book')
  const [dateKey, setDateKey] = useState(todayKey)
  const [schedule, setSchedule] = useState(() => demoSchedule(todayKey()))
  const [bookings, setBookings] = useState([])
  const [user, setUser] = useState(null)
  const [selection, setSelection] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [loadingBookings, setLoadingBookings] = useState(false)
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
    if (error) notify('场地状态同步失败，请稍后重试', 'error')
    else setSchedule(data || [])
  }, [dateKey, notify])

  const fetchBookings = useCallback(async () => {
    if (!user) return setBookings([])
    if (!isSupabaseConfigured) return
    setLoadingBookings(true)
    const { data, error } = await supabase.from('bookings').select('*').order('start_at', { ascending: false })
    setLoadingBookings(false)
    if (error) notify('无法读取个人预订', 'error')
    else setBookings(data || [])
  }, [user, notify])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user || null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => { fetchSchedule() }, [fetchSchedule])
  useEffect(() => { if (view === 'mine') fetchBookings() }, [view, fetchBookings])

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
      notify(selectionOutsideHours ? '所选时长超过营业时间 22:00' : '所选时长与已有预订重叠，请选择较短时长或其他时间', 'error')
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
      notify('体验预订已确认，场地状态已实时更新')
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
      notify(error.message.includes('already booked') ? '刚刚被其他球友订走了，请选择其他时段' : '预订失败，请稍后再试', 'error')
      await fetchSchedule()
      return
    }

    if (details.paymentMethod === 'stripe') {
      const bookingId = data?.id || data?.[0]?.id
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('create-checkout', { body: { bookingId } })
      if (checkoutError || !checkout?.url) {
        setBusy(false)
        notify('支付页面创建失败，场地将于 10 分钟后自动释放', 'error')
        return
      }
      window.location.assign(checkout.url)
      return
    }

    setBusy(false)
    setSelection(null)
    notify('预订成功，期待与你在 Tiger 相见')
    await Promise.all([fetchSchedule(), fetchBookings()])
  }

  const cancelBooking = async (booking) => {
    if (!window.confirm('确定取消这个场次吗？')) return
    if (!isSupabaseConfigured) {
      setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: 'cancelled' } : item))
      setSchedule((current) => current.filter((item) => item.id !== booking.id))
      notify('预订已取消')
      return
    }
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: booking.id })
    if (error) notify(error.message, 'error')
    else { notify('预订已取消'); await Promise.all([fetchSchedule(), fetchBookings()]) }
  }

  const loginByEmail = async (email) => {
    if (!isSupabaseConfigured) return false
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split('#')[0] } })
    if (error) { notify(error.message, 'error'); return false }
    return true
  }

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href.split('#')[0] } })
    if (error) notify(error.message, 'error')
  }

  const enterDemo = () => {
    setUser({ id: 'demo-user', email: 'demo@tiger.local' })
    setShowAuth(false)
    notify('已进入体验模式，现在可以完成一笔预订')
  }

  const signOut = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut()
    setUser(null)
    setView('book')
  }

  return (
    <div className="app-shell">
      <Header user={user} view={view} onViewChange={setView} onAuth={() => setShowAuth(true)} onSignOut={signOut} />

      {view === 'book' ? (
        <main>
          <section className="hero">
            <div className="hero-art" aria-hidden="true" />
            <div className="hero-content">
              <span className="eyebrow"><Sparkles size={13} /> Tiger badminton club</span>
              <h1>留一片场地，<br /><em>与风交手。</em></h1>
              <p>五片场地，实时可见。选好时间，下一场好球从容开始。</p>
              <div className="hero-actions">
                <a className="primary-button" href="#availability">查看空闲场地</a>
                <span><Radio size={15} /> 实时同步</span>
              </div>
            </div>
            <div className="venue-note"><MapPin size={16} /><span><strong>Tiger 羽球馆</strong><small>每天 07:00—22:00</small></span></div>
          </section>

          <section className="booking-container">
            {!isSupabaseConfigured && (
              <div className="demo-banner"><span>体验环境</span> 当前展示模拟实时数据；连接 Supabase 后将自动切换为真实预订。</div>
            )}
            <DateStrip selected={dateKey} onSelect={setDateKey} />
            <BookingBoard dateKey={dateKey} schedule={schedule} loading={loadingSchedule} onSelect={openSelection} />
          </section>

          <section className="ritual-section">
            <div><span className="eyebrow">Simple by design</span><h2>三步，开场</h2></div>
            <div className="ritual-steps">
              <article><span>一</span><h3>看空闲</h3><p>场地状态实时同步，不必打电话确认。</p></article>
              <article><span>二</span><h3>选时间</h3><p>点击空白时段，按需要选择 60—120 分钟。</p></article>
              <article><span>三</span><h3>去挥拍</h3><p>到店付款或安全在线支付，准时到场即可。</p></article>
            </div>
          </section>
        </main>
      ) : (
        <MyBookings user={user} bookings={bookings} loading={loadingBookings} onLogin={() => setShowAuth(true)} onCancel={cancelBooking} />
      )}

      <footer><div className="footer-brand">TIGER <span>羽球馆</span></div><p>风林火山雷 · 五场一心</p><small>© {new Date().getFullYear()} Tiger Badminton Club</small></footer>

      <nav className="mobile-bottom-nav" aria-label="移动端导航">
        <button className={view === 'book' ? 'active' : ''} onClick={() => setView('book')}><CalendarDays size={20} /><span>场地</span></button>
        <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}><CircleUserRound size={20} /><span>我的</span></button>
        <button onClick={() => view === 'book' && document.getElementById('availability')?.scrollIntoView({ behavior: 'smooth' })}><Clock3 size={20} /><span>时段</span></button>
      </nav>

      <BookingDrawer selection={selection} onClose={() => setSelection(null)} onConfirm={confirmBooking} busy={busy} stripeEnabled={stripeEnabled} invalid={selectionInvalid} />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onEmail={loginByEmail} onGoogle={loginWithGoogle} onDemo={enterDemo} demoMode={!isSupabaseConfigured} googleEnabled={googleAuthEnabled} />}
      {toast && <div className={`toast ${toast.tone}`} role="status">{toast.message}</div>}
    </div>
  )
}
