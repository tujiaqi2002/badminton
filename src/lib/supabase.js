import { createClient } from '@supabase/supabase-js'
import { isReservationReadShadowEnabled } from './reservationReadShadow.js'
import { normalizeReservationOrderReadSource } from './reservationOrderRead.js'
import { normalizeReservationScheduleReadSource } from './reservationScheduleRead.js'
import { normalizeReservationSelectedDetailReadSource } from './reservationSelectedDetailRead.js'
import { isStagingPasswordAuthAllowed } from './stagingAuth.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('YOUR_PROJECT') && !anonKey.includes('YOUR_SUPABASE'),
)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export const stripeEnabled = import.meta.env.VITE_STRIPE_ENABLED === 'true'
export const googleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true'
export const stagingPasswordAuthEnabled = isStagingPasswordAuthAllowed({
  enabled: import.meta.env.VITE_STAGING_PASSWORD_AUTH,
  appEnvironment: import.meta.env.VITE_APP_ENVIRONMENT,
  supabaseUrl: url,
  expectedProjectRef: import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF,
  hostname: typeof window === 'undefined' ? '' : window.location.hostname,
})
export const reservationReadShadowEnabled = isReservationReadShadowEnabled(
  import.meta.env.VITE_RESERVATION_READ_SHADOW,
)
export const reservationScheduleReadSource = normalizeReservationScheduleReadSource(
  import.meta.env.VITE_RESERVATION_SCHEDULE_READ_SOURCE,
)
export const reservationOrderReadSource = normalizeReservationOrderReadSource(
  import.meta.env.VITE_RESERVATION_ORDER_READ_SOURCE,
)
export const reservationSelectedDetailReadSource = normalizeReservationSelectedDetailReadSource(
  import.meta.env.VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE,
)
