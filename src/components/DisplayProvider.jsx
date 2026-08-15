import { useEffect, useMemo, useState } from 'react'
import { DisplayContext, DISPLAY_SIZES } from '../lib/display'

const STORAGE_KEY = 'tiger-display-size'

const getInitialSize = () => {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return DISPLAY_SIZES.some(({ id }) => id === stored) ? stored : 'standard'
}

export default function DisplayProvider({ children }) {
  const [displaySize, setDisplaySize] = useState(getInitialSize)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, displaySize)
    document.documentElement.dataset.fontSize = displaySize
  }, [displaySize])

  const value = useMemo(() => ({ displaySize, setDisplaySize }), [displaySize])

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
}
