import { pathToFileURL } from "node:url"

export async function runPilot(env = process.env, fetchImpl = fetch) {
  const baseUrl = new URL(env.VIBECART_PILOT_BASE_URL ?? "https://vibecart.vercel.app")
  const allowCheckout = env.VIBECART_PILOT_ALLOW_CHECKOUT === "true"
  const merchantKey = env.VIBECART_MERCHANT_KEY?.trim()

  function assert(condition, message) {
    if (!condition) throw new Error(message)
  }

  function isProductionHost(url) {
    return url.hostname === "vibecart.vercel.app" || url.hostname === "vibecart-promptmeter.vercel.app"
  }

  if (isProductionHost(baseUrl) || baseUrl.protocol !== "https:"
      || baseUrl.username || baseUrl.password || baseUrl.port
      || !baseUrl.hostname.endsWith(".vercel.app")
      || baseUrl.hostname !== env.VIBECART_PILOT_APPROVED_PREVIEW_HOST) {
    throw new Error("Pilot requires an explicitly approved HTTPS Vercel Preview host; production is forbidden")
  }
  if (env.VIBECART_PILOT_ALLOW_WRITES !== "true" || env.VIBECART_PILOT_ISOLATION_VERIFIED !== "true") {
    throw new Error("Pilot writes require independently verified isolation/cost and explicit VIBECART_PILOT_ALLOW_WRITES=true")
  }
  const expectedProductIds = (env.VIBECART_PILOT_PRODUCT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean)
  assert(expectedProductIds.length > 0 && expectedProductIds.length <= 20, "Set 1-20 independently verified pilot product IDs")
  assert(Boolean(merchantKey), "Pilot requires a merchant key supplied securely through the environment")

  const evidence = {
    startedAt: new Date().toISOString(),
    baseUrl: `${baseUrl.protocol}//${baseUrl.host}`,
    production: isProductionHost(baseUrl),
    checks: [],
  }

  async function request(path, init = {}) {
    const headers = new Headers(init.headers ?? {})
    if (merchantKey) headers.set("x-vibecart-merchant-key", merchantKey)
    const response = await fetchImpl(new URL(path, baseUrl), { ...init, headers, redirect: "error" })
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
    assert(!body?.error, `${method} returned JSON-RPC error`)
    return body.result
  }

  await record("health", async () => {
    const { response, body } = await request("/api/health")
    assert(response.ok && body?.ok === true, `health failed with HTTP ${response.status}`)
    assert(body.readinessScope === "configuration-only", "Unrecognized health contract")
    assert(body.stagingSafetyConfigured === true, "Staging safety is not configured; refusing all pilot writes")
    assert(body.stripeMode === "test" && body.webhookConfigured === true, "Stripe TEST configuration is required")
    assert(body.hostedMode === true && body.merchantAuthConfigured === true, "Hosted merchant auth is required")
    assert(body.durableOrderStoreConfigured === true, "Isolated durable order storage is required")
    assert(body.catalogMode === "remote" && body.referenceCatalog === false, "A verified real catalog is required")
    assert(body.cloudConfigured === false && body.cloudOutboxRetryEnabled === false, "Outbound Cloud delivery must be disabled")
    return { status: response.status, service: body.service, configurationOnly: true, stagingSafetyConfigured: true }
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
    const pilotProducts = products.filter(product => expectedProductIds.includes(product.id))
    assert(pilotProducts.length === expectedProductIds.length, "Pilot IDs do not exactly match the verified catalog subset")
    const eligible = pilotProducts.filter(product => ["in_stock", "made_to_order", "preorder"].includes(product.availability))
    assert(eligible.length > 0, "No independently verified checkout-eligible product in pilot subset")
    return {
      count: products.length,
      sample: pilotProducts.slice(0, 5).map(product => ({ id: product.id, name: product.name, priceCents: product.priceCents, availability: product.availability })),
      productIds: eligible.map(product => product.id),
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
    assert(response.ok, `cart create returned HTTP ${response.status}`)
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
    assert(response.ok, `cart update returned HTTP ${response.status}`)
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
      assert(response.ok, `checkout returned HTTP ${response.status}`)
      assert(body.mode === "test" && typeof body.checkoutUrl === "string", "Checkout must return a TEST-mode session URL")
      return { cartId, mode: body.mode, hasUrl: true }
    })
  } else {
    evidence.checks.push({ name: "controlled checkout handoff", ok: true, skipped: true, reason: "VIBECART_PILOT_ALLOW_CHECKOUT is not true" })
  }

  if (!allowCheckout) {
    await record("cart cancel", async () => {
      const { response } = await request(`/api/cart/${encodeURIComponent(cartId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: cartVersion }),
      })
      assert(response.ok, `cart cancel returned HTTP ${response.status}`)
      return { cartId, cancelled: true }
    })
  }

  evidence.finishedAt = new Date().toISOString()
  evidence.summary = {
    passed: evidence.checks.filter(check => check.ok && !check.skipped).length,
    failed: evidence.checks.filter(check => !check.ok).length,
    skipped: evidence.checks.filter(check => check.skipped).length,
  }

  return evidence

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPilot().then(evidence => console.log(JSON.stringify(evidence, null, 2))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
