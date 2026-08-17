import { Building2, CalendarDays, Gauge, ShieldCheck, UserRound } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import DisplaySettings from './DisplaySettings'

export default function Header({ user, isAdmin, view, onViewChange, onAuth, onSignOut }) {
  const { t } = useI18n()
  const guest = t('account.guest')
  const usesWideWorkspace = isAdmin && (view === 'admin' || view === 'capacity')

  return (
    <header className={`site-header${usesWideWorkspace ? ' admin-workspace' : ''}`}>
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
          <button className={view === 'operations' ? 'active' : ''} onClick={() => onViewChange('operations')}>
            <Building2 size={17} /> {t('nav.operations')}
          </button>
        </>}
      </nav>

      <div className="header-actions">
        {user ? (
          <DisplaySettings user={user} guest={guest} isAdmin={isAdmin} onSignOut={onSignOut} />
        ) : (
          <button className="outline-button header-login" onClick={onAuth}>{t('account.login')}</button>
        )}
      </div>
    </header>
  )
}
