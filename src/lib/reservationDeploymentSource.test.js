import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const deployWorkflowPath = new URL('../../.github/workflows/deploy.yml', import.meta.url)

test('production deployment exposes one fail-closed schedule source selector', async () => {
  const workflow = await readFile(deployWorkflowPath, 'utf8')
  const selector = /VITE_RESERVATION_SCHEDULE_READ_SOURCE:\s*\$\{\{\s*vars\.VITE_RESERVATION_SCHEDULE_READ_SOURCE\s*\|\|\s*'legacy'\s*\}\}/g

  assert.equal(workflow.match(selector)?.length, 1)
  assert.doesNotMatch(
    workflow,
    /VITE_RESERVATION_SCHEDULE_READ_SOURCE:\s*\$\{\{[^\n]*\|\|\s*'canonical'/,
  )
})

test('production deployment exposes one fail-closed selected-detail source selector', async () => {
  const workflow = await readFile(deployWorkflowPath, 'utf8')
  const selector = /VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE:\s*\$\{\{\s*vars\.VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE\s*\|\|\s*'legacy'\s*\}\}/g

  assert.equal(workflow.match(selector)?.length, 1)
  assert.doesNotMatch(
    workflow,
    /VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE:\s*\$\{\{[^\n]*\|\|\s*'canonical'/,
  )
})

test('production deployment exposes one fail-closed order source selector', async () => {
  const workflow = await readFile(deployWorkflowPath, 'utf8')
  const selector = /VITE_RESERVATION_ORDER_READ_SOURCE:\s*\$\{\{\s*vars\.VITE_RESERVATION_ORDER_READ_SOURCE\s*\|\|\s*'legacy'\s*\}\}/g

  assert.equal(workflow.match(selector)?.length, 1)
  assert.doesNotMatch(
    workflow,
    /VITE_RESERVATION_ORDER_READ_SOURCE:\s*\$\{\{[^\n]*\|\|\s*'canonical'/,
  )
})

test('production deployment exposes one fail-closed profile write source selector', async () => {
  const workflow = await readFile(deployWorkflowPath, 'utf8')
  const selector = /VITE_RESERVATION_PROFILE_WRITE_SOURCE:\s*\$\{\{\s*vars\.VITE_RESERVATION_PROFILE_WRITE_SOURCE\s*\|\|\s*'legacy'\s*\}\}/g

  assert.equal(workflow.match(selector)?.length, 1)
  assert.doesNotMatch(
    workflow,
    /VITE_RESERVATION_PROFILE_WRITE_SOURCE:\s*\$\{\{[^\n]*\|\|\s*'canonical'/,
  )
})
