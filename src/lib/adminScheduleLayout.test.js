import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adminScheduleOffsetPx,
  adminScheduleSlotHeightPx,
  normalizeAdminScheduleSlotMinutes,
} from './adminScheduleLayout.js'

test('manager schedule keeps one pixel per minute for every supported slot size', () => {
  for (const slotMinutes of [15, 30, 60]) {
    assert.equal(adminScheduleSlotHeightPx(slotMinutes), slotMinutes)
    assert.equal(adminScheduleOffsetPx(30 / slotMinutes, slotMinutes), 30)
    assert.equal(adminScheduleOffsetPx(360 / slotMinutes, slotMinutes), 360)
  }
})

test('manager schedule falls back to the default slot size for invalid configuration', () => {
  for (const value of [undefined, null, 0, -15, Number.NaN, 'invalid']) {
    assert.equal(normalizeAdminScheduleSlotMinutes(value), 30)
    assert.equal(adminScheduleSlotHeightPx(value), 30)
  }
})
