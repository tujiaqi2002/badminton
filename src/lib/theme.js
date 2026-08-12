import { createContext, useContext } from 'react'

export const THEMES = [
  { id: 'classic', number: '01', nameKey: 'theme.classic.name', noteKey: 'theme.classic.note' },
  { id: 'winged', number: '02', nameKey: 'theme.winged.name', noteKey: 'theme.winged.note' },
  { id: 'sport', number: '03', nameKey: 'theme.sport.name', noteKey: 'theme.sport.note' },
  { id: 'focus', number: '04', nameKey: 'theme.focus.name', noteKey: 'theme.focus.note', heroKey: 'hero.focus' },
  { id: 'banner', number: '05', nameKey: 'theme.banner.name', noteKey: 'theme.banner.note', heroKey: 'hero.banner' },
  { id: 'colorfocus', number: '06', nameKey: 'theme.colorfocus.name', noteKey: 'theme.colorfocus.note', heroKey: 'hero.focus' },
]

export const ThemeContext = createContext(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
