/**
 * Explicit, read-only public VibeCart MCP/UCP acceptance probe.
 * No credentials, checkout/cart/order calls, merchant writes, or Stripe requests.
 * A successful probe proves endpoint compatibility, NOT Shopify provenance.
 */
const READ_ONLY_TOOLS = new Set(['vibecart.list_products', 'vibecart.get_product'])
const READ_ONLY_UCP_TOOLS = new Set(['search_catalog', 'lookup_catalog', 'get_product'])

function previewOidcHeaders(origin, token, approvedHost) {
  if (token === undefined) return {}
  const url = new URL(origin)
  // A Preview OIDC token is a credential. Never send it to a caller-supplied
  // origin without an independent, exact non-production host allowlist.
  const productionHosts = new Set([
    'vibecart.vercel.app', 'vibecart-promptmeter.vercel.app',
    'vibecart-git-main-promptmeter.vercel.app',
  ])
  if (typeof token !== 'string' || !token.trim() ||
      typeof approvedHost !== 'string' ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(approvedHost) ||
      url.hostname !== approvedHost || url.port || productionHosts.has(url.hostname)) {
    throw new Error('Preview OIDC requires a token and an explicitly approved non-production Vercel Preview host')
  }
  return { 'x-vercel-trusted-oidc-idp-token': token }
}

function originOf(baseUrl) {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('base URL must be a bare HTTPS origin with no credentials or path')
  }
  return url.origin
}

async function jsonRequest(fetchImpl, url, { method = 'GET', body, extraHeaders = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetchImpl(url, {
      method, redirect: 'manual', signal: controller.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (response.status < 200 || response.status >= 300) throw new Error(`read-only probe HTTP ${response.status}`)
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      throw new Error('probe expected JSON response')
    }
    const text = await response.text()
    if (text.length > 1024 * 1024) throw new Error('probe response exceeds 1 MiB')
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

function rpcResult(value, id) {
  if (!value || value.jsonrpc !== '2.0' || value.id !== id || !value.result || value.error) {
    throw new Error(`invalid MCP JSON-RPC response for request ${id}`)
  }
  return value.result
}

export async function probePublicMcp({ baseUrl, expectedProductId, expectedPriceCents, agentProfileUrl, previewOidcToken, approvedPreviewHost, fetchImpl = fetch }) {
  const origin = originOf(baseUrl)
  const extraHeaders = previewOidcHeaders(origin, previewOidcToken, approvedPreviewHost)
  const request = (url, options) => jsonRequest(fetchImpl, url, { ...options, extraHeaders })
  if (expectedProductId !== undefined &&
      (typeof expectedProductId !== 'string' || !/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(expectedProductId))) {
    throw new Error('expectedProductId must be a verified Shopify ProductVariant GID')
  }
  if (expectedPriceCents !== undefined && expectedProductId === undefined) {
    throw new Error('expectedPriceCents requires an independently verified Shopify variant ID')
  }
  if (expectedPriceCents !== undefined && (!Number.isSafeInteger(expectedPriceCents) || expectedPriceCents < 0)) {
    throw new Error('expectedPriceCents must be a non-negative safe integer in USD cents')
  }
  if (agentProfileUrl !== undefined) {
    if (expectedProductId === undefined || expectedPriceCents === undefined) {
      throw new Error('UCP catalog acceptance requires independently verified Shopify variant ID and price')
    }
    let profile
    try { profile = new URL(agentProfileUrl) } catch { throw new Error('agentProfileUrl must be a public HTTPS profile URL') }
    // The profile is fetched by the UCP server during negotiation. Reject all
    // literal IPs (including bracketed IPv6 and URL-normalized IPv4 shorthands),
    // not just selected private IPv4 ranges; never send it an internal target.
    // DNS resolution/rebinding safety remains the responsibility of the server.
    const host = profile.hostname.toLowerCase()
    const internalName = ['localhost', 'local', 'internal', 'home.arpa']
      .some(suffix => host === suffix || host.endsWith('.' + suffix))
    if (profile.protocol !== 'https:' || profile.username || profile.password || profile.search || profile.hash ||
        host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || internalName) {
      throw new Error('agentProfileUrl must be a public HTTPS profile URL without credentials or query')
    }
  }
  const discovery = await request(`${origin}/.well-known/ucp`)
  const ucp = discovery?.ucp
  if (!ucp || typeof ucp.version !== 'string' ||
      !ucp.capabilities?.['dev.ucp.shopping.catalog.search'] ||
      !ucp.capabilities?.['dev.ucp.shopping.catalog.lookup']) {
    throw new Error('UCP discovery lacks required catalog capabilities')
  }
  const ucpEndpoint = ucp.services?.['dev.ucp.shopping']?.find(service => service?.transport === 'mcp')?.endpoint
  if (ucpEndpoint !== `${origin}/ucp/mcp`) {
    throw new Error('UCP discovery must advertise same-origin /ucp/mcp transport')
  }
  const rpc = async (id, method, params = {}) => rpcResult(await request(`${origin}/mcp`, {
    method: 'POST', body: { jsonrpc: '2.0', id, method, params },
  }), id)
  const initialized = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vibecart-read-only-probe', version: '1.0.0' } })
  if (!initialized.capabilities?.tools || initialized.serverInfo?.name !== 'vibecart') {
    throw new Error('MCP initialize did not advertise VibeCart tools')
  }
  const listed = await rpc(2, 'tools/list')
  if (!Array.isArray(listed.tools)) throw new Error('MCP tools/list is invalid')
  for (const name of READ_ONLY_TOOLS) {
    const tool = listed.tools.find(item => item.name === name)
    if (!tool || tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false) {
      throw new Error(`MCP tool ${name} is missing or not explicitly read-only`)
    }
  }
  const ucpRpc = async (id, method, params = {}) => rpcResult(await request(ucpEndpoint, {
    method: 'POST', body: { jsonrpc: '2.0', id, method, params },
  }), id)
  const ucpInitialized = await ucpRpc(10, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vibecart-read-only-probe', version: '1.0.0' } })
  if (!ucpInitialized.capabilities?.tools || ucpInitialized.serverInfo?.name !== 'vibecart-ucp') {
    throw new Error('UCP MCP initialize did not advertise VibeCart UCP tools')
  }
  const ucpListed = await ucpRpc(11, 'tools/list')
  if (!Array.isArray(ucpListed.tools) || [...READ_ONLY_UCP_TOOLS].some(name => !ucpListed.tools.some(tool => tool.name === name))) {
    throw new Error('UCP MCP transport lacks required catalog tools')
  }
  // UCP catalog tools require a negotiated public agent profile. Without one, only
  // UCP discovery/initialize/tools-list can be verified; do not report catalog success.
  let ucpCatalogVerified = false
  if (agentProfileUrl !== undefined) {
    const meta = { 'ucp-agent': { profile: agentProfileUrl } }
    const matchesExpected = p => p?.id === expectedProductId &&
      p.price_range?.min?.amount === expectedPriceCents &&
      p.price_range?.max?.amount === expectedPriceCents &&
      p.price_range?.min?.currency === 'USD' && p.price_range?.max?.currency === 'USD' &&
      Array.isArray(p.variants) && p.variants.some(v =>
        v?.id === expectedProductId && v.price?.amount === expectedPriceCents && v.price?.currency === 'USD')
    // An unrelated first page is not proof that the expected Radiantz variant is
    // discoverable. Walk every search page, fail closed on truncation or cursor loops.
    const seenSearchIds = new Set()
    const seenSearchCursors = new Set()
    let searchCursor
    let searchMatched = false
    let searchCompleted = false
    for (let page = 0; page < 100; page += 1) {
      const search = await ucpRpc(100 + page, 'tools/call', {
        name: 'search_catalog', arguments: { meta, catalog: {
          query: '', pagination: { limit: 50, ...(searchCursor ? { cursor: searchCursor } : {}) },
        } },
      })
      const searchProducts = search.structuredContent?.products
      const pagination = search.structuredContent?.pagination
      if (search.isError || search.structuredContent?.ucp?.status === 'error' ||
          !Array.isArray(searchProducts) || searchProducts.length === 0 || searchProducts.length > 50 ||
          !pagination || typeof pagination.has_next_page !== 'boolean') {
        throw new Error('UCP search_catalog did not return a complete healthy catalog page')
      }
      for (const p of searchProducts) {
        if (!p || typeof p.id !== 'string' || !p.id || seenSearchIds.has(p.id)) {
          throw new Error('UCP search_catalog returned invalid or duplicate product identities')
        }
        seenSearchIds.add(p.id)
        if (p.id === expectedProductId) {
          if (!matchesExpected(p)) throw new Error('UCP search_catalog expected Shopify variant price or identity differs')
          searchMatched = true
        }
      }
      if (!pagination.has_next_page) { searchCompleted = true; break }
      const nextCursor = pagination.cursor
      if (typeof nextCursor !== 'string' || !nextCursor || seenSearchCursors.has(nextCursor)) {
        throw new Error('UCP search_catalog pagination cursor missing or repeated')
      }
      seenSearchCursors.add(nextCursor)
      searchCursor = nextCursor
    }
    if (!searchCompleted || !searchMatched) {
      throw new Error('UCP search_catalog did not discover expected Shopify variant across complete pagination')
    }
    const lookup = await ucpRpc(13, 'tools/call', {
      name: 'lookup_catalog', arguments: { meta, catalog: { ids: [expectedProductId] } },
    })
    if (lookup.isError || !Array.isArray(lookup.structuredContent?.products) ||
        lookup.structuredContent.products.length !== 1 ||
        !matchesExpected(lookup.structuredContent.products[0])) {
      throw new Error('UCP lookup_catalog did not preserve independently verified Shopify ID and price')
    }
    const get = await ucpRpc(14, 'tools/call', {
      name: 'get_product', arguments: { meta, catalog: { id: expectedProductId } },
    })
    if (get.isError || !matchesExpected(get.structuredContent?.product)) {
      throw new Error('UCP get_product did not preserve independently verified Shopify ID and price')
    }
    ucpCatalogVerified = true
  }
  const list = await rpc(3, 'tools/call', { name: 'vibecart.list_products', arguments: {} })
  if (list.isError || list.structuredContent?.success !== true || !Array.isArray(list.structuredContent.products)) {
    throw new Error('MCP list_products did not return a healthy catalog')
  }
  const products = list.structuredContent.products
  const ids = new Set()
  for (const p of products) {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) ||
        !Number.isSafeInteger(p.priceCents) || p.priceCents < 0) {
      throw new Error('MCP list_products returned invalid or duplicate products')
    }
    ids.add(p.id)
  }
  let verifiedProduct = false
  if (expectedProductId !== undefined) {
    const listedProduct = products.find(p => p.id === expectedProductId)
    if (!listedProduct) throw new Error('expected Radiantz Shopify variant ID absent from public catalog')
    if (expectedPriceCents !== undefined && listedProduct.priceCents !== expectedPriceCents) {
      throw new Error('MCP catalog price differs from independently verified Shopify price')
    }
    const found = await rpc(4, 'tools/call', { name: 'vibecart.get_product', arguments: { productId: expectedProductId } })
    const returned = found.structuredContent?.product
    if (found.isError || found.structuredContent?.success !== true ||
        returned?.id !== expectedProductId || returned.priceCents !== listedProduct.priceCents) {
      throw new Error('MCP get_product did not preserve expected product identity and price')
    }
    verifiedProduct = true
  }
  return { ok: true, ucpVersion: ucp.version, mcpVersion: initialized.protocolVersion,
    ucpTransportVerified: true, ucpCatalogVerified, productCount: products.length, expectedProductMatched: verifiedProduct,
    independentShopifyPriceMatched: verifiedProduct && expectedPriceCents !== undefined,
    note: verifiedProduct && expectedPriceCents !== undefined
      ? `Expected Shopify variant ID and independently verified USD price matched public MCP. ${ucpCatalogVerified ? 'UCP search/lookup/get also returned independently verified identity and price.' : 'UCP catalog tool calls were not invoked.'} Live Shopify freshness still requires a current read-only source check.`
      : verifiedProduct
        ? 'Expected Shopify variant ID matched, but its price was checked only for internal MCP consistency; Shopify price is NOT independently verified.'
        : 'Public MCP works; UCP discovery/transport contract verified without UCP catalog calls. Catalog merchant provenance is NOT verified without an expected Shopify variant ID and price.' }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2)
  const flag = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  const baseUrl = flag('--base-url')
  const expectedProductId = flag('--expected-product-id')
  const priceArg = flag('--expected-price-cents')
  const agentProfileUrl = flag('--agent-profile-url')
  const usePreviewOidc = args.includes('--use-preview-oidc')
  const priceValid = priceArg === undefined || (/^(0|[1-9]\d*)$/.test(priceArg) && Number.isSafeInteger(Number(priceArg)))
  if (!baseUrl || !priceValid || (priceArg !== undefined && !expectedProductId) ||
      args.some(v => v.startsWith('--') && !['--base-url', '--expected-product-id', '--expected-price-cents', '--agent-profile-url', '--use-preview-oidc'].includes(v)) ||
      args.length !== 2 + (expectedProductId ? 2 : 0) + (priceArg !== undefined ? 2 : 0) + (agentProfileUrl ? 2 : 0) + (usePreviewOidc ? 1 : 0)) {
    console.error('Usage: node scripts/probe-public-mcp.mjs --base-url https://example.com/ [--expected-product-id gid://shopify/ProductVariant/123 --expected-price-cents 6599 --agent-profile-url https://agent.example/profile.json] [--use-preview-oidc]')
    process.exitCode = 2
  } else {
    probePublicMcp({ baseUrl, expectedProductId, expectedPriceCents: priceArg === undefined ? undefined : Number(priceArg), agentProfileUrl,
      ...(usePreviewOidc ? { previewOidcToken: process.env.VERCEL_OIDC_TOKEN,
        approvedPreviewHost: process.env.VIBECART_PILOT_APPROVED_PREVIEW_HOST } : {}) })
      .then(result => console.log(JSON.stringify(result)))
      .catch(error => { console.error(`Read-only MCP probe failed: ${error.message}`); process.exitCode = 1 })
  }
}
