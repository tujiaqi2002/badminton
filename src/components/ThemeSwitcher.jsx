import { Check, Palette } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { THEMES, useTheme } from '../lib/theme'

export default function ThemeSwitcher() {
  const { t } = useI18n()
  const { theme, setTheme, themeDefinition } = useTheme()
  const detailsRef = useRef(null)

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

  const selectTheme = (themeId) => {
    setTheme(themeId)
    detailsRef.current?.removeAttribute('open')
  }

  return (
    <details className="theme-switcher" ref={detailsRef}>
      <summary aria-label={t('theme.switch')} title={t('theme.switch')}>
        <Palette size={14} aria-hidden="true" />
        <span>UI {themeDefinition.number}</span>
      </summary>
      <div className="theme-menu" role="group" aria-label={t('theme.choose')}>
        <header><span>{t('theme.choose')}</span><small>{THEMES.length} UI</small></header>
        {THEMES.map((item) => (
          <button
            type="button"
            className={theme === item.id ? 'selected' : ''}
            onClick={() => selectTheme(item.id)}
            aria-pressed={theme === item.id}
            key={item.id}
          >
            <i className={`theme-preview ${item.id}`} aria-hidden="true"><span /></i>
            <span><strong>{item.number} · {t(item.nameKey)}</strong><small>{t(item.noteKey)}</small></span>
            {theme === item.id && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  )
}
