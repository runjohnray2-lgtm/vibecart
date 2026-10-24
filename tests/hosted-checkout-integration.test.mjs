import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import ts from "typescript"
import Stripe from "stripe"
import { PGlite } from "@electric-sql/pglite"
import { runPilot } from "../scripts/radiantz-pilot-evidence.mjs"

const require = createRequire(import.meta.url)
async function load(path, shims) {
  const source = await readFile(path, "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const testModule = { exports: {} }
  new Function("require", "exports", "module", code)(name => {
    if (name in shims) return shims[name]
    if (name.startsWith("node:")) return require(name)
    throw new Error(`Unexpected import: ${name}`)
  }, testModule.exports, testModule)
  return testModule.exports
}

// Offline integration: actual auth/cart/checkout/normalization/order-store/webhook
// modules, real Stripe signature verification, and real PostgreSQL transactions.
// Only the Stripe network and Neon HTTP transports are replaced. Synthetic SKUs.
test("hosted merchant checkout -> signed payment -> atomic order, replay and isolation", async t => {
  const previous = { ...process.env }
  const db = new PGlite()
  let failLineWrite = false
  const sessions = new Map()
  const sessionRequests = []
  const idempotentSessions = new Map()
  const key = "a".repeat(32)
  const signingSecret = "whsec_offline_integration"
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://offline.invalid/test", VIBECART_HOSTED_MODE: "true",
    VIBECART_MERCHANT_ID: "merchant_a", VIBECART_MERCHANT_API_KEY: key,
    VIBECART_CART_ACCESS_SECRET: "b".repeat(32), STRIPE_SECRET_KEY: "sk_test_offline",
    STRIPE_WEBHOOK_SECRET: signingSecret,
  })
  for (const name of ["VERCEL_ENV", "VIBECART_CLOUD_INGEST_URL", "VIBECART_CLOUD_INGEST_KEY", "POSTGRES_URL"]) delete process.env[name]
  try {
    for (const name of ["001_durable_carts", "004_cart_metadata", "005_durable_orders", "007_core_order_outbox", "008_outbox_lease_ownership"]) await db.exec(await readFile(`migrations/${name}.sql`, "utf8"))
    function sql(parts, ...values) {
      const text = parts.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "")
      const run = async client => {
        if (failLineWrite && text.includes("INSERT INTO vibecart_order_lines")) throw new Error("Injected line-write failure")
        return (await client.query(text, values)).rows
      }
      return { run, then: (resolve, reject) => run(db).then(resolve, reject) }
    }
    sql.transaction = queries => db.transaction(async tx => {
      const results = []
      for (const query of queries) results.push(await query.run(tx))
      return results
    })
    const auth = await load("lib/merchant-auth.ts", {})
    const products = new Map(["sku_a", "sku_b"].map((id, index) => [id, { id, name: `Synthetic product ${index}`, priceCents: 1200 + index * 100, description: "Offline fixture", image: "", availability: "made_to_order", compatibility: { mode: "not_required" } }]))
    const catalog = { getCatalogProduct: async id => products.get(id), CatalogSourceError: class extends Error {} }
    const carts = await load("lib/cart-store.ts", { "@neondatabase/serverless": { neon: () => sql }, "@/lib/catalog-source": catalog, "@/lib/merchant-auth": auth })
    const orders = await load("lib/order-store.ts", { "@neondatabase/serverless": { neon: () => sql } })
    const normalizer = await load("lib/orders.ts", {})
    const durability = await load("lib/payment-durability.ts", {
      "@/lib/orders": normalizer, "@/lib/cart-store": carts, "@/lib/merchant-auth": auth,
      "@/lib/cloud-events": { cloudDeliveryRequested: () => false }, "@/lib/order-store": orders,
    })
    const signer = new Stripe("sk_test_offline")
    class OfflineStripe {
      webhooks = signer.webhooks
      checkout = { sessions: {
        create: async (params, options) => {
          const requestKey = options?.idempotencyKey
          const previous = requestKey && idempotentSessions.get(requestKey)
          if (previous) {
            if (previous.params !== JSON.stringify(params)) throw { type: "StripeIdempotencyError" }
            return previous.session
          }
          sessionRequests.push(params)
          const id = `cs_test_offline_${sessionRequests.length}`
          const total = params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0)
          const session = { id, object: "checkout.session", livemode: false, payment_status: "paid", amount_subtotal: total, amount_total: total, currency: "usd", client_reference_id: params.client_reference_id, metadata: params.metadata, payment_intent: `pi_${id}`, url: `https://checkout.stripe.com/offline/${id}` }
          sessions.set(id, { session, lines: params.line_items.map((line, index) => ({ id: `li_${index}`, quantity: line.quantity, description: line.price_data.product_data.name, currency: "usd", amount_subtotal: line.quantity * line.price_data.unit_amount, amount_total: line.quantity * line.price_data.unit_amount, amount_tax: 0, amount_discount: 0, price: { unit_amount: line.price_data.unit_amount, product: { id: `prod_${index}`, metadata: line.price_data.product_data.metadata } } })) })
          if (requestKey) idempotentSessions.set(requestKey, { params: JSON.stringify(params), session })
          return session
        },
        listLineItems: async id => ({ data: sessions.get(id).lines, has_more: false }),
      } }
    }
    const next = { NextResponse: { json: (body, init) => Response.json(body, init) } }
    const assistant = await load("lib/sales-assistant.ts", {})
    const checkout = await load("app/api/checkout/route.ts", {
      "next/server": next, stripe: OfflineStripe, "@/lib/stripe-mode": { stripeKeyMode: () => "test" },
      "@/lib/catalog-source": catalog, "@/lib/cart-store": carts, "@/lib/merchant-auth": auth,
      "@/lib/sales-assistant": assistant,
      "@/lib/he-said-nothing-config": { isHsnProductId: () => false },
    })
    const handoff = await load("app/api/cart/[id]/checkout/route.ts", {
      "next/server": next, "@/lib/cart-store": carts, "@/lib/merchant-auth": auth,
      "@/app/api/checkout/route": checkout,
    })
    const webhook = await load("app/api/webhook/stripe/route.ts", {
      "next/server": next, stripe: OfflineStripe, "@/lib/payment-durability": durability,
      "@/lib/cloud-outbox": { attemptCloudOutboxForOrder: async () => null },
    })
    const request = (items, cartId, headers = { "x-vibecart-merchant-key": key }) => new Request("https://offline.invalid/api/checkout", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ items, cartId }) })
    const items = [{ productId: "sku_a", quantity: 2 }, { productId: "sku_b", quantity: 1 }]
    const cart = await carts.createCart(items, "offline-a", undefined, { source: "offline-agent" })
    let session
    const event = (id = "evt_offline_paid", overrides = {}) => ({ id, object: "event", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode: false, data: { object: session }, ...overrides })
    const deliver = async (value, mutate = false) => {
      const payload = JSON.stringify(value)
      const signature = signer.webhooks.generateTestHeaderString({ payload, secret: signingSecret })
      return webhook.POST(new Request("https://offline.invalid/api/webhook/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: mutate ? payload + " " : payload }))
    }
    await t.test("unauthed internal checkout cannot bypass merchant auth", async () => {
      const result = await checkout.POST(request(items, cart.id, {}))
      assert.equal(result.status, 401)
      assert.equal(sessionRequests.length, 0)
    })
    await t.test("foreign cart and wrong/duplicate items cannot be attached to checkout", async () => {
      process.env.VIBECART_MERCHANT_ID = "merchant_b"
      const foreign = await carts.createCart(items, "offline-b")
      process.env.VIBECART_MERCHANT_ID = "merchant_a"
      assert.equal((await checkout.POST(request(items, foreign.id))).status, 404)
      assert.equal((await checkout.POST(request([{ productId: "sku_a", quantity: 1 }], cart.id))).status, 409)
      assert.equal((await checkout.POST(request([{ productId: "sku_a", quantity: 2 }, { productId: "sku_a", quantity: 2 }], cart.id))).status, 409)
      const foreignToken = auth.issueCartAccessToken(cart.id, "merchant_b")
      assert.equal((await checkout.POST(request(items, cart.id, { authorization: `Bearer ${foreignToken}` }))).status, 401)
      assert.equal(sessionRequests.length, 0)
    })
    await t.test("cart capability survives handoff and server-trusted prices/tenant reach Stripe", async () => {
      const token = auth.issueCartAccessToken(cart.id)
      const response = await handoff.POST(new Request(`https://offline.invalid/api/cart/${cart.id}/checkout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: cart.id }) })
      assert.equal(response.status, 200)
      const body = await response.json()
      session = sessions.get(body.checkoutSessionId).session
      assert.equal(session.metadata.vibecart_merchant_id, "merchant_a")
      assert.equal(session.client_reference_id, cart.id)
      assert.equal(sessionRequests[0].payment_intent_data.metadata.vibecart_merchant_id, "merchant_a")
      assert.equal(session.amount_total, 3700)
      assert.equal((await carts.getCart(cart.id)).status, "active")
    })
    await t.test("real Stripe signature rejects tampering before a durable order exists", async () => {
      const warnings = []
      const originalWarn = console.warn
      console.warn = (...args) => warnings.push(args)
      try {
        const sensitive = event()
        sensitive.data.object.customer_email = "private-offline@example.invalid"
        assert.equal((await deliver(sensitive, true)).status, 400)
      } finally { console.warn = originalWarn }
      assert.equal(warnings.length, 1)
      assert.equal(warnings[0].length, 1)
      assert.ok(!JSON.stringify(warnings).includes("private-offline@example.invalid"))
      assert.equal((await db.query("SELECT count(*)::int AS n FROM vibecart_orders")).rows[0].n, 0)
    })
    await t.test("line write failure rolls back header/event/cart; retry and replay persist once", async () => {
      failLineWrite = true
      assert.equal((await deliver(event())).status, 503)
      assert.equal((await db.query("SELECT count(*)::int AS n FROM vibecart_orders")).rows[0].n, 0)
      assert.equal((await carts.getCart(cart.id)).status, "active")
      failLineWrite = false
      assert.equal((await deliver(event())).status, 200)
      assert.equal((await deliver(event())).status, 200)
      assert.equal((await deliver(event("evt_offline_async", { type: "checkout.session.async_payment_succeeded" }))).status, 200)
      const rows = (await db.query("SELECT * FROM vibecart_orders")).rows
      assert.equal(rows.length, 1)
      assert.equal(rows[0].merchant_id, "merchant_a")
      assert.equal(rows[0].amount_total, 3700)
      assert.equal(rows[0].metadata.source, "offline-agent")
      assert.equal((await db.query("SELECT * FROM vibecart_order_lines")).rows.length, 2)
      assert.equal((await db.query("SELECT * FROM vibecart_order_events")).rows.length, 2)
      assert.equal((await carts.getCart(cart.id)).status, "converted")
      process.env.VIBECART_MERCHANT_ID = "merchant_b"
      assert.equal(await carts.getCart(cart.id), null)
      process.env.VIBECART_MERCHANT_ID = "merchant_a"
    })
    await t.test("hosted webhooks never attribute missing/foreign merchant metadata by fallback", async () => {
      for (const metadata of [{}, { vibecart_merchant_id: "merchant_b" }]) {
        const value = event("evt_wrong_tenant")
        value.data = { object: { ...session, metadata } }
        assert.equal((await deliver(value)).status, 503)
      }
      assert.equal((await db.query("SELECT count(*)::int AS n FROM vibecart_orders")).rows[0].n, 1)
    })
    await t.test("merchant checkout without a cart still stamps explicit tenant metadata", async () => {
      const response = await checkout.POST(request([{ productId: "sku_a", quantity: 1 }]))
      assert.equal(response.status, 200)
      assert.equal(sessionRequests.at(-1).metadata.vibecart_merchant_id, "merchant_a")
    })
    await t.test("MCP protocol sales discover -> attributed cart -> signed durable order", async t => {
      process.env.VIBECART_AI_SALESPERSON_ENABLED = "true"
      const sales = await load("lib/sales-cart.ts", {
        "@/lib/cart-store": carts, "@/lib/catalog-source": catalog,
        "@/lib/merchant-auth": auth, "@/lib/sales-assistant": assistant,
      })
      const mcp = await load("app/mcp/route.ts", {
        "next/server": next,
        "@/lib/catalog-source": { ...catalog, catalogSourceMode: () => "remote", listCatalogProducts: async () => [...products.values()] },
        "@/app/api/checkout/route": checkout, "@/app/api/cart/[id]/checkout/route": handoff,
        "@/lib/sales-assistant": assistant, "@/lib/sales-cart": sales,
        "@/lib/he-said-nothing-config": { hsnCheckoutReadiness: () => ({ enabled: false }), isHsnProductId: () => false },
      })
      const call = async (name, args) => {
        const response = await mcp.POST(new Request("https://offline.invalid/mcp", {
          method: "POST", headers: { "content-type": "application/json", "x-vibecart-merchant-key": key },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        }))
        assert.equal(response.status, 200)
        const payload = await response.json()
        assert.ok(!payload.error, JSON.stringify(payload.error))
        return payload.result.structuredContent
      }
      const none = await call("vibecart.find_products", { query: "zxqvnotacatalogitem" })
      assert.equal(none.status, "no_match")
      const discovery = await call("vibecart.find_products", { query: "Synthetic" })
      assert.equal(discovery.status, "matches")
      assert.equal(discovery.matches.length, 2)
      const created = await call("vibecart.create_sales_cart", {
        items: [{ productId: "sku_a", quantity: 1, priceCents: 1 }],
        idempotencyKey: "offline-agent-sales", salesSessionId: discovery.salesSessionId, query: "Synthetic", channel: "offline-mcp-client",
      })
      assert.equal(created.cart.subtotalCents, 1200)
      assert.equal(created.cart.merchantId, "merchant_a")
      const replayed = await call("vibecart.create_sales_cart", {
        items: [{ productId: "sku_a", quantity: 1 }], idempotencyKey: "offline-agent-sales", salesSessionId: discovery.salesSessionId,
      })
      assert.equal(replayed.cart.id, created.cart.id)
      const originalProduct = products.get("sku_a")
      products.set("sku_a", { ...originalProduct, availability: "out_of_stock" })
      let rejected = await call("vibecart.checkout_sales_cart", { cartId: created.cart.id, cartAccessToken: created.cartAccessToken })
      assert.equal(rejected.code, "PRODUCT_UNAVAILABLE")
      products.set("sku_a", { ...originalProduct, compatibility: { mode: "structured", required: ["model"], attributes: { model: ["FixtureBike"] } } })
      rejected = await call("vibecart.checkout_sales_cart", { cartId: created.cart.id, cartAccessToken: created.cartAccessToken })
      assert.equal(rejected.code, "SALES_COMPATIBILITY_CHANGED")
      products.set("sku_a", originalProduct)
      const checked = await call("vibecart.checkout_sales_cart", { cartId: created.cart.id, cartAccessToken: created.cartAccessToken })
      assert.equal(checked.success, true)
      session = sessions.get(checked.checkoutSessionId).session
      assert.equal(session.amount_total, 1200)
      assert.equal((await deliver(event("evt_offline_sales"))).status, 200)
      assert.equal((await deliver(event("evt_offline_sales"))).status, 200)
      const stored = (await db.query("SELECT * FROM vibecart_orders WHERE checkout_session_id = $1", [session.id])).rows
      assert.equal(stored.length, 1)
      assert.equal(stored[0].merchant_id, "merchant_a")
      assert.equal(stored[0].metadata["vibecart.sales.session"], discovery.salesSessionId)
      assert.equal(stored[0].metadata["vibecart.sales.source"], "ai-salesperson")
      assert.equal(stored[0].metadata["vibecart.sales.channel"], "offline-mcp-client")

      await t.test("pilot runner interoperates with actual MCP, cart, Stripe signing and PostgreSQL routes", async () => {
        const cartApi = await load("app/api/cart/[id]/route.ts", {
          "next/server": next, "@/lib/cart-store": carts, "@/lib/catalog-source": catalog, "@/lib/merchant-auth": auth,
        })
        const evidence = await runPilot({
          VIBECART_PILOT_BASE_URL: "https://staging-pilot.vercel.app",
          VIBECART_PILOT_APPROVED_PREVIEW_HOST: "staging-pilot.vercel.app",
          VIBECART_PILOT_ISOLATION_VERIFIED: "true", VIBECART_PILOT_ALLOW_WRITES: "true",
          VIBECART_PILOT_ALLOW_CHECKOUT: "true", VIBECART_MERCHANT_KEY: key,
          VIBECART_PILOT_PRODUCT_IDS: "sku_a,sku_b", VIBECART_PILOT_EXPECTED_PRICES: JSON.stringify({ sku_a: 1200, sku_b: 1300 }),
          VIBECART_PILOT_MERCHANT_ID: "merchant_a",
        }, async (url, init) => {
          if (url.pathname === "/api/health") return Response.json({
            ok: true, readinessScope: "configuration-only", stagingSafetyConfigured: true, stripeMode: "test", webhookConfigured: true,
            hostedMode: true, merchantAuthConfigured: true, durableOrderStoreConfigured: true, catalogMode: "remote", referenceCatalog: false,
            cloudConfigured: false, cloudOutboxRetryEnabled: false,
          })
          const req = new Request(url, init)
          if (url.pathname === "/mcp") return mcp.POST(req)
          const id = decodeURIComponent(url.pathname.split("/").at(-1))
          assert.ok(["GET", "PATCH", "DELETE"].includes(req.method))
          return cartApi[req.method](req, { params: Promise.resolve({ id }) })
        })
        assert.equal(evidence.summary.failed, 0)
        assert.equal(evidence.summary.skipped, 0)
        const handoff = evidence.checks.find(check => check.name === "controlled checkout handoff").detail
        session = sessions.get(handoff.checkoutSessionId).session
        assert.equal(session.amount_total, 2400)
        assert.equal((await deliver(event("evt_offline_pilot"))).status, 200)
        assert.equal((await deliver(event("evt_offline_pilot"))).status, 200)
        const order = (await db.query("SELECT * FROM vibecart_orders WHERE checkout_session_id = $1", [session.id])).rows
        assert.equal(order.length, 1)
        assert.equal(order[0].amount_total, 2400)
        assert.equal(order[0].metadata["vibecart.sales.channel"], "radiantz-pilot-mcp")
      })
      await t.test("catalog price changes require a refreshed quote before Stripe session creation", async () => {
        const quoted = await carts.createCart([{ productId: "sku_a", quantity: 1 }], "offline-price-quote")
        const before = sessionRequests.length
        const product = products.get("sku_a")
        try {
          for (const priceCents of [product.priceCents + 100, product.priceCents - 100]) {
            products.set("sku_a", { ...product, priceCents })
            const response = await checkout.POST(request([{ productId: "sku_a", quantity: 1 }], quoted.id))
            assert.equal(response.status, 409)
            assert.equal((await response.json()).code, "CART_PRICE_CHANGED")
            assert.equal(sessionRequests.length, before)
          }
          // Explicitly refreshing the cart produces a new server-priced quote.
          const refreshed = await carts.replaceCartItems(quoted.id, [{ productId: "sku_a", quantity: 1 }], quoted.version)
          assert.equal(refreshed.subtotalCents, product.priceCents - 100)
          assert.equal((await checkout.POST(request([{ productId: "sku_a", quantity: 1 }], quoted.id))).status, 200)
        } finally { products.set("sku_a", product) }
      })
      await t.test("unchanged checkout retries reuse the existing session and changed parameters return a safe conflict", async () => {
        const items = [{ productId: "sku_a", quantity: 1 }]
        const cart = await carts.createCart(items, "offline-checkout-retry")
        const first = await (await checkout.POST(request(items, cart.id))).json()
        const before = sessionRequests.length
        const second = await (await checkout.POST(request(items, cart.id))).json()
        assert.equal(first.checkoutSessionId, second.checkoutSessionId)
        assert.equal(sessionRequests.length, before)
        const changed = await checkout.POST(new Request("https://offline.invalid/api/checkout", {
          method: "POST", headers: { "content-type": "application/json", "x-vibecart-merchant-key": key },
          body: JSON.stringify({ items, cartId: cart.id, successUrl: "https://offline.invalid/different" }),
        }))
        assert.equal(changed.status, 409)
        assert.equal((await changed.json()).code, "CHECKOUT_RETRY_CONFLICT")
        assert.equal(sessionRequests.length, before)
      })
    })

  } finally {
    await db.close()
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]
    Object.assign(process.env, previous)
  }
})
