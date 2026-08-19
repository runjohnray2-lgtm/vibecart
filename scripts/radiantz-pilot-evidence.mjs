const baseUrl = new URL(process.env.VIBECART_PILOT_BASE_URL ?? "https://vibecart.vercel.app")
const allowProduction = process.env.VIBECART_PILOT_ALLOW_PRODUCTION === "true"
const allowCheckout = process.env.VIBECART_PILOT_ALLOW_CHECKOUT === "true"
const merchantKey = process.env.VIBECART_MERCHANT_KEY?.trim()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isProductionHost(url) {
  return url.hostname === "vibecart.vercel.app" || url.hostname === "vibecart-promptmeter.vercel.app"
}

if (isProductionHost(baseUrl) && !allowProduction) {
  throw new Error("Refusing to run the pilot evidence harness against production without VIBECART_PILOT_ALLOW_PRODUCTION=true")
}

const evidence = {
  startedAt: new Date().toISOString(),
  baseUrl: `${baseUrl.protocol}//${baseUrl.host}`,
  production: isProductionHost(baseUrl),
  checks: [],
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers ?? {})
  if (merchantKey) headers.set("x-vibecart-merchant-key", merchantKey)
  const response = await fetch(new URL(path, baseUrl), { ...init, headers, redirect: "error" })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

async function record(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    evidence.checks.push({ name, ok: true, durationMs: Date.now() - started, detail })
    return detail
  } catch (error) {
    evidence.checks.push({ name, ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

async function rpc(method, params = {}) {
  const { response, body } = await request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `${method}-${Date.now()}`, method, params }),
  })
  assert(response.ok, `${method} returned HTTP ${response.status}`)
  assert(!body?.error, `${method} returned JSON-RPC error: ${JSON.stringify(body?.error)}`)
  return body.result
}

await record("health", async () => {
  const { response, body } = await request("/api/health")
  assert(response.ok && body?.ok === true, `health failed with HTTP ${response.status}`)
  return { status: response.status, service: body.service, ok: body.ok }
})

await record("mcp tools/list", async () => {
  const result = await rpc("tools/list")
  const names = result.tools?.map(tool => tool.name) ?? []
  for (const expected of ["vibecart.list_products", "vibecart.get_product", "vibecart.create_checkout"]) {
    assert(names.includes(expected), `missing MCP tool ${expected}`)
  }
  return { tools: names }
})

const catalog = await record("real catalog list", async () => {
  const result = await rpc("tools/call", { name: "vibecart.list_products", arguments: {} })
  const products = result.structuredContent?.products ?? []
  assert(Array.isArray(products) && products.length > 0, "catalog returned no products")
  return {
    count: products.length,
    sample: products.slice(0, 5).map(product => ({ id: product.id, name: product.name, price: product.price })),
    productIds: products.map(product => product.id),
  }
})

await record("catalog lookup", async () => {
  const productId = catalog.productIds[0]
  const result = await rpc("tools/call", { name: "vibecart.get_product", arguments: { productId } })
  assert(result.structuredContent?.product?.id === productId, "catalog lookup returned the wrong product")
  return { productId }
})

let cartId
let cartVersion
await record("cart create", async () => {
  const productId = catalog.productIds[0]
  const { response, body } = await request("/api/cart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
  })
  assert(response.ok, `cart create returned HTTP ${response.status}: ${JSON.stringify(body)}`)
  cartId = body.cart?.id ?? body.id
  cartVersion = body.cart?.version ?? body.version
  assert(cartId, "cart create returned no cart id")
  return { cartId, productId }
})

await record("cart read", async () => {
  const { response, body } = await request(`/api/cart/${encodeURIComponent(cartId)}`)
  assert(response.ok, `cart read returned HTTP ${response.status}`)
  const cart = body.cart ?? body
  cartVersion = cart.version ?? cartVersion
  return { cartId, version: cartVersion, status: cart.status }
})

await record("cart update", async () => {
  const productId = catalog.productIds[0]
  const { response, body } = await request(`/api/cart/${encodeURIComponent(cartId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: cartVersion, items: [{ productId, quantity: 2 }] }),
  })
  assert(response.ok, `cart update returned HTTP ${response.status}: ${JSON.stringify(body)}`)
  const cart = body.cart ?? body
  cartVersion = cart.version ?? cartVersion
  return { cartId, version: cartVersion, quantity: 2 }
})

if (allowCheckout) {
  await record("controlled checkout handoff", async () => {
    const { response, body } = await request(`/api/cart/${encodeURIComponent(cartId)}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: cartVersion }),
    })
    assert(response.ok, `checkout returned HTTP ${response.status}: ${JSON.stringify(body)}`)
    return { cartId, mode: body.mode ?? null, hasUrl: typeof body.url === "string" }
  })
} else {
  evidence.checks.push({ name: "controlled checkout handoff", ok: true, skipped: true, reason: "VIBECART_PILOT_ALLOW_CHECKOUT is not true" })
}

if (!allowCheckout) {
  await record("cart cancel", async () => {
    const { response, body } = await request(`/api/cart/${encodeURIComponent(cartId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: cartVersion }),
    })
    assert(response.ok, `cart cancel returned HTTP ${response.status}: ${JSON.stringify(body)}`)
    return { cartId, cancelled: true }
  })
}

evidence.finishedAt = new Date().toISOString()
evidence.summary = {
  passed: evidence.checks.filter(check => check.ok && !check.skipped).length,
  failed: evidence.checks.filter(check => !check.ok).length,
  skipped: evidence.checks.filter(check => check.skipped).length,
}

console.log(JSON.stringify(evidence, null, 2))
