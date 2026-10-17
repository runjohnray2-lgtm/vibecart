import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

// These tests execute the real route.ts / stripe-mode.ts source (transpiled with
// the repo's TypeScript) against in-memory stand-ins for Stripe and Cloud ingest.
// They verify the webhook's acknowledgement contract, not Neon or Stripe itself.
const require = createRequire(import.meta.url)
const ts = require("typescript")

async function transpile(path) {
  const source = await readFile(path, "utf8")
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

function evaluate(code, shims) {
  const module = { exports: {} }
  const shimRequire = (name) => {
    if (name in shims) return shims[name]
    throw new Error(`Unexpected import in module under test: ${name}`)
  }
  new Function("require", "exports", "module", code)(shimRequire, module.exports, module)
  return module.exports
}

const routeCode = await transpile("app/api/webhook/stripe/route.ts")

function loadRoute(forwardVerifiedCheckoutEvent) {
  class FakeStripe {
    constructor() {
      this.webhooks = {
        constructEvent: (raw, signature) => {
          if (signature !== "valid") throw new Error("bad signature")
          return JSON.parse(raw)
        },
      }
    }
  }
  return evaluate(routeCode, {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    stripe: { __esModule: true, default: FakeStripe },
    "@/lib/cloud-events": { forwardVerifiedCheckoutEvent },
  })
}

function paidEvent(overrides = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", payment_status: "paid", amount_total: 1200 } },
    ...overrides,
  }
}

function deliver(route, event, signature = "valid") {
  return route.POST(new Request("https://example.test/api/webhook/stripe", {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: JSON.stringify(event),
  }))
}

const originalEnv = { ...process.env }
process.env.STRIPE_SECRET_KEY = "sk_test_unit"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit"
test.after(() => {
  process.env = originalEnv
})

test("Cloud unconfigured: verified paid event is NOT acknowledged with 200", async () => {
  const route = loadRoute(async () => ({ configured: false, delivered: false, retryable: false }))
  const response = await deliver(route, paidEvent())
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.received, false)
  assert.equal(body.retry, true)
})

test("Cloud misconfigured or rejecting: non-2xx so Stripe retries", async () => {
  for (const reason of ["incomplete_config", "cloud_rejected", "timeout", "network", "order_normalization"]) {
    const route = loadRoute(async () => ({ configured: true, delivered: false, retryable: true, reason }))
    const response = await deliver(route, paidEvent())
    assert.equal(response.status, 503, reason)
    assert.equal((await response.json()).received, false, reason)
  }
})

test("Even a non-retryable failed delivery cannot produce 200", async () => {
  const route = loadRoute(async () => ({ configured: true, delivered: false, retryable: false }))
  assert.equal((await deliver(route, paidEvent())).status, 503)
})

test("Successful ingestion acknowledges with 200 for completed and async-success events", async () => {
  const forwarded = []
  const route = loadRoute(async (event, session) => {
    forwarded.push([event.id, session.id])
    return { configured: true, delivered: true, retryable: false, status: 201 }
  })
  const completed = await deliver(route, paidEvent())
  assert.equal(completed.status, 200)
  assert.deepEqual(await completed.json(), { received: true })

  const async = await deliver(route, paidEvent({
    id: "evt_2",
    type: "checkout.session.async_payment_succeeded",
    data: { object: { id: "cs_test_2", payment_status: "unpaid" } },
  }))
  assert.equal(async.status, 200)
  assert.deepEqual(forwarded, [["evt_1", "cs_test_1"], ["evt_2", "cs_test_2"]])
})

test("Duplicate delivery and retry after outage persist exactly one order", async () => {
  // Stand-in for Cloud ingest + storeVerifiedOrder: unique on checkout session, like
  // the real ON CONFLICT (checkout_session_id) upsert.
  const orders = new Map()
  let cloudUp = false
  const route = loadRoute(async (event, session) => {
    if (!cloudUp) return { configured: true, delivered: false, retryable: true, reason: "network" }
    orders.set(session.id, event.id)
    return { configured: true, delivered: true, retryable: false, status: 201 }
  })

  assert.equal((await deliver(route, paidEvent())).status, 503, "outage must trigger a Stripe retry")
  assert.equal(orders.size, 0)

  cloudUp = true
  assert.equal((await deliver(route, paidEvent())).status, 200, "retry succeeds once Cloud is back")
  assert.equal((await deliver(route, paidEvent())).status, 200, "duplicate delivery is acknowledged")
  assert.equal(orders.size, 1, "duplicate delivery must not create a second order")
})

test("Signature verification still gates everything: bad signature returns 400 and never forwards", async () => {
  let calls = 0
  const route = loadRoute(async () => {
    calls += 1
    return { configured: true, delivered: true, retryable: false }
  })
  assert.equal((await deliver(route, paidEvent(), "forged")).status, 400)
  const missing = await route.POST(new Request("https://example.test/api/webhook/stripe", {
    method: "POST",
    body: JSON.stringify(paidEvent()),
  }))
  assert.equal(missing.status, 400)
  assert.equal(calls, 0)
})

test("Events that are not payment-ready or not order events still return 200 without forwarding", async () => {
  let calls = 0
  const route = loadRoute(async () => {
    calls += 1
    return { configured: false, delivered: false, retryable: false }
  })
  const unpaid = await deliver(route, paidEvent({
    data: { object: { id: "cs_test_3", payment_status: "unpaid" } },
  }))
  assert.equal(unpaid.status, 200)
  const other = await deliver(route, { id: "evt_3", type: "charge.succeeded", data: { object: { id: "ch_1" } } })
  assert.equal(other.status, 200)
  assert.equal(calls, 0)
})

test("Webhook still returns 501 when Stripe secrets are missing", async () => {
  const route = loadRoute(async () => ({ configured: true, delivered: true, retryable: false }))
  const saved = process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
  try {
    assert.equal((await deliver(route, paidEvent())).status, 501)
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = saved
  }
})

test("stripeKeyMode classifies by prefix and never echoes the key", async () => {
  const { stripeKeyMode } = evaluate(await transpile("lib/stripe-mode.ts"), {})
  assert.equal(stripeKeyMode("sk_test_abc"), "test")
  assert.equal(stripeKeyMode("rk_test_abc"), "test")
  assert.equal(stripeKeyMode("  sk_live_abc "), "live")
  assert.equal(stripeKeyMode("rk_live_abc"), "live")
  for (const bad of ["", undefined, null, "pk_test_abc", "\"sk_test_abc\"", "whsec_abc", "mk_123"]) {
    assert.equal(stripeKeyMode(bad), "unknown", String(bad))
  }
})

test("Checkout labels sessions by key mode instead of hardcoding live; MCP schema allows test", async () => {
  const checkout = await readFile("app/api/checkout/route.ts", "utf8")
  assert.match(checkout, /import \{ stripeKeyMode \} from "@\/lib\/stripe-mode"/)
  assert.match(checkout, /mode: stripeKeyMode\(secretKey\) === "test" \? "test" : "live"/)
  assert.doesNotMatch(checkout, /^\s*mode: "live",\s*$/m)
  const mcp = await readFile("app/mcp/route.ts", "utf8")
  assert.match(mcp, /enum: \["demo", "test", "live"\]/)
  const health = await readFile("app/api/health/route.ts", "utf8")
  assert.match(health, /stripeKeyMode\(value\)/)
})
