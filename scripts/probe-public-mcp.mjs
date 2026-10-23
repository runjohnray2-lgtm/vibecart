/**
 * Explicit, read-only public VibeCart MCP/UCP acceptance probe.
 * No credentials, checkout/cart/order calls, merchant writes, or Stripe requests.
 * A successful probe proves endpoint compatibility, NOT Shopify provenance.
 */
const READ_ONLY_TOOLS = new Set(['vibecart.list_products', 'vibecart.get_product'])
const READ_ONLY_UCP_TOOLS = new Set(['search_catalog', 'lookup_catalog', 'get_product'])

function originOf(baseUrl) {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('base URL must be a bare HTTPS origin with no credentials or path')
  }
  return url.origin
}

async function jsonRequest(fetchImpl, url, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetchImpl(url, {
      method, redirect: 'manual', signal: controller.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
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

export async function probePublicMcp({ baseUrl, expectedProductId, fetchImpl = fetch }) {
  const origin = originOf(baseUrl)
  if (expectedProductId !== undefined &&
      (typeof expectedProductId !== 'string' || !/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(expectedProductId))) {
    throw new Error('expectedProductId must be a verified Shopify ProductVariant GID')
  }
  const discovery = await jsonRequest(fetchImpl, `${origin}/.well-known/ucp`)
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
  const rpc = async (id, method, params = {}) => rpcResult(await jsonRequest(fetchImpl, `${origin}/mcp`, {
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
  const ucpRpc = async (id, method, params = {}) => rpcResult(await jsonRequest(fetchImpl, ucpEndpoint, {
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
    const found = await rpc(4, 'tools/call', { name: 'vibecart.get_product', arguments: { productId: expectedProductId } })
    const returned = found.structuredContent?.product
    if (found.isError || found.structuredContent?.success !== true ||
        returned?.id !== expectedProductId || returned.priceCents !== listedProduct.priceCents) {
      throw new Error('MCP get_product did not preserve expected product identity and price')
    }
    verifiedProduct = true
  }
  return { ok: true, ucpVersion: ucp.version, mcpVersion: initialized.protocolVersion,
    ucpTransportVerified: true, productCount: products.length, expectedProductMatched: verifiedProduct,
    note: verifiedProduct ? 'Expected ID and price matched public MCP; live Shopify freshness still requires independent verification. UCP catalog tool calls require negotiated agent profile and were not invoked.'
      : 'Public MCP works; UCP discovery/transport contract verified without UCP catalog calls. Catalog merchant provenance is NOT verified without an expected Shopify variant ID.' }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2)
  const flag = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  const baseUrl = flag('--base-url')
  const expectedProductId = flag('--expected-product-id')
  if (!baseUrl || args.some((v, i) => v.startsWith('--') && !['--base-url', '--expected-product-id'].includes(v)) ||
      args.length !== (expectedProductId ? 4 : 2)) {
    console.error('Usage: node scripts/probe-public-mcp.mjs --base-url https://example.com/ [--expected-product-id gid://shopify/ProductVariant/123]')
    process.exitCode = 2
  } else {
    probePublicMcp({ baseUrl, expectedProductId })
      .then(result => console.log(JSON.stringify(result)))
      .catch(error => { console.error(`Read-only MCP probe failed: ${error.message}`); process.exitCode = 1 })
  }
}
