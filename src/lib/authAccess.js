export const ADMIN_ACCESS_STATUS = Object.freeze({
  CHECKING: 'checking',
  AUTHORIZED: 'authorized',
  DENIED: 'denied',
  ERROR: 'error',
})

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 180

const errorMessage = (result) => `${result?.error?.message || result?.message || ''}`.toLowerCase()

export const authRedirectUrl = ({ siteUrl = '', baseUrl = './', currentUrl }) => {
  const configuredUrl = siteUrl.trim() || baseUrl || './'
  const redirectUrl = new URL(configuredUrl, currentUrl)
  redirectUrl.search = ''
  redirectUrl.hash = ''
  if (!redirectUrl.pathname.endsWith('/')) redirectUrl.pathname = `${redirectUrl.pathname}/`
  return redirectUrl.href
}

export const shouldFetchSchedule = ({ supabaseConfigured, authReady, user, isAdmin }) => (
  !supabaseConfigured || Boolean(authReady && user && isAdmin)
)

export const isTransientAuthFailure = (result) => {
  const status = Number(result?.status ?? result?.error?.status)
  if (status === 0 || status === 401) return true
  const message = errorMessage(result)
  return [
    'failed to fetch',
    'load failed',
    'networkerror',
    'network error',
    'jwt expired',
    'invalid jwt',
    'session not found',
    'unauthorized',
  ].some((fragment) => message.includes(fragment))
}

const wait = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

const safeCall = async (operation) => {
  try {
    return await operation()
  } catch (error) {
    return { error }
  }
}

const staleResult = (attempts) => ({ status: 'stale', attempts })
const errorResult = (attempts, stage, result) => ({
  status: ADMIN_ACCESS_STATUS.ERROR,
  attempts,
  stage,
  error: result?.error || null,
})

export const checkAdminAccess = async ({
  expectedUserId,
  getSession,
  getVerifiedUser,
  getStaffRole,
  isCurrent = () => true,
  sleep = wait,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) => {
  const attemptsLimit = Math.max(1, maxAttempts)

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    if (!isCurrent()) return staleResult(attempt - 1)

    const sessionResult = await safeCall(getSession)
    if (!isCurrent()) return staleResult(attempt)
    const session = sessionResult?.session || sessionResult?.data?.session || null
    const sessionReady = !sessionResult?.error && session?.user?.id === expectedUserId

    if (!sessionReady) {
      const retryable = !session || isTransientAuthFailure(sessionResult)
      if (retryable && attempt < attemptsLimit) {
        await sleep(retryDelayMs * attempt)
        continue
      }
      return errorResult(attempt, 'session', sessionResult)
    }

    const userResult = await safeCall(() => getVerifiedUser(session.access_token))
    if (!isCurrent()) return staleResult(attempt)
    const verifiedUser = userResult?.user || userResult?.data?.user || null
    const userReady = !userResult?.error && verifiedUser?.id === expectedUserId

    if (!userReady) {
      const retryable = !verifiedUser || isTransientAuthFailure(userResult)
      if (retryable && attempt < attemptsLimit) {
        await sleep(retryDelayMs * attempt)
        continue
      }
      return errorResult(attempt, 'user', userResult)
    }

    const roleResult = await safeCall(() => getStaffRole(expectedUserId))
    if (!isCurrent()) return staleResult(attempt)

    if (!roleResult?.error) {
      return {
        status: roleResult?.data?.role === 'admin'
          ? ADMIN_ACCESS_STATUS.AUTHORIZED
          : ADMIN_ACCESS_STATUS.DENIED,
        attempts: attempt,
      }
    }

    if (isTransientAuthFailure(roleResult) && attempt < attemptsLimit) {
      await sleep(retryDelayMs * attempt)
      continue
    }

    return errorResult(attempt, 'role', roleResult)
  }

  return errorResult(attemptsLimit, 'unknown', null)
}
