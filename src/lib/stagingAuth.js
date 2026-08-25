const LOCAL_STAGING_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export const getSupabaseProjectRef = (supabaseUrl) => {
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase()
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/)
    return match?.[1] || null
  } catch {
    return null
  }
}

export const isStagingPasswordAuthAllowed = ({
  enabled,
  appEnvironment,
  supabaseUrl,
  expectedProjectRef,
  hostname,
}) => {
  const normalizedExpectedRef = expectedProjectRef?.trim().toLowerCase()

  return enabled === 'true'
    && appEnvironment === 'staging'
    && Boolean(normalizedExpectedRef)
    && getSupabaseProjectRef(supabaseUrl) === normalizedExpectedRef
    && LOCAL_STAGING_HOSTNAMES.has(hostname?.toLowerCase())
}
