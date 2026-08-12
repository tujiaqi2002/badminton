import { useEffect, useMemo, useState } from 'react'
import { ThemeContext, THEMES } from '../lib/theme'

const THEME_COLOURS = {
  classic: '#f3f0e9',
  winged: '#eee2c3',
  sport: '#f5c400',
  focus: '#dededb',
  banner: '#d6a20a',
  colorfocus: '#f3f0e9',
  inkplay: '#efe3cc',
}

const getInitialTheme = () => {
  const stored = window.localStorage.getItem('tiger-ui-theme')
  return THEMES.some(({ id }) => id === stored) ? stored : 'classic'
}

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    window.localStorage.setItem('tiger-ui-theme', theme)
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOURS[theme])
  }, [theme])

  const value = useMemo(() => ({
    theme,
    setTheme,
    themeDefinition: THEMES.find(({ id }) => id === theme) || THEMES[0],
  }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
