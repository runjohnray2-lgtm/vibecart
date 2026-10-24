import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

async function transpile(path) {
  const source = await readFile(path, "utf8")
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

function evaluate(code, shims) {
  const testModule = { exports: {} }
  const shimRequire = (name) => {
    if (name in shims) return shims[name]
    throw new Error(`Unexpected import in module under test: ${name}`)
  }
  new Function("require", "exports", "module", code)(shimRequire, testModule.exports, testModule)
  return testModule.exports
}

const routeCode = await transpile("app/api/webhook/stripe/route.ts")

function loadRoute({
  persistVerifiedCheckoutEvent = async (_event, session) => ({ id: `ord_${session.id}` }),
  attemptCloudOutboxForOrder = async () => null,
} = {}) {
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
    "@/lib/payment-durability": { persistVerifiedCheckoutEvent },
    "@/lib/cloud-outbox": { attemptCloudOutboxForOrder },
  })
}

function paidEvent(overrides = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1_700_000_000,
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

test("Core durable storage failure returns 503 so Stripe retries", async () => {
  let cloudCalls = 0
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async () => {
      throw new Error("database unavailable")
    },
    attemptCloudOutboxForOrder: async () => {
      cloudCalls += 1
      return null
    },
  })

  const response = await deliver(route, paidEvent())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    received: false,
    retry: true,
    error: "Durable order persistence temporarily unavailable.",
  })
  assert.equal(cloudCalls, 0)
})

test("Cloud is optional: unconfigured Cloud still acknowledges after Core persists", async () => {
  let persisted = 0
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async (_event, session) => {
      persisted += 1
      return { id: `ord_${session.id}` }
    },
    attemptCloudOutboxForOrder: async () => null,
  })

  const response = await deliver(route, paidEvent())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { received: true })
  assert.equal(persisted, 1)
})

test("Cloud delivery failure does not replay a Core-persisted payment", async () => {
  let persisted = 0
  let attempts = 0
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async (_event, session) => {
      persisted += 1
      return { id: `ord_${session.id}` }
    },
    attemptCloudOutboxForOrder: async () => {
      attempts += 1
      return { configured: true, delivered: false, retryable: true, reason: "network" }
    },
  })

  const response = await deliver(route, paidEvent())
  assert.equal(response.status, 200)
  assert.equal(persisted, 1)
  assert.equal(attempts, 1)
})

test("Successful Core persistence acknowledges completed and async-success events", async () => {
  const persisted = []
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async (event, session) => {
      persisted.push([event.id, session.id])
      return { id: `ord_${session.id}` }
    },
  })

  assert.equal((await deliver(route, paidEvent())).status, 200)
  assert.equal((await deliver(route, paidEvent({
    id: "evt_2",
    type: "checkout.session.async_payment_succeeded",
    data: { object: { id: "cs_test_2", payment_status: "unpaid", amount_total: 1200 } },
  }))).status, 200)

  assert.deepEqual(persisted, [["evt_1", "cs_test_1"], ["evt_2", "cs_test_2"]])
})

test("Duplicate Stripe delivery can persist exactly one durable order", async () => {
  const orders = new Map()
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async (event, session) => {
      if (!orders.has(session.id)) orders.set(session.id, event.id)
      return { id: `ord_${session.id}` }
    },
  })

  assert.equal((await deliver(route, paidEvent())).status, 200)
  assert.equal((await deliver(route, paidEvent())).status, 200)
  assert.equal(orders.size, 1)
})

test("Signature verification gates durable storage and Cloud delivery", async () => {
  let persistCalls = 0
  let cloudCalls = 0
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async () => {
      persistCalls += 1
      return { id: "ord_1" }
    },
    attemptCloudOutboxForOrder: async () => {
      cloudCalls += 1
      return null
    },
  })

  assert.equal((await deliver(route, paidEvent(), "forged")).status, 400)
  const missing = await route.POST(new Request("https://example.test/api/webhook/stripe", {
    method: "POST",
    body: JSON.stringify(paidEvent()),
  }))
  assert.equal(missing.status, 400)
  assert.equal(persistCalls, 0)
  assert.equal(cloudCalls, 0)
})

test("Events that are not payment-ready or not order events still return 200 without persistence", async () => {
  let persistCalls = 0
  const route = loadRoute({
    persistVerifiedCheckoutEvent: async () => {
      persistCalls += 1
      return { id: "ord_1" }
    },
  })

  const unpaid = await deliver(route, paidEvent({
    data: { object: { id: "cs_test_3", payment_status: "unpaid" } },
  }))
  assert.equal(unpaid.status, 200)

  const other = await deliver(route, {
    id: "evt_3",
    type: "charge.succeeded",
    data: { object: { id: "ch_1" } },
  })
  assert.equal(other.status, 200)
  assert.equal(persistCalls, 0)
})

test("Webhook returns 501 when Stripe secrets are missing", async () => {
  const route = loadRoute()
  const saved = process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
  try {
    assert.equal((await deliver(route, paidEvent())).status, 501)
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = saved
  }
})

test("Webhook source persists Core before attempting optional Cloud delivery", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  const persist = source.indexOf("persistVerifiedCheckoutEvent(event, session, stripe)")
  const cloud = source.indexOf("attemptCloudOutboxForOrder(orderId)")
  assert.ok(persist >= 0)
  assert.ok(cloud > persist)
  assert.match(source, /Core order storage is authoritative/)
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
