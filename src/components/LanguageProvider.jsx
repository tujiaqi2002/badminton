import { useCallback, useEffect, useMemo, useState } from 'react'
import { LanguageContext, MESSAGES } from '../lib/i18n'

const getInitialLanguage = () => {
  const stored = window.localStorage.getItem('tiger-language')
  if (stored === 'zh' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
export default function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(getInitialLanguage)

  useEffect(() => {
    window.localStorage.setItem('tiger-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en-CA'
  }, [language])

  const t = useCallback((key, variables = {}) => {
    const template = MESSAGES[language][key] ?? MESSAGES.zh[key] ?? key
    return Object.entries(variables).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      template,
    )
  }, [language])

  const value = useMemo(() => ({
    language,
    locale: language === 'zh' ? 'zh-CN' : 'en-CA',
    setLanguage,
    toggleLanguage: () => setLanguage((current) => current === 'zh' ? 'en' : 'zh'),
    t,
    courtName: (court) => language === 'zh' ? court.name : court.english,
    courtTitle: (court) => language === 'zh'
      ? `${court.name} · ${court.english}`
      : `${court.english} · ${court.name}`,
    courtNote: (court) => language === 'zh' ? court.note : court.noteEn,
  }), [language, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
