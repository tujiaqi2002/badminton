import { Check, ChevronDown, Languages, LogOut, Move, MoveHorizontal, MoveVertical, Palette, Search, Settings2, SwatchBook, Type, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BOOKING_COLOR_SCHEMES } from '../lib/bookingColors'
import { DRAG_LOCK_COURT_ONLY, DRAG_LOCK_FREE, DRAG_LOCK_TIME_ONLY, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, useDisplay } from '../lib/display'
import { useI18n } from '../lib/i18n'
import { THEMES, useTheme } from '../lib/theme'

const SETTINGS_SECTIONS = [
  { id: 'display', titleKey: 'settings.display', descriptionKey: 'settings.displaySubtitle', icon: Settings2 },
  { id: 'appearance', titleKey: 'settings.appearance', descriptionKey: 'settings.appearanceSubtitle', icon: Palette },
  { id: 'account', titleKey: 'settings.account', descriptionKey: 'settings.accountSubtitle', icon: UserRound },
]

export default function DisplaySettings({ user, guest, isAdmin, onSignOut }) {
  const { displaySize, setDisplaySize, bookingColorScheme, setBookingColorScheme, dragLockMode, setDragLockMode } = useDisplay()
  const { language, setLanguage, t } = useI18n()
  const { theme, setTheme, themeDefinition } = useTheme()
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('display')
  const [query, setQuery] = useState('')
  const username = user.email?.split('@')[0] || guest

  const visibleSections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return SETTINGS_SECTIONS
    return SETTINGS_SECTIONS.filter((section) => {
      const themeTerms = section.id === 'appearance' ? `${THEMES.flatMap((item) => [t(item.nameKey), t(item.noteKey)]).join(' ')} ${isAdmin ? BOOKING_COLOR_SCHEMES.flatMap((item) => [t(item.nameKey), t(item.noteKey)]).join(' ') : ''}` : ''
      const displayTerms = section.id === 'display' ? `${t('settings.fontSize')} ${t('settings.language')} ${t('settings.fontSmaller')} ${t('settings.fontStandard')} ${t('settings.fontLarger')} ${isAdmin ? `${t('settings.dragLock')} ${t('settings.dragLockFree')} ${t('settings.dragLockCourt')} ${t('settings.dragLockTime')}` : ''}` : ''
      const accountTerms = section.id === 'account' ? `${username} ${user.email || ''} ${t('account.signOut')}` : ''
      return `${t(section.titleKey)} ${t(section.descriptionKey)} ${themeTerms} ${displayTerms} ${accountTerms}`.toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [isAdmin, query, t, user.email, username])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (visibleSections.length && !visibleSections.some(({ id }) => id === activeSection)) setActiveSection(visibleSections[0].id)
  }, [activeSection, visibleSections])

  const closeSettings = () => {
    setOpen(false)
    setQuery('')
  }

  const signOut = () => {
    closeSettings()
    onSignOut()
  }

  const activeDefinition = SETTINGS_SECTIONS.find(({ id }) => id === activeSection) || SETTINGS_SECTIONS[0]

  return (
    <>
      <button type="button" className="account-button" aria-label={t('settings.open')} title={t('settings.open')} aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="avatar">{(user.email || guest).slice(0, 1).toUpperCase()}</span>
        <span className="account-label">{username}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="display-settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeSettings()}>
          <div className="settings-center" role="dialog" aria-modal="true" aria-labelledby="settings-center-title">
            <aside className="settings-sidebar">
              <header>
                <button type="button" className="settings-close" onClick={closeSettings} aria-label={t('settings.close')}><X size={20} /></button>
                <div><span className="avatar">{(user.email || guest).slice(0, 1).toUpperCase()}</span><strong>{t('settings.title')}</strong></div>
              </header>

              <label className="settings-search">
                <Search size={16} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('settings.search')} aria-label={t('settings.search')} />
              </label>

              <nav aria-label={t('settings.navigation')}>
                {visibleSections.map((section) => {
                  const Icon = section.icon
                  return (
                    <button type="button" className={activeSection === section.id ? 'active' : ''} aria-current={activeSection === section.id ? 'page' : undefined} onClick={() => setActiveSection(section.id)} key={section.id}>
                      <Icon size={17} aria-hidden="true" />
                      <span><strong>{t(section.titleKey)}</strong><small>{t(section.descriptionKey)}</small></span>
                    </button>
                  )
                })}
              </nav>

              {!visibleSections.length && <p className="settings-no-results">{t('settings.noResults')}</p>}
              <footer><strong>{username}</strong><small>{user.email || guest}</small></footer>
            </aside>

            <main className="settings-content">
              <header>
                <div><span className="eyebrow">TIGER SETTINGS</span><h2 id="settings-center-title">{t(activeDefinition.titleKey)}</h2><p>{t(activeDefinition.descriptionKey)}</p></div>
                <button type="button" className="settings-close settings-close-desktop" onClick={closeSettings} aria-label={t('settings.close')}><X size={20} /></button>
              </header>

              {activeSection === 'display' && (
                <div className="settings-page">
                  <section className="settings-card">
                    <div className="settings-card-heading"><span><Type size={17} /></span><div><h3>{t('settings.fontSize')}</h3><p>{t('settings.fontHelp')}</p></div></div>
                    <div className="font-scale-control">
                      <div className="font-scale-value" aria-live="polite"><span>{t('settings.fontCurrent')}</span><output htmlFor="font-scale-slider">{displaySize}%</output></div>
                      <div className="font-scale-slider-row">
                        <b className="font-scale-preview small" aria-hidden="true">A</b>
                        <input
                          id="font-scale-slider"
                          type="range"
                          min={FONT_SCALE_MIN}
                          max={FONT_SCALE_MAX}
                          step={FONT_SCALE_STEP}
                          value={displaySize}
                          onChange={(event) => setDisplaySize(Number(event.target.value))}
                          aria-label={t('settings.fontSize')}
                          aria-valuetext={`${displaySize}%`}
                          style={{ '--font-scale-progress': `${(displaySize - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN) * 100}%` }}
                        />
                        <b className="font-scale-preview large" aria-hidden="true">A</b>
                      </div>
                      <div className="font-scale-labels"><span>{t('settings.fontSmaller')}</span><button type="button" onClick={() => setDisplaySize(FONT_SCALE_DEFAULT)}>{t('settings.fontStandard')} · {FONT_SCALE_DEFAULT}%</button><span>{t('settings.fontLarger')}</span></div>
                    </div>
                  </section>

                  {isAdmin && (
                    <section className="settings-card">
                      <div className="settings-card-heading"><span><Move size={17} /></span><div><h3>{t('settings.dragLock')}</h3><p>{t('settings.dragLockHelp')}</p></div></div>
                      <div className="drag-lock-settings-options" role="radiogroup" aria-label={t('settings.dragLock')}>
                        {[
                          { id: DRAG_LOCK_FREE, icon: Move, label: 'settings.dragLockFree', note: 'settings.dragLockFreeNote' },
                          { id: DRAG_LOCK_COURT_ONLY, icon: MoveHorizontal, label: 'settings.dragLockCourt', note: 'settings.dragLockCourtNote' },
                          { id: DRAG_LOCK_TIME_ONLY, icon: MoveVertical, label: 'settings.dragLockTime', note: 'settings.dragLockTimeNote' },
                        ].map((item) => {
                          const Icon = item.icon
                          const selected = dragLockMode === item.id
                          return <button type="button" role="radio" aria-checked={selected} className={selected ? 'selected' : ''} onClick={() => setDragLockMode(item.id)} key={item.id}><Icon size={16} /><span><strong>{t(item.label)}</strong><small>{t(item.note)}</small></span>{selected && <Check size={14} />}</button>
                        })}
                      </div>
                    </section>
                  )}

                  <section className="settings-card">
                    <div className="settings-card-heading"><span><Languages size={17} /></span><div><h3>{t('settings.language')}</h3><p>{t('settings.languageHelp')}</p></div></div>
                    <div className="language-options" role="group" aria-label={t('settings.language')}>
                      <button type="button" className={language === 'zh' ? 'selected' : ''} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文{language === 'zh' && <Check size={14} />}</button>
                      <button type="button" className={language === 'en' ? 'selected' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English{language === 'en' && <Check size={14} />}</button>
                    </div>
                  </section>
                </div>
              )}

              {activeSection === 'appearance' && (
                <div className="settings-page">
                  <div className="settings-current-theme"><span>{t('settings.currentTheme')}</span><strong>UI {themeDefinition.number} · {t(themeDefinition.nameKey)}</strong></div>
                  <div className="settings-theme-grid" role="group" aria-label={t('theme.choose')}>
                    {THEMES.map((item) => (
                      <button type="button" className={theme === item.id ? 'selected' : ''} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)} key={item.id}>
                        <i className={`theme-preview ${item.id}`} aria-hidden="true"><span /></i>
                        <span><strong>{item.number} · {t(item.nameKey)}</strong><small>{t(item.noteKey)}</small></span>
                        {theme === item.id && <Check size={16} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                  {isAdmin && (
                    <section className="settings-card settings-booking-colors-card">
                      <div className="settings-card-heading"><span><SwatchBook size={17} /></span><div><h3>{t('settings.bookingColors')}</h3><p>{t('settings.bookingColorsHelp')}</p></div></div>
                      <div className="booking-color-options" role="group" aria-label={t('settings.bookingColors')}>
                        {BOOKING_COLOR_SCHEMES.map((item) => (
                          <button type="button" className={bookingColorScheme === item.id ? 'selected' : ''} aria-pressed={bookingColorScheme === item.id} onClick={() => setBookingColorScheme(item.id)} key={item.id}>
                            <i className="booking-palette-preview" aria-hidden="true">{item.swatches.map((color) => <span style={{ background: color }} key={color} />)}</i>
                            <span><strong>{t(item.nameKey)}</strong><small>{t(item.noteKey)}</small></span>
                            {bookingColorScheme === item.id && <Check size={15} aria-hidden="true" />}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {activeSection === 'account' && (
                <div className="settings-page">
                  <section className="settings-profile-card">
                    <span className="settings-profile-avatar">{(user.email || guest).slice(0, 1).toUpperCase()}</span>
                    <div><small>{t('settings.signedInAs')}</small><h3>{username}</h3><p>{user.email || guest}</p></div>
                  </section>
                  <section className="settings-danger-card">
                    <div><h3>{t('account.signOut')}</h3><p>{t('settings.signOutHelp')}</p></div>
                    <button type="button" onClick={signOut}><LogOut size={16} />{t('account.signOut')}</button>
                  </section>
                </div>
              )}
            </main>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
