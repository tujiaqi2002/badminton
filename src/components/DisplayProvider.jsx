import { useEffect, useMemo, useState } from 'react'
import { BOOKING_COLOR_SCHEMES, DEFAULT_BOOKING_COLOR_SCHEME } from '../lib/bookingColors'
import { DisplayContext, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN } from '../lib/display'

const STORAGE_KEY = 'tiger-display-size'
const BOOKING_COLORS_STORAGE_KEY = 'tiger-booking-color-scheme'

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

export default function DisplayProvider({ children }) {
  const [displaySize, setDisplaySize] = useState(getInitialSize)
  const [bookingColorScheme, setBookingColorScheme] = useState(getInitialBookingColorScheme)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(displaySize))
    document.documentElement.style.fontSize = `${16 * displaySize / 100}px`
    delete document.documentElement.dataset.fontSize
  }, [displaySize])

  useEffect(() => {
    window.localStorage.setItem(BOOKING_COLORS_STORAGE_KEY, bookingColorScheme)
  }, [bookingColorScheme])

  const value = useMemo(() => ({ displaySize, setDisplaySize, bookingColorScheme, setBookingColorScheme }), [bookingColorScheme, displaySize])

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
}
