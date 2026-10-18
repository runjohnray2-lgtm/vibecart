import assert from "node:assert/strict"
import test from "node:test"
import { runPilot } from "../scripts/radiantz-pilot-evidence.mjs"

const env = {
  VIBECART_PILOT_BASE_URL: "https://staging-pilot.vercel.app",
  VIBECART_PILOT_APPROVED_PREVIEW_HOST: "staging-pilot.vercel.app",
  VIBECART_PILOT_ALLOW_WRITES: "true", VIBECART_PILOT_ISOLATION_VERIFIED: "true",
  VIBECART_PILOT_PRODUCT_IDS: "stock-denied,made-to-order", VIBECART_MERCHANT_KEY: "offline-only-key",
  VIBECART_PILOT_EXPECTED_PRICES: JSON.stringify({ "stock-denied": 1000, "made-to-order": 1200 }),
  VIBECART_PILOT_MERCHANT_ID: "merchant_a",
}
const health = {
  ok: true, service: "vibecart", readinessScope: "configuration-only", stagingSafetyConfigured: true,
  stripeMode: "test", webhookConfigured: true, hostedMode: true, merchantAuthConfigured: true,
  durableOrderStoreConfigured: true, catalogMode: "remote", referenceCatalog: false,
  cloudConfigured: false, cloudOutboxRetryEnabled: false,
}
function fakeServer(override = {}, checkoutMode = "test") {
  const calls = []
  let quantity = 1
  const salesSessionId = "sales_offline"
  const cart = () => ({ id: "offline-cart", merchantId: "merchant_a", version: quantity, status: "active", currency: "usd",
    items: [{ productId: "made-to-order", quantity, unitPriceCents: 1200 }], subtotalCents: quantity * 1200,
    metadata: { "vibecart.sales.session": salesSessionId } })
  const fetch = async (url, init = {}) => {
    calls.push({ path: url.pathname, method: init.method ?? "GET", headers: init.headers, redirect: init.redirect, body: init.body ? JSON.parse(init.body) : null })
    if (url.pathname === "/api/health") return Response.json({ ...health, ...override })
    if (url.pathname === "/mcp") {
      const rpc = JSON.parse(init.body)
      if (rpc.method === "tools/list") return Response.json({ result: { tools: ["vibecart.list_products", "vibecart.get_product", "vibecart.find_products", "vibecart.create_sales_cart", "vibecart.checkout_sales_cart"].map(name => ({ name })) } })
      if (rpc.params.name === "vibecart.find_products") return Response.json({ result: { structuredContent: {
        success: true, status: "matches", salesSessionId,
        matches: [{ product: { id: "made-to-order", priceCents: 1200 }, availability: "made_to_order", compatibility: { status: "unknown" } }],
      } } })
      if (rpc.params.name === "vibecart.create_sales_cart") return Response.json({ result: { structuredContent: { success: true, cart: cart(), cartAccessToken: "offline-capability" } } })
      if (rpc.params.name === "vibecart.checkout_sales_cart") return Response.json({ result: { structuredContent: { success: true, mode: checkoutMode, checkoutSessionId: "cs_test_offline", checkoutUrl: "https://checkout.stripe.com/offline" } } })
      if (rpc.params.name === "vibecart.list_products") return Response.json({ result: { structuredContent: { products: [
        { id: "stock-denied", name: "Synthetic blocked", priceCents: 1000, availability: "out_of_stock" },
        { id: "made-to-order", name: "Synthetic made-to-order", priceCents: 1200, availability: "made_to_order" },
      ] } } })
      return Response.json({ result: { structuredContent: { product: { id: rpc.params.arguments.productId } } } })
    }
    if (init.method === "PATCH") quantity = 2
    return Response.json({ cart: cart() })
  }
  return { fetch, calls }
}

test("production override cannot make the pilot harness write to production", async () => {
  const server = fakeServer()
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_BASE_URL: "https://vibecart.vercel.app", VIBECART_PILOT_APPROVED_PREVIEW_HOST: "vibecart.vercel.app", VIBECART_PILOT_ALLOW_PRODUCTION: "true" }, server.fetch), /production is forbidden/)
  assert.equal(server.calls.length, 0)
})

test("pilot requires explicit independent-isolation and write authorization before network access", async () => {
  const server = fakeServer()
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_ALLOW_WRITES: "false" }, server.fetch), /independently verified/)
  assert.equal(server.calls.length, 0)
})

for (const override of [{ stagingSafetyConfigured: false }, { stripeMode: "live" }, { referenceCatalog: true }, { cloudConfigured: true }, { merchantAuthConfigured: false }]) {
  test(`unsafe staging health stops before cart/MCP writes: ${Object.keys(override)[0]}`, async () => {
    const server = fakeServer(override)
    await assert.rejects(runPilot(env, server.fetch))
    assert.deepEqual(server.calls.map(call => call.path), ["/api/health"])
  })
}

test("pilot selects the verified eligible subset and reports cents without leaking merchant key", async () => {
  const server = fakeServer()
  const result = await runPilot(env, server.fetch)
  const created = server.calls.find(call => call.body?.params?.name === "vibecart.create_sales_cart")
  assert.equal(created.body.params.arguments.items[0].productId, "made-to-order")
  assert.equal(result.checks.find(check => check.name === "real catalog list").detail.sample[1].priceCents, 1200)
  assert.equal(result.summary.failed, 0)
  assert.ok(!JSON.stringify(result).includes(env.VIBECART_MERCHANT_KEY))
})

test("pilot authenticates protected Preview with origin-pinned OIDC and never records capabilities", async () => {
  const server = fakeServer()
  const evidence = await runPilot({ ...env, VERCEL_OIDC_TOKEN: "offline-short-lived", VIBECART_PILOT_ALLOW_CHECKOUT: "true" }, server.fetch)
  for (const call of server.calls) {
    assert.equal(call.headers.get("x-vercel-trusted-oidc-idp-token"), "offline-short-lived")
    assert.equal(call.redirect, "error")
  }
  assert.doesNotMatch(JSON.stringify(evidence), /offline-short-lived|offline-capability|offline-only-key/)
  assert.equal(evidence.checks.find(check => check.name === "controlled checkout handoff").detail.checkoutSessionId, "cs_test_offline")
})

test("pilot rejects changed verified prices before creating a cart", async () => {
  const server = fakeServer()
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_EXPECTED_PRICES: JSON.stringify({ "stock-denied": 1000, "made-to-order": 1201 }) }, server.fetch), /price differs/)
  assert.ok(!server.calls.some(call => call.body?.params?.name === "vibecart.create_sales_cart"))
})

test("pilot rejects MCP tool errors even with HTTP 200", async () => {
  const server = fakeServer()
  const fetch = (url, init) => {
    if (init.body && JSON.parse(init.body).params?.name === "vibecart.find_products") return Response.json({ result: { isError: true, structuredContent: { code: "SALESPERSON_DISABLED" } } })
    return server.fetch(url, init)
  }
  await assert.rejects(runPilot(env, fetch), /failed tool result/)
  assert.ok(!server.calls.some(call => call.body?.params?.name === "vibecart.create_sales_cart"))
})

test("pilot rejects an unexpected merchant before checkout", async () => {
  const server = fakeServer()
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_MERCHANT_ID: "merchant_b", VIBECART_PILOT_ALLOW_CHECKOUT: "true" }, server.fetch), /unexpected merchant/)
  assert.ok(!server.calls.some(call => call.body?.params?.name === "vibecart.checkout_sales_cart"))
})

test("main production alias is forbidden even when explicitly approved by mistake", async () => {
  const server = fakeServer()
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_BASE_URL: "https://vibecart-git-main-promptmeter.vercel.app", VIBECART_PILOT_APPROVED_PREVIEW_HOST: "vibecart-git-main-promptmeter.vercel.app" }, server.fetch), /production is forbidden/)
  assert.equal(server.calls.length, 0)
})

test("checkout handoff must actually return test mode and the correct URL field", async () => {
  const server = fakeServer({}, "live")
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_ALLOW_CHECKOUT: "true" }, server.fetch), /TEST-mode session/)
})
