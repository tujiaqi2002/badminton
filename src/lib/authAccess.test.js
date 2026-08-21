import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN_ACCESS_STATUS,
  authRedirectUrl,
  checkAdminAccess,
} from './authAccess.js'

const managerId = 'manager-1'
const session = { access_token: 'test-token', user: { id: managerId } }
const verifiedUser = { id: managerId }
const noWait = async () => {}

const authorizedCheck = (overrides = {}) => checkAdminAccess({
  expectedUserId: managerId,
  getSession: async () => ({ session }),
  getVerifiedUser: async () => ({ user: verifiedUser }),
  getStaffRole: async () => ({ data: { role: 'admin' } }),
  sleep: noWait,
  ...overrides,
})

test('auth redirect uses an exact configured production URL', () => {
  assert.equal(authRedirectUrl({
    siteUrl: 'https://tujiaqi2002.github.io/badminton/',
    baseUrl: './',
    currentUrl: 'https://tujiaqi2002.github.io/badminton/**?error=1#token',
  }), 'https://tujiaqi2002.github.io/badminton/')
})

test('relative Vite base removes a wildcard path on localhost', () => {
  assert.equal(authRedirectUrl({
    baseUrl: './',
    currentUrl: 'http://localhost:5173/**?next=admin#oauth',
  }), 'http://localhost:5173/')
})

test('relative Vite base preserves the GitHub Pages deployment directory', () => {
  assert.equal(authRedirectUrl({
    baseUrl: './',
    currentUrl: 'https://tujiaqi2002.github.io/badminton/**?next=admin#oauth',
  }), 'https://tujiaqi2002.github.io/badminton/')
})

test('transient staff 401 is retried and can authorize', async () => {
  let roleCalls = 0
  const result = await authorizedCheck({
    getStaffRole: async () => {
      roleCalls += 1
      return roleCalls === 1
        ? { error: { message: 'Unauthorized' }, status: 401 }
        : { data: { role: 'admin' }, status: 200 }
    },
  })

  assert.equal(result.status, ADMIN_ACCESS_STATUS.AUTHORIZED)
  assert.equal(result.attempts, 2)
  assert.equal(roleCalls, 2)
})

test('missing initial session is retried before checking the role', async () => {
  let sessionCalls = 0
  const result = await authorizedCheck({
    getSession: async () => {
      sessionCalls += 1
      return sessionCalls === 1 ? { session: null } : { session }
    },
  })

  assert.equal(result.status, ADMIN_ACCESS_STATUS.AUTHORIZED)
  assert.equal(result.attempts, 2)
})

test('persistent staff 401 becomes a retryable error instead of denial', async () => {
  let roleCalls = 0
  const result = await authorizedCheck({
    getStaffRole: async () => {
      roleCalls += 1
      return { error: { message: 'Unauthorized' }, status: 401 }
    },
  })

  assert.equal(result.status, ADMIN_ACCESS_STATUS.ERROR)
  assert.equal(result.stage, 'role')
  assert.equal(result.attempts, 3)
  assert.equal(roleCalls, 3)
})

test('a successful role lookup without admin access is denied without retry', async () => {
  let roleCalls = 0
  const result = await authorizedCheck({
    getStaffRole: async () => {
      roleCalls += 1
      return { data: null, status: 200 }
    },
  })

  assert.equal(result.status, ADMIN_ACCESS_STATUS.DENIED)
  assert.equal(result.attempts, 1)
  assert.equal(roleCalls, 1)
})

test('verified admin access is authorized on the first attempt', async () => {
  const result = await authorizedCheck()
  assert.equal(result.status, ADMIN_ACCESS_STATUS.AUTHORIZED)
  assert.equal(result.attempts, 1)
})

test('an obsolete request cannot apply its result', async () => {
  let current = true
  const result = await authorizedCheck({
    getVerifiedUser: async () => {
      current = false
      return { user: verifiedUser }
    },
    isCurrent: () => current,
  })

  assert.equal(result.status, 'stale')
})
