import { CalendarDays, Gauge, Globe2, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import ThemeSwitcher from './ThemeSwitcher'

export default function Header({ user, isAdmin, view, onViewChange, onAuth, onSignOut }) {
  const { t, toggleLanguage } = useI18n()
  const guest = t('account.guest')

  return (
    <header className="site-header">
      <button className="brand" onClick={() => onViewChange('book')} aria-label={t('nav.home')}>
        <span className="brand-mark" aria-hidden="true">虎</span>
        <span><strong>TIGER</strong><small>{t('brand.subtitle')}</small></span>
      </button>

      <nav className="desktop-nav" aria-label={t('nav.main')}>
        <button className={view === 'book' ? 'active' : ''} onClick={() => onViewChange('book')}>
          <CalendarDays size={17} /> {t('nav.courts')}
        </button>
        <button className={view === 'mine' ? 'active' : ''} onClick={() => onViewChange('mine')}>
          <UserRound size={17} /> {t('nav.myBookings')}
        </button>
        {isAdmin && <>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => onViewChange('admin')}>
            <ShieldCheck size={17} /> {t('nav.admin')}
          </button>
          <button className={view === 'capacity' ? 'active' : ''} onClick={() => onViewChange('capacity')}>
            <Gauge size={17} /> {t('nav.capacity')}
          </button>
        </>}
      </nav>

      <div className="header-actions">
        <ThemeSwitcher />
        <button className="language-switch" onClick={toggleLanguage} aria-label={t('language.switch')} title={t('language.switch')}>
          <Globe2 size={14} /><span>{t('language.switchShort')}</span>
        </button>

        {user ? (
          <button className="account-button" onClick={onSignOut} title={t('account.signOut')}>
            <span className="avatar">{(user.email || guest).slice(0, 1).toUpperCase()}</span>
            <span className="account-label">{user.email?.split('@')[0] || guest}</span>
            <LogOut size={15} />
          </button>
        ) : (
          <button className="outline-button header-login" onClick={onAuth}>{t('account.login')}</button>
        )}
      </div>
    </header>
  )
}
