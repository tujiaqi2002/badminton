import { Check, ChevronDown, Languages, LogOut, Palette, Settings2, Type } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { DISPLAY_SIZES, useDisplay } from '../lib/display'
import { useI18n } from '../lib/i18n'
import { THEMES, useTheme } from '../lib/theme'

export default function DisplaySettings({ user, guest, onSignOut }) {
  const { displaySize, setDisplaySize } = useDisplay()
  const { language, setLanguage, t } = useI18n()
  const { theme, setTheme, themeDefinition } = useTheme()
  const detailsRef = useRef(null)
  const panelRef = useRef(null)
  const username = user.email?.split('@')[0] || guest

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!detailsRef.current?.contains(event.target)) detailsRef.current?.removeAttribute('open')
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') detailsRef.current?.removeAttribute('open')
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  return (
    <details className="display-settings" ref={detailsRef} onToggle={(event) => {
      if (event.currentTarget.open) window.requestAnimationFrame(() => panelRef.current?.scrollTo({ top: 0 }))
    }}>
      <summary className="account-button" aria-label={t('settings.open')} title={t('settings.open')}>
        <span className="avatar">{(user.email || guest).slice(0, 1).toUpperCase()}</span>
        <span className="account-label">{username}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>

      <section className="display-settings-panel" aria-label={t('settings.title')} ref={panelRef}>
        <header>
          <span><Settings2 size={16} aria-hidden="true" /></span>
          <div><strong>{t('settings.title')}</strong><small>{t('settings.subtitle')}</small></div>
        </header>

        <div className="settings-section">
          <div className="settings-section-title"><Type size={14} aria-hidden="true" /><span>{t('settings.fontSize')}</span></div>
          <div className="font-size-options" role="group" aria-label={t('settings.fontSize')}>
            {DISPLAY_SIZES.map((size, index) => (
              <button type="button" className={displaySize === size.id ? 'selected' : ''} aria-pressed={displaySize === size.id} onClick={() => setDisplaySize(size.id)} key={size.id}>
                <b className={`font-preview font-preview-${index}`}>{size.preview}</b><span>{t(size.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section settings-language">
          <div className="settings-section-title"><Languages size={14} aria-hidden="true" /><span>{t('settings.language')}</span></div>
          <div className="language-options" role="group" aria-label={t('settings.language')}>
            <button type="button" className={language === 'zh' ? 'selected' : ''} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
            <button type="button" className={language === 'en' ? 'selected' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title"><Palette size={14} aria-hidden="true" /><span>{t('settings.appearance')}</span><small>UI {themeDefinition.number}</small></div>
          <div className="settings-theme-grid" role="group" aria-label={t('theme.choose')}>
            {THEMES.map((item) => (
              <button type="button" className={theme === item.id ? 'selected' : ''} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)} key={item.id}>
                <i className={`theme-preview ${item.id}`} aria-hidden="true"><span /></i>
                <span><strong>{item.number} · {t(item.nameKey)}</strong><small>{t(item.noteKey)}</small></span>
                {theme === item.id && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>

        <footer>
          <div><strong>{username}</strong><small>{user.email || guest}</small></div>
          <button type="button" onClick={onSignOut}><LogOut size={14} aria-hidden="true" />{t('account.signOut')}</button>
        </footer>
      </section>
    </details>
  )
}
