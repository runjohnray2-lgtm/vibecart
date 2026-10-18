import assert from "node:assert/strict"
import test from "node:test"
import { runPilot } from "../scripts/radiantz-pilot-evidence.mjs"

const env = {
  VIBECART_PILOT_BASE_URL: "https://staging-pilot.vercel.app",
  VIBECART_PILOT_APPROVED_PREVIEW_HOST: "staging-pilot.vercel.app",
  VIBECART_PILOT_ALLOW_WRITES: "true", VIBECART_PILOT_ISOLATION_VERIFIED: "true",
  VIBECART_PILOT_PRODUCT_IDS: "stock-denied,made-to-order", VIBECART_MERCHANT_KEY: "offline-only-key",
}
const health = {
  ok: true, service: "vibecart", readinessScope: "configuration-only", stagingSafetyConfigured: true,
  stripeMode: "test", webhookConfigured: true, hostedMode: true, merchantAuthConfigured: true,
  durableOrderStoreConfigured: true, catalogMode: "remote", referenceCatalog: false,
  cloudConfigured: false, cloudOutboxRetryEnabled: false,
}
function fakeServer(override = {}, checkoutMode = "test") {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ path: url.pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null })
    if (url.pathname === "/api/health") return Response.json({ ...health, ...override })
    if (url.pathname === "/mcp") {
      const rpc = JSON.parse(init.body)
      if (rpc.method === "tools/list") return Response.json({ result: { tools: ["vibecart.list_products", "vibecart.get_product", "vibecart.create_checkout"].map(name => ({ name })) } })
      if (rpc.params.name === "vibecart.list_products") return Response.json({ result: { structuredContent: { products: [
        { id: "stock-denied", name: "Synthetic blocked", priceCents: 1000, availability: "out_of_stock" },
        { id: "made-to-order", name: "Synthetic made-to-order", priceCents: 1200, availability: "made_to_order" },
      ] } } })
      return Response.json({ result: { structuredContent: { product: { id: rpc.params.arguments.productId } } } })
    }
    if (url.pathname.endsWith("/checkout")) return Response.json({ success: true, mode: checkoutMode, checkoutUrl: "https://checkout.stripe.com/offline" })
    return Response.json({ cart: { id: "offline-cart", version: 2, status: "active" } })
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
  const created = server.calls.find(call => call.path === "/api/cart")
  assert.equal(created.body.items[0].productId, "made-to-order")
  assert.equal(result.checks.find(check => check.name === "real catalog list").detail.sample[1].priceCents, 1200)
  assert.equal(result.summary.failed, 0)
  assert.ok(!JSON.stringify(result).includes(env.VIBECART_MERCHANT_KEY))
})

test("checkout handoff must actually return test mode and the correct URL field", async () => {
  const server = fakeServer({}, "live")
  await assert.rejects(runPilot({ ...env, VIBECART_PILOT_ALLOW_CHECKOUT: "true" }, server.fetch), /TEST-mode session/)
})
