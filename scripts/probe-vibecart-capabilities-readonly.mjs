/**
 * Safe public VibeCart MCP/UCP capability probe. Does NOT call tools/call,
 * create carts/orders, access Shopify Admin, or use credentials.
 *
 * VIBECART_READONLY_BASE_URL=https://vibecart.vercel.app \
 *   node scripts/probe-vibecart-capabilities-readonly.mjs
 *
 * A successful result proves discovery and tool-list reachability only;
 * it does not prove a real merchant feed, external agent compatibility,
 * staging isolation, or checkout readiness.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UCP_VERSION = '2026-04-08'
const REQUIRED_CATALOG_TOOLS = ['search_catalog', 'lookup_catalog', 'get_product']

export function validatePublicTarget(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('VIBECART_READONLY_BASE_URL is required')
  let url
  try { url = new URL(raw) } catch { throw new Error('Invalid public VibeCart URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^vibecart(?:-[a-z0-9-]+)?\.vercel\.app$/.test(url.hostname)) {
    throw new Error('Probe only accepts an HTTPS public vibecart*.vercel.app origin')
  }
  return url.origin
}

export async function probeVibeCartCapabilitiesReadOnly({ baseUrl, fetchImpl = fetch } = {}) {
  const origin = validatePublicTarget(baseUrl)
  const operations = []
  async function readJson(relative, method = 'GET', rpcMethod = null) {
    if (method === 'POST' && !['initialize', 'tools/list'].includes(rpcMethod)) {
      throw new Error('Read-only probe forbids this RPC method')
    }
    operations.push(method + ' ' + relative + (rpcMethod ? ' ' + rpcMethod : ''))
    const response = await fetchImpl(origin + relative, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json', ...(rpcMethod ? { 'content-type': 'application/json' } : {}) },
      ...(rpcMethod ? { body: JSON.stringify({
        jsonrpc: '2.0', id: rpcMethod === 'initialize' ? 1 : 2, method: rpcMethod,
        ...(rpcMethod === 'initialize' ? { params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vibecart-readonly-probe', version: '1.0.0' } } } : {}),
      }) } : {}),
    })
    if (!response?.ok) throw new Error(relative + ' ' + (rpcMethod || 'GET') + ' returned HTTP ' + (response?.status ?? 'unavailable'))
    if (!(response.headers?.get('content-type') || '').toLowerCase().includes('application/json')) {
      throw new Error(relative + ' did not return JSON')
    }
    const body = await response.text()
    if (body.length > 256 * 1024) throw new Error(relative + ' response exceeded probe limit')
    let parsed
    try { parsed = JSON.parse(body) } catch { throw new Error(relative + ' returned malformed JSON') }
    if (rpcMethod && (parsed?.jsonrpc !== '2.0' || parsed?.id !== (rpcMethod === 'initialize' ? 1 : 2) || parsed?.error || !parsed?.result)) {
      throw new Error(relative + ' ' + rpcMethod + ' returned invalid JSON-RPC')
    }
    return rpcMethod ? parsed.result : parsed
  }
  const discovery = await readJson('/.well-known/ucp')
  const capabilities = discovery?.ucp?.capabilities
  const services = discovery?.ucp?.services?.['dev.ucp.shopping']
  if (discovery?.ucp?.version !== UCP_VERSION || !capabilities ||
      !Array.isArray(services) || !services.some(s => s?.transport === 'mcp' && s?.endpoint === origin + '/ucp/mcp')) {
    throw new Error('UCP discovery version/service endpoint mismatch')
  }
  for (const name of ['dev.ucp.shopping.catalog.search', 'dev.ucp.shopping.catalog.lookup']) {
    if (!Array.isArray(capabilities[name]) || capabilities[name].length === 0) {
      throw new Error('UCP discovery missing ' + name)
    }
  }
  const genericInit = await readJson('/mcp', 'POST', 'initialize')
  const genericList = await readJson('/mcp', 'POST', 'tools/list')
  const ucpInit = await readJson('/ucp/mcp', 'POST', 'initialize')
  const ucpList = await readJson('/ucp/mcp', 'POST', 'tools/list')
  if (genericInit?.serverInfo?.name !== 'vibecart' || ucpInit?.serverInfo?.name !== 'vibecart-ucp') {
    throw new Error('MCP initialize returned unexpected server identity')
  }
  const toolsOf = result => {
    if (!Array.isArray(result?.tools)) throw new Error('MCP tools/list missing tools')
    const names = result.tools.map(tool => tool?.name)
    if (names.some(name => typeof name !== 'string') || new Set(names).size !== names.length) {
      throw new Error('MCP tools/list contains invalid or duplicate names')
    }
    return result.tools
  }
  const genericListed = toolsOf(genericList)
  const ucpListed = toolsOf(ucpList)
  const genericTools = genericListed.map(tool => tool.name)
  const ucpTools = ucpListed.map(tool => tool.name)
  // A tool name alone is not proof that a compatible agent can invoke it.
  // Fail closed when a deployed endpoint advertises stale or unsafe catalog schemas.
  function requireCatalogSchema(listed, name, required, protocol) {
    const tool = listed.find(entry => entry.name === name)
    if (!tool) throw new Error(protocol + ' MCP missing ' + name)
    const schema = tool.inputSchema
    if (schema?.type !== 'object' || !schema.properties ||
        !required.every(field => schema.required?.includes(field) && schema.properties[field])) {
      throw new Error(protocol + ' MCP incompatible input schema for ' + name)
    }
    if (protocol === 'Generic') {
      if (tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false ||
          (name === 'vibecart.get_product' && schema.properties.productId?.type !== 'string')) {
        throw new Error('Generic MCP unsafe or incompatible catalog tool ' + name)
      }
    } else {
      const meta = schema.properties.meta
      const catalog = schema.properties.catalog
      if (meta?.type !== 'object' || !meta.required?.includes('ucp-agent') ||
          catalog?.type !== 'object') {
        throw new Error('UCP MCP incompatible meta/catalog schema for ' + name)
      }
      const key = name === 'lookup_catalog' ? 'ids' : name === 'get_product' ? 'id' : null
      if (key && (!catalog.required?.includes(key) ||
          catalog.properties?.[key]?.type !== (key === 'ids' ? 'array' : 'string'))) {
        throw new Error('UCP MCP incompatible catalog lookup schema for ' + name)
      }
    }
  }
  requireCatalogSchema(genericListed, 'vibecart.list_products', [], 'Generic')
  requireCatalogSchema(genericListed, 'vibecart.get_product', ['productId'], 'Generic')
  for (const name of REQUIRED_CATALOG_TOOLS) {
    requireCatalogSchema(ucpListed, name, ['meta', 'catalog'], 'UCP')
  }
  return {
    discoveryVerified: true,
    genericMcpInitialized: true,
    ucpMcpInitialized: true,
    genericTools,
    ucpTools,
    requestCount: operations.length,
    methodsUsed: [...new Set(operations.map(op => op.split(' ')[0]))],
    readOnly: true,
    realMerchantCatalogVerified: false,
    checkoutVerified: false,
    note: 'Public capability discovery only. No tools/call, catalog read, cart, checkout, database or payment request.',
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await probeVibeCartCapabilitiesReadOnly({ baseUrl: process.env.VIBECART_READONLY_BASE_URL })
    console.log(JSON.stringify(result))
  } catch {
    console.error('Read-only MCP/UCP probe failed; check public endpoint, protocol and advertised capabilities.')
    process.exitCode = 1
  }
}
