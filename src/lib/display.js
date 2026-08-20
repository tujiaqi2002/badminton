import { createContext, useContext } from 'react'

export const FONT_SCALE_MIN = 90
export const FONT_SCALE_MAX = 140
export const FONT_SCALE_STEP = 2
export const FONT_SCALE_DEFAULT = 100

export const DRAG_LOCK_FREE = 'free'
export const DRAG_LOCK_COURT_ONLY = 'court-only'
export const DRAG_LOCK_TIME_ONLY = 'time-only'
export const DRAG_LOCK_MODES = [DRAG_LOCK_FREE, DRAG_LOCK_COURT_ONLY, DRAG_LOCK_TIME_ONLY]

export const DisplayContext = createContext(null)

export const useDisplay = () => {
  const context = useContext(DisplayContext)
  if (!context) throw new Error('useDisplay must be used inside DisplayProvider')
  return context
}
