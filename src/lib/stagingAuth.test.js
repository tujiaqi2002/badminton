import assert from 'node:assert/strict'
import test from 'node:test'

import { getSupabaseProjectRef, isStagingPasswordAuthAllowed } from './stagingAuth.js'

const allowedConfiguration = {
  enabled: 'true',
  appEnvironment: 'staging',
  supabaseUrl: 'https://stageproject.supabase.co',
  expectedProjectRef: 'stageproject',
  hostname: '127.0.0.1',
}

test('extracts only a standard Supabase project ref', () => {
  assert.equal(getSupabaseProjectRef('https://stageproject.supabase.co'), 'stageproject')
  assert.equal(getSupabaseProjectRef('https://example.com'), null)
  assert.equal(getSupabaseProjectRef('not-a-url'), null)
})

test('allows password auth only for the exact local staging project', () => {
  assert.equal(isStagingPasswordAuthAllowed(allowedConfiguration), true)
  assert.equal(isStagingPasswordAuthAllowed({ ...allowedConfiguration, hostname: 'localhost' }), true)
  assert.equal(isStagingPasswordAuthAllowed({ ...allowedConfiguration, hostname: '::1' }), true)
})

test('fails closed when any staging password-auth gate is missing or mismatched', () => {
  const rejectedConfigurations = [
    { enabled: 'false' },
    { enabled: undefined },
    { appEnvironment: 'production' },
    { appEnvironment: undefined },
    { expectedProjectRef: '' },
    { expectedProjectRef: 'productionproject' },
    { supabaseUrl: 'https://productionproject.supabase.co' },
    { supabaseUrl: 'https://example.com' },
    { hostname: 'tujiaqi2002.github.io' },
    { hostname: undefined },
  ]

  for (const override of rejectedConfigurations) {
    assert.equal(
      isStagingPasswordAuthAllowed({ ...allowedConfiguration, ...override }),
      false,
      JSON.stringify(override),
    )
  }
})
