const endpoint = process.env.VIBECART_MCP_URL ?? "http://127.0.0.1:3000/mcp"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpc(method, params = {}) {
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

  const body = await response.json()
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

const productsCall = await rpc("tools/call", {
  name: "vibecart.list_products",
  arguments: {},
})
assert(productsCall.resultType === "complete", "list_products did not complete")
assert(Array.isArray(productsCall.structuredContent?.products), "list_products returned no product list")
assert(productsCall.structuredContent.products.length > 0, "trusted product catalog is empty")

const productId = productsCall.structuredContent.products[0].id
const productCall = await rpc("tools/call", {
  name: "vibecart.get_product",
  arguments: { productId },
})
assert(productCall.structuredContent?.product?.id === productId, "get_product returned the wrong product")

const checkoutCall = await rpc("tools/call", {
  name: "vibecart.create_checkout",
  arguments: { productId, quantity: 1 },
})
assert(checkoutCall.resultType === "complete", "create_checkout did not complete")
assert(checkoutCall.structuredContent?.success === true, "create_checkout was not successful")
assert(checkoutCall.structuredContent?.mode === "demo", "CI checkout should run in demo mode without a Stripe secret")

console.log(`MCP smoke test passed for ${toolNames.length} tools and product ${productId}`)
