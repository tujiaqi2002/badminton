import { createContext, useContext } from 'react'

export const DISPLAY_SIZES = [
  { id: 'small', labelKey: 'settings.fontSmall', preview: 'A' },
  { id: 'standard', labelKey: 'settings.fontStandard', preview: 'A' },
  { id: 'large', labelKey: 'settings.fontLarge', preview: 'A' },
]

export const DisplayContext = createContext(null)

export const useDisplay = () => {
  const context = useContext(DisplayContext)
  if (!context) throw new Error('useDisplay must be used inside DisplayProvider')
  return context
}
