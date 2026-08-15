import { useEffect, useMemo, useState } from 'react'
import { BOOKING_COLOR_SCHEMES, DEFAULT_BOOKING_COLOR_SCHEME } from '../lib/bookingColors'
import { DisplayContext, DISPLAY_SIZES } from '../lib/display'

const STORAGE_KEY = 'tiger-display-size'
const BOOKING_COLORS_STORAGE_KEY = 'tiger-booking-color-scheme'

const getInitialSize = () => {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return DISPLAY_SIZES.some(({ id }) => id === stored) ? stored : 'standard'
}

const getInitialBookingColorScheme = () => {
  const stored = window.localStorage.getItem(BOOKING_COLORS_STORAGE_KEY)
  return BOOKING_COLOR_SCHEMES.some(({ id }) => id === stored) ? stored : DEFAULT_BOOKING_COLOR_SCHEME
}

export default function DisplayProvider({ children }) {
  const [displaySize, setDisplaySize] = useState(getInitialSize)
  const [bookingColorScheme, setBookingColorScheme] = useState(getInitialBookingColorScheme)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, displaySize)
    document.documentElement.dataset.fontSize = displaySize
  }, [displaySize])

  useEffect(() => {
    window.localStorage.setItem(BOOKING_COLORS_STORAGE_KEY, bookingColorScheme)
  }, [bookingColorScheme])

  const value = useMemo(() => ({ displaySize, setDisplaySize, bookingColorScheme, setBookingColorScheme }), [bookingColorScheme, displaySize])

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
}
