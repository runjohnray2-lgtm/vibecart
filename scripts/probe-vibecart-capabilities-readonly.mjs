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
const MCP_PROTOCOL_VERSION = '2025-06-18'
const REQUIRED_CATALOG_TOOLS = ['search_catalog', 'lookup_catalog', 'get_product']

const MAX_PROBE_BODY_BYTES = 256 * 1024

/**
 * Bound actual response bytes, not JavaScript string length. A missing or
 * incorrect Content-Length must not allow a public endpoint to stream an
 * unbounded body into an operator's read-only capability probe.
 */
export async function readBoundedProbeBody(response, relative) {
  const declared = response.headers?.get('content-length')
  if (typeof declared === 'string' && /^\d+$/.test(declared.trim()) &&
      Number(declared) > MAX_PROBE_BODY_BYTES) {
    throw new Error(relative + ' response exceeded probe limit')
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    let complete = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!(value instanceof Uint8Array)) throw new Error(relative + ' returned invalid response bytes')
        bytes += value.byteLength
        if (bytes > MAX_PROBE_BODY_BYTES) throw new Error(relative + ' response exceeded probe limit')
        chunks.push(value)
      }
      complete = true
    } finally {
      if (!complete && typeof reader.cancel === 'function') {
        try { await reader.cancel() } catch { /* preserve the original read error */ }
      }
      if (typeof reader.releaseLock === 'function') reader.releaseLock()
    }
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  }
  // Minimal test transports may expose text() without a streaming body.
  const body = await response.text()
  if (new TextEncoder().encode(body).byteLength > MAX_PROBE_BODY_BYTES) {
    throw new Error(relative + ' response exceeded probe limit')
  }
  return body
}

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
  let paginationRequestId = 2
  async function readJson(relative, method = 'GET', rpcMethod = null, rpcParams = null) {
    const rpcId = rpcMethod === 'initialize' ? 1 : rpcParams ? ++paginationRequestId : 2
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
        jsonrpc: '2.0', id: rpcId, method: rpcMethod,
        ...(rpcMethod === 'initialize' ? { params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'vibecart-readonly-probe', version: '1.0.0' } } } : rpcParams ? { params: rpcParams } : {}),
      }) } : {}),
    })
    if (!response?.ok) throw new Error(relative + ' ' + (rpcMethod || 'GET') + ' returned HTTP ' + (response?.status ?? 'unavailable'))
    if (!(response.headers?.get('content-type') || '').toLowerCase().includes('application/json')) {
      throw new Error(relative + ' did not return JSON')
    }
    const body = await readBoundedProbeBody(response, relative)
    let parsed
    try { parsed = JSON.parse(body) } catch { throw new Error(relative + ' returned malformed JSON') }
    if (rpcMethod && (parsed?.jsonrpc !== '2.0' || parsed?.id !== rpcId || parsed?.error || !parsed?.result)) {
      throw new Error(relative + ' ' + rpcMethod + ' returned invalid JSON-RPC')
    }
    return rpcMethod ? parsed.result : parsed
  }
  // MCP tools/list can be paginated. Checking only page one can falsely
  // claim complete capability discovery (or miss required catalog tools).
  // Bound traversal and fail closed on malformed, repeated or empty cursors.
  async function readAllTools(relative) {
    const tools = []
    const seenCursors = new Set()
    let cursor = null
    for (let page = 0; page < 20; page++) {
      const result = await readJson(relative, 'POST', 'tools/list', cursor === null ? null : { cursor })
      if (!Array.isArray(result?.tools)) throw new Error(relative + ' MCP tools/list missing tools')
      tools.push(...result.tools)
      if (tools.length > 1000) throw new Error(relative + ' MCP tools/list exceeded tool limit')
      if (result.nextCursor == null) return { tools }
      if (typeof result.nextCursor !== 'string' || !result.nextCursor.trim() ||
          seenCursors.has(result.nextCursor) || result.tools.length === 0) {
        throw new Error(relative + ' MCP tools/list invalid pagination cursor')
      }
      seenCursors.add(result.nextCursor)
      cursor = result.nextCursor
    }
    throw new Error(relative + ' MCP tools/list exceeded page limit')
  }
  const discovery = await readJson('/.well-known/ucp')
  const capabilities = discovery?.ucp?.capabilities
  const services = discovery?.ucp?.services?.['dev.ucp.shopping']
  // A non-empty capability is not sufficient evidence: require the current
  // UCP version and official HTTPS spec/schema metadata before claiming success.
  // Merely pointing at any URL under the released UCP version is not
  // compatibility evidence. Verify each advertised capability references its
  // actual released specification and schema, not a different operation.
  const officialEntry = (entry, specPath, schemaPath) =>
    entry && typeof entry === 'object' && entry.version === UCP_VERSION &&
    entry.spec === 'https://ucp.dev/' + UCP_VERSION + '/' + specPath &&
    entry.schema === 'https://ucp.dev/' + UCP_VERSION + '/' + schemaPath
  if (discovery?.ucp?.version !== UCP_VERSION || !capabilities ||
      !Array.isArray(services) || !services.some(s =>
        s?.transport === 'mcp' && s?.endpoint === origin + '/ucp/mcp' &&
        officialEntry(s, 'specification/overview', 'services/shopping/mcp.openrpc.json'))) {
    throw new Error('UCP discovery version/service endpoint mismatch')
  }
  const catalogMetadata = {
    'dev.ucp.shopping.catalog.search': ['specification/catalog/search', 'schemas/shopping/catalog_search.json'],
    'dev.ucp.shopping.catalog.lookup': ['specification/catalog/lookup', 'schemas/shopping/catalog_lookup.json'],
  }
  for (const [name, [specPath, schemaPath]] of Object.entries(catalogMetadata)) {
    if (!Array.isArray(capabilities[name]) ||
        !capabilities[name].some(entry => officialEntry(entry, specPath, schemaPath))) {
      throw new Error('UCP discovery missing compatible ' + name)
    }
  }
  // An RPC response and matching server name alone do not establish a
  // compatible MCP handshake; verify negotiated protocol and tools support.
  const requireInitialize = (result, expectedName) => {
    if (result?.serverInfo?.name !== expectedName ||
        result?.protocolVersion !== MCP_PROTOCOL_VERSION ||
        !result?.capabilities || typeof result.capabilities !== 'object' ||
        !result.capabilities.tools || typeof result.capabilities.tools !== 'object' ||
        Array.isArray(result.capabilities.tools)) {
      throw new Error('MCP initialize returned incompatible protocol or tools capability for ' + expectedName)
    }
  }
  const genericInit = await readJson('/mcp', 'POST', 'initialize')
  requireInitialize(genericInit, 'vibecart')
  const genericList = await readAllTools('/mcp')
  const ucpInit = await readJson('/ucp/mcp', 'POST', 'initialize')
  requireInitialize(ucpInit, 'vibecart-ucp')
  const ucpList = await readAllTools('/ucp/mcp')
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
  // A tool can advertise the expected fields yet still require additional
  // inputs (including credentials) that an independent catalog client cannot
  // supply. Verify the minimal read-only request is actually constructible.
  // JSON Schema can impose hidden mandatory inputs outside `required`
  // (for example allOf/if-then/dependentSchemas or minProperties). A
  // name-matching tool is not independently invokable if its advertised
  // schema adds such constraints. Fail closed rather than certify it.
  const hiddenConstraints = [
    '$ref', '$dynamicRef', 'allOf', 'anyOf', 'oneOf', 'not',
    'if', 'then', 'else', 'dependentRequired', 'dependentSchemas',
    'dependencies', 'minProperties', 'maxProperties', 'propertyNames',
    // These apply constraints to declared fields too, even when `required`
    // looks compatible. A pattern can secretly demand a credential.
    'patternProperties', 'unevaluatedProperties',
  ]
  const onlyRequires = (schema, allowed) =>
    schema && typeof schema === 'object' && !Array.isArray(schema) &&
    schema.type === 'object' &&
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) &&
    !hiddenConstraints.some(key => Object.hasOwn(schema, key)) &&
    (schema.required === undefined ||
      (Array.isArray(schema.required) &&
        schema.required.every(field => typeof field === 'string') &&
        new Set(schema.required).size === schema.required.length)) &&
    (schema.required ?? []).every(field => allowed.includes(field))
  // Catalog discovery must support arbitrary merchant IDs and agent profile
  // URLs. An enum/const/pattern/format or composed constraint on an input
  // string can make a named tool unusable for otherwise valid products.
  // This is input-schema compatibility evidence, NOT a real tool invocation.
  const acceptsCatalogString = (field, expectedFormat = null) =>
    field?.type === 'string' &&
    (expectedFormat === null ? field.format === undefined : field.format === expectedFormat) &&
    // A minimum longer than one character can reject otherwise valid
    // merchant IDs or queries even without enum/pattern restrictions.
    (field.minLength === undefined ||
      (Number.isSafeInteger(field.minLength) && field.minLength >= 0 && field.minLength <= 1)) &&
    !['const', 'enum', 'pattern', 'maxLength', '$ref', '$dynamicRef',
      'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some(key =>
      Object.hasOwn(field, key))
  function requireCatalogSchema(listed, name, required, protocol) {
    const tool = listed.find(entry => entry.name === name)
    if (!tool) throw new Error(protocol + ' MCP missing ' + name)
    // UCP catalog tools may omit optional MCP safety annotations, but an
    // explicit destructive or non-read-only declaration must not be reported
    // as safe catalog capability evidence. Never invoke these tools here.
    if (protocol === 'UCP' &&
        (tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint === false)) {
      throw new Error('UCP MCP advertises unsafe catalog tool ' + name)
    }
    const schema = tool.inputSchema
    if (schema?.type !== 'object' || !schema.properties ||
        !required.every(field => schema.required?.includes(field) && schema.properties[field])) {
      throw new Error(protocol + ' MCP incompatible input schema for ' + name)
    }
    if (protocol === 'Generic') {
      const allowed = name === 'vibecart.get_product' ? ['productId'] : []
      if (!onlyRequires(schema, allowed) ||
          tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false ||
          (name === 'vibecart.get_product' &&
            (!acceptsCatalogString(schema.properties.productId) ||
              !Number.isSafeInteger(schema.properties.productId?.minLength) ||
              schema.properties.productId.minLength < 1))) {
        throw new Error('Generic MCP unsafe or incompatible catalog tool ' + name)
      }
    } else {
      const meta = schema.properties.meta
      const catalog = schema.properties.catalog
      // A matching tool name is not enough for an independent agent to
      // negotiate its profile or construct a valid catalog request.
      const agent = meta?.properties?.['ucp-agent']
      if (!onlyRequires(schema, ['meta', 'catalog']) ||
          meta?.type !== 'object' || !Array.isArray(meta.required) ||
          !meta.required.includes('ucp-agent') || !onlyRequires(meta, ['ucp-agent']) ||
          agent?.type !== 'object' || !Array.isArray(agent.required) ||
          !agent.required.includes('profile') || !onlyRequires(agent, ['profile']) ||
          !acceptsCatalogString(agent.properties?.profile, 'uri') || catalog?.type !== 'object') {
        throw new Error('UCP MCP incompatible meta/catalog schema for ' + name)
      }
      if (name === 'search_catalog' &&
          (!acceptsCatalogString(catalog.properties?.query) || !onlyRequires(catalog, ['query']))) {
        throw new Error('UCP MCP incompatible catalog search schema for ' + name)
      }
      const key = name === 'lookup_catalog' ? 'ids' : name === 'get_product' ? 'id' : null
      if (key) {
        const field = catalog.properties?.[key]
        if (!onlyRequires(catalog, [key]) ||
            !Array.isArray(catalog.required) || !catalog.required.includes(key) ||
            field?.type !== (key === 'ids' ? 'array' : 'string') ||
            (key === 'ids' && (!acceptsCatalogString(field.items) ||
              // A lookup must accept a single ID; minItems: 2+ silently
              // rules out the smallest valid catalog lookup request.
              field.minItems !== 1 ||
              (field.maxItems !== undefined &&
                (!Number.isSafeInteger(field.maxItems) || field.maxItems < 1)) ||
              ['$ref', '$dynamicRef', 'allOf', 'anyOf', 'oneOf', 'not',
                'if', 'then', 'else', 'contains', 'minContains', 'maxContains',
                'prefixItems', 'unevaluatedItems'].some(constraint =>
                Object.hasOwn(field, constraint)))) ||
            (key === 'id' && (!acceptsCatalogString(field) || !Number.isSafeInteger(field.minLength) || field.minLength < 1))) {
          throw new Error('UCP MCP incompatible catalog lookup schema for ' + name)
        }
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
