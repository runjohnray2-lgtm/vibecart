const endpoint = process.env.VIBECART_MCP_URL ?? "http://127.0.0.1:3000/mcp"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpcResponse(method, params = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
  })

  return { response, body: await response.json() }
}

async function rpc(method, params = {}) {
  const { response, body } = await rpcResponse(method, params)
  assert(response.ok, `${method} returned HTTP ${response.status}: ${JSON.stringify(body)}`)
  assert(!body.error, `${method} returned JSON-RPC error: ${JSON.stringify(body.error)}`)
  return body.result
}

const metadataResponse = await fetch(endpoint)
assert(metadataResponse.ok, `GET /mcp returned HTTP ${metadataResponse.status}`)
const metadata = await metadataResponse.json()
assert(metadata.name === "vibecart", "GET /mcp did not identify the VibeCart server")

const healthResponse = await fetch(new URL("/api/health", endpoint))
assert(healthResponse.ok, `GET /api/health returned HTTP ${healthResponse.status}`)
const health = await healthResponse.json()
assert(health.service === "vibecart" && health.ok === true, "health endpoint did not report VibeCart as healthy")
assert(health.stripeConfigured === false, "CI health check should not report Stripe configured")
assert(health.webhookConfigured === false, "CI health check should not report a webhook configured")

const ping = await rpc("ping")
assert(ping && Object.keys(ping).length === 0, "MCP ping did not return an empty result")

const discovery = await rpc("server/discover", {
  protocolVersions: ["2026-07-28"],
  clientInfo: { name: "vibecart-ci", version: "1.0.0" },
  capabilities: {},
})
assert(discovery.serverInfo?.name === "vibecart", "server/discover returned the wrong server")

const listed = await rpc("tools/list")
const toolNames = listed.tools?.map(tool => tool.name) ?? []
for (const expected of [
  "vibecart.list_products",
  "vibecart.get_product",
  "vibecart.get_integration_instructions",
  "vibecart.create_checkout",
]) {
  assert(toolNames.includes(expected), `Missing MCP tool: ${expected}`)
}
assert(toolNames.length === 4, `Expected exactly four commerce tools, found ${toolNames.length}`)
for (const tool of listed.tools) {
  assert(tool.title && tool.description, `${tool.name} is missing review metadata`)
  assert(tool.inputSchema && tool.outputSchema, `${tool.name} is missing an explicit schema`)
  assert(tool.annotations, `${tool.name} is missing annotations`)
}
for (const name of ["vibecart.get_product", "vibecart.create_checkout"]) {
  const tool = listed.tools.find(candidate => candidate.name === name)
  assert(tool.outputSchema.type === "object", `${name} outputSchema must have top-level object type`)
  assert(!tool.outputSchema.oneOf && !tool.outputSchema.anyOf, `${name} outputSchema must not use a top-level union`)
}

const productsCall = await rpc("tools/call", {
  name: "vibecart.list_products",
  arguments: {},
})
assert(productsCall.resultType === "complete", "list_products did not complete")
assert(Array.isArray(productsCall.structuredContent?.products), "list_products returned no product list")
assert(productsCall.structuredContent.products.length >= 2, "trusted product catalog needs at least two products for multi-item smoke coverage")

const productId = productsCall.structuredContent.products[0].id
const secondProductId = productsCall.structuredContent.products[1].id
const productCall = await rpc("tools/call", {
  name: "vibecart.get_product",
  arguments: { productId },
})
assert(productCall.structuredContent?.product?.id === productId, "get_product returned the wrong product")

const durableLimiterConfigured = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)
if (!durableLimiterConfigured) {
  const { response, body } = await rpcResponse("tools/call", {
    name: "vibecart.create_checkout",
    arguments: { productId, quantity: 1 },
  })
  assert(response.status === 503, `checkout without durable limiter returned HTTP ${response.status}`)
  assert(body.error?.data?.code === "RATE_LIMIT_BACKEND_UNAVAILABLE", "checkout without durable limiter did not fail closed with the stable backend-unavailable code")
  console.log(`MCP smoke test passed for ${toolNames.length} tools; checkout correctly fails closed without durable limiter storage`)
  process.exit(0)
}

const legacyCheckoutCall = await rpc("tools/call", {
  name: "vibecart.create_checkout",
  arguments: { productId, quantity: 1 },
})
assert(legacyCheckoutCall.resultType === "complete", "legacy create_checkout did not complete")
assert(legacyCheckoutCall.structuredContent?.success === true, "legacy create_checkout was not successful")
assert(legacyCheckoutCall.structuredContent?.mode === "demo", "CI legacy checkout should run in demo mode without a Stripe secret")
assert(legacyCheckoutCall.structuredContent?.productId === productId, "legacy create_checkout did not preserve productId output")
assert(legacyCheckoutCall.structuredContent?.quantity === 1, "legacy create_checkout did not preserve quantity output")

const multiCheckoutCall = await rpc("tools/call", {
  name: "vibecart.create_checkout",
  arguments: {
    items: [
      { productId, quantity: 2 },
      { productId: secondProductId, quantity: 1 },
    ],
  },
})
assert(multiCheckoutCall.resultType === "complete", "multi-item create_checkout did not complete")
assert(multiCheckoutCall.structuredContent?.success === true, "multi-item create_checkout was not successful")
assert(multiCheckoutCall.structuredContent?.mode === "demo", "CI multi-item checkout should run in demo mode without a Stripe secret")
assert(Array.isArray(multiCheckoutCall.structuredContent?.items), "multi-item create_checkout did not return normalized items")
assert(multiCheckoutCall.structuredContent.items.length === 2, "multi-item create_checkout returned the wrong number of normalized lines")
assert(multiCheckoutCall.structuredContent.items[0].productId === productId && multiCheckoutCall.structuredContent.items[0].quantity === 2, "multi-item create_checkout returned the wrong first line")
assert(multiCheckoutCall.structuredContent.items[1].productId === secondProductId && multiCheckoutCall.structuredContent.items[1].quantity === 1, "multi-item create_checkout returned the wrong second line")
assert(multiCheckoutCall.structuredContent.productId === undefined, "multi-item create_checkout should not emit legacy productId output")

console.log(`MCP smoke test passed for ${toolNames.length} tools, legacy checkout, and trusted multi-item checkout`)
