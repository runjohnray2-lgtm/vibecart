import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('integration review branch cannot trigger Vercel Git deployment', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'))
  assert.deepEqual(config.git.deploymentEnabled, { 'work/pilot-integration-review': false })
  assert.equal(Object.hasOwn(config.git.deploymentEnabled, 'main'), false)
})
