import { useEffect, useMemo, useState } from 'react'
import { BOOKING_COLOR_SCHEMES, DEFAULT_BOOKING_COLOR_SCHEME } from '../lib/bookingColors'
import { DRAG_LOCK_FREE, DRAG_LOCK_MODES, DisplayContext, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN } from '../lib/display'

const STORAGE_KEY = 'tiger-display-size'
const BOOKING_COLORS_STORAGE_KEY = 'tiger-booking-color-scheme'
const DRAG_LOCK_STORAGE_KEY = 'tiger-admin-drag-lock'

const getInitialSize = () => {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  const legacyScale = { small: 90, standard: 100, large: 112 }[stored]
  const parsed = legacyScale || Number(stored)
  return Number.isFinite(parsed) ? Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, parsed)) : FONT_SCALE_DEFAULT
}

const getInitialBookingColorScheme = () => {
  const stored = window.localStorage.getItem(BOOKING_COLORS_STORAGE_KEY)
  return BOOKING_COLOR_SCHEMES.some(({ id }) => id === stored) ? stored : DEFAULT_BOOKING_COLOR_SCHEME
}

const getInitialDragLockMode = () => {
  const stored = window.localStorage.getItem(DRAG_LOCK_STORAGE_KEY)
  return DRAG_LOCK_MODES.includes(stored) ? stored : DRAG_LOCK_FREE
}

export default function DisplayProvider({ children }) {
  const [displaySize, setDisplaySize] = useState(getInitialSize)
  const [bookingColorScheme, setBookingColorScheme] = useState(getInitialBookingColorScheme)
  const [dragLockMode, setDragLockMode] = useState(getInitialDragLockMode)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(displaySize))
    document.documentElement.style.fontSize = `${16 * displaySize / 100}px`
    delete document.documentElement.dataset.fontSize
  }, [displaySize])

  useEffect(() => {
    window.localStorage.setItem(BOOKING_COLORS_STORAGE_KEY, bookingColorScheme)
  }, [bookingColorScheme])

  useEffect(() => {
    window.localStorage.setItem(DRAG_LOCK_STORAGE_KEY, dragLockMode)
  }, [dragLockMode])

  const value = useMemo(() => ({
    displaySize,
    setDisplaySize,
    bookingColorScheme,
    setBookingColorScheme,
    dragLockMode,
    setDragLockMode,
  }), [bookingColorScheme, displaySize, dragLockMode])

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
}
