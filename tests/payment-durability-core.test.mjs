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

function normalizedOrder(cartId = "") {
  return {
    checkoutSessionId: "cs_test_1",
    cartId,
    stripePaymentIntentId: "pi_1",
    customerEmail: "buyer@example.com",
    customerName: "Buyer",
    customerPhone: "",
    shipping: { name: "Buyer", line1: "1 Main", line2: "", city: "Town", state: "OR", postalCode: "97415", country: "US" },
    amountSubtotal: 1200,
    amountShipping: 0,
    amountTax: 0,
    amountTotal: 1200,
    currency: "usd",
    paymentStatus: "paid",
    lines: [{
      lineItemId: "li_1",
      productId: "sku_1",
      description: "Product",
      quantity: 1,
      unitAmount: 1200,
      amountSubtotal: 1200,
      amountDiscount: 0,
      amountTax: 0,
      amountTotal: 1200,
      currency: "usd",
    }],
  }
}

async function loadPaymentDurability({ cloudRequested = false, hosted = false, configuredId = "merchant_a", cart = null } = {}) {
  const stores = []
  const mod = evaluate(await transpile("lib/payment-durability.ts"), {
    "@/lib/orders": { buildNormalizedOrder: async (_stripe, session) => normalizedOrder(session.client_reference_id ?? "") },
    "@/lib/cart-store": { getCart: async () => cart },
    "@/lib/merchant-auth": {
      configuredMerchantId: () => configuredId,
      hostedModeEnabled: () => hosted,
    },
    "@/lib/cloud-events": { cloudDeliveryRequested: () => cloudRequested },
    "@/lib/order-store": {
      storeVerifiedOrder: async input => {
        stores.push(input)
        return { id: "ord_1", ...input.order, orderId: "ord_1", merchantId: input.merchantId, eventId: input.eventId, status: "paid", fulfillmentStatus: "new", metadata: input.metadata, createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z" }
      },
    },
  })
  return { mod, stores }
}

test("Core order persistence does not require Cloud configuration", async () => {
  const { mod, stores } = await loadPaymentDurability({ cloudRequested: false })
  const order = await mod.persistVerifiedCheckoutEvent(
    { id: "evt_1", type: "checkout.session.completed", created: 1_700_000_000 },
    { id: "cs_test_1", metadata: {}, payment_status: "paid" },
    {}
  )
  assert.equal(order.id, "ord_1")
  assert.equal(stores.length, 1)
  assert.equal(stores[0].merchantId, "merchant_a")
  assert.equal(stores[0].cloudOutbox, undefined)
})

test("Cloud-requested payments seed a replayable outbox in the same Core store call", async () => {
  const { mod, stores } = await loadPaymentDurability({ cloudRequested: true })
  await mod.persistVerifiedCheckoutEvent(
    { id: "evt_2", type: "checkout.session.async_payment_succeeded", created: 1_700_000_123 },
    { id: "cs_test_1", metadata: {}, payment_status: "paid" },
    {}
  )
  assert.deepEqual(stores[0].cloudOutbox, {
    eventId: "evt_2",
    eventType: "checkout.session.async_payment_succeeded",
    eventCreatedAt: new Date(1_700_000_123 * 1000).toISOString(),
  })
})

test("Hosted mode rejects Stripe merchant identity that belongs to another tenant", async () => {
  const { mod, stores } = await loadPaymentDurability({ hosted: true, configuredId: "merchant_a" })
  await assert.rejects(
    () => mod.persistVerifiedCheckoutEvent(
      { id: "evt_3", type: "checkout.session.completed", created: 1_700_000_000 },
      { id: "cs_test_1", metadata: { vibecart_merchant_id: "merchant_b" }, payment_status: "paid" },
      {}
    ),
    /does not match this hosted merchant/
  )
  assert.equal(stores.length, 0)
})

test("Cart-backed payment uses the verified cart tenant and metadata", async () => {
  const cart = {
    id: "cart_1",
    merchantId: "merchant_a",
    metadata: { attribution: "ai-salesperson" },
  }
  const { mod, stores } = await loadPaymentDurability({ cart })
  await mod.persistVerifiedCheckoutEvent(
    { id: "evt_4", type: "checkout.session.completed", created: 1_700_000_000 },
    {
      id: "cs_test_1",
      client_reference_id: "cart_1",
      metadata: { vibecart_merchant_id: "merchant_a" },
      payment_status: "paid",
    },
    {}
  )
  assert.equal(stores[0].merchantId, "merchant_a")
  assert.deepEqual(stores[0].metadata, { attribution: "ai-salesperson" })
})

test("migration 007 and order-store make Core + optional Cloud state recoverable and tenant-scoped", async () => {
  const migration = await readFile("migrations/007_core_order_outbox.sql", "utf8")
  const store = await readFile("lib/order-store.ts", "utf8")
  const outbox = await readFile("lib/cloud-outbox.ts", "utf8")
  const cron = await readFile("app/api/cron/cloud-outbox/route.ts", "utf8")
  const vercel = await readFile("vercel.json", "utf8")

  assert.match(migration, /vibecart_cloud_outbox/)
  assert.match(migration, /order_id text NOT NULL UNIQUE REFERENCES vibecart_orders/)
  assert.match(migration, /status IN \('pending','processing','delivered','dead_letter'\)/)
  assert.match(migration, /lease_until/)
  assert.match(store, /db\.transaction\(queries\)/)
  assert.match(store, /WHERE id = \$\{order\.cartId\} AND merchant_id = \$\{merchantId\}/)
  assert.match(store, /INSERT INTO vibecart_cloud_outbox/)
  assert.match(outbox, /FOR UPDATE SKIP LOCKED/)
  assert.match(outbox, /MAX_OUTBOX_ATTEMPTS = 12/)
  assert.match(outbox, /status = 'dead_letter'/)
  assert.match(cron, /VIBECART_CLOUD_OUTBOX_CRON_ENABLED/)
  assert.match(cron, /CRON_SECRET/)
  assert.match(vercel, /"schedule": "\*\/5 \* \* \* \*"/)
})
