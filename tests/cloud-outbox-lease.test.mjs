import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = await readFile('lib/cloud-outbox.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

for (const delivered of [true, false]) {
  test(`expired worker cannot ${delivered ? 'complete' : 'reschedule'} a reclaimed Cloud delivery`, async () => {
    let state = { id: 'outbox_1', order_id: 'ord_1', merchant_id: 'merchant_a', event_id: 'evt_1', event_type: 'checkout.session.completed', event_created_at: new Date(), status: 'pending', attempt_count: 0, lease_token: null }
    let forwardCalls = 0
    let oldWorker
    let finishOld
    const oldResponse = new Promise(resolve => { finishOld = resolve })
    const db = async (parts, ...values) => {
      const query = parts.join('?')
      if (query.includes("SET status = 'processing'")) {
        state = { ...state, status: 'processing', lease_token: values[0] }
        return [{ ...state }]
      }
      if (query.includes('UPDATE vibecart_cloud_outbox')) {
        // Emulate UPDATE's ownership predicate. Without fencing this old worker
        // would overwrite the processing row belonging to the replacement.
        const fenced = query.includes('AND lease_token = ?')
        if (state.status === 'processing' && (!fenced || values.at(-1) === state.lease_token)) {
          state.status = query.includes("SET status = 'delivered'") ? 'delivered' : values[0]
          state.attempt_count += 1
          state.lease_token = null
        }
        return []
      }
      throw new Error(`Unexpected SQL: ${query}`)
    }
    const mod = { exports: {} }
    new Function('require', 'exports', 'module', code)(name => {
      if (name === 'node:crypto') return require(name)
      if (name === '@neondatabase/serverless') return { neon: () => db }
      if (name === '@/lib/order-store') return { getStoredOrder: async () => ({ merchantId: 'merchant_a' }) }
      if (name === '@/lib/cloud-events') return {
        cloudDeliveryRequested: () => true,
        forwardStoredOrderEvent: async () => {
          forwardCalls += 1
          if (forwardCalls === 1) return oldResponse
          // Leave replacement in flight while the stale worker finishes.
          finishOld({ configured: true, delivered, reason: 'network' })
          await oldWorker
          assert.equal(state.status, 'processing')
          assert.equal(state.attempt_count, 0)
          return { configured: true, delivered: true }
        },
      }
      throw new Error(`Unexpected import: ${name}`)
    }, mod.exports, mod)
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://test.invalid/test'
    try {
      oldWorker = mod.exports.attemptCloudOutboxForOrder('ord_1')
      // Expose promise to forward callback after the first worker reaches IO.
      await new Promise(resolve => setImmediate(resolve))
      // drainCloudOutbox simulates a cron claim after lease expiry.
      // The fake DB returns a fresh claim, as PostgreSQL does after expiry.
      const replacement = mod.exports.drainCloudOutbox()
      await Promise.all([oldWorker, replacement])
      assert.equal(state.status, 'delivered')
      assert.equal(state.attempt_count, 1)
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }
  })
}
