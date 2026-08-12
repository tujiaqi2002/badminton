import { createClient } from '@supabase/supabase-js'

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
