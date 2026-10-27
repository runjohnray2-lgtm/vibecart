import test from 'node:test'
import assert from 'node:assert/strict'
import { probeVibeCartCapabilitiesReadOnly, validatePublicTarget, readBoundedProbeBody } from '../scripts/probe-vibecart-capabilities-readonly.mjs'

const origin = 'https://vibecart.vercel.app'
const rpc = (id, result) => ({ jsonrpc: '2.0', id, result })
const official = (spec, schema) => ({
  version: '2026-04-08',
  spec: 'https://ucp.dev/2026-04-08/' + spec,
  schema: 'https://ucp.dev/2026-04-08/' + schema,
})
const validUcp = {
  ucp: { version: '2026-04-08',
    services: { 'dev.ucp.shopping': [{
      transport: 'mcp', endpoint: origin + '/ucp/mcp',
      ...official('specification/overview', 'services/shopping/mcp.openrpc.json'),
    }] },
    capabilities: {
      'dev.ucp.shopping.catalog.search': [official('specification/catalog/search', 'schemas/shopping/catalog_search.json')],
      'dev.ucp.shopping.catalog.lookup': [official('specification/catalog/lookup', 'schemas/shopping/catalog_lookup.json')],
    },
  },
}
const genericTool = (name, lookup = false) => ({
  name,
  inputSchema: lookup
    ? { type: 'object', required: ['productId'], properties: { productId: { type: 'string', minLength: 1 } } }
    : { type: 'object', properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false },
})
const ucpTool = (name, key = null) => ({
  name,
  inputSchema: {
    type: 'object', required: ['meta', 'catalog'],
    properties: {
      meta: {
        type: 'object', required: ['ucp-agent'],
        properties: { 'ucp-agent': {
          type: 'object', required: ['profile'],
          properties: { profile: { type: 'string', format: 'uri' } },
        } },
      },
      catalog: {
        type: 'object',
        ...(key ? { required: [key] } : {}),
        properties: key
          ? { [key]: key === 'ids'
            ? { type: 'array', minItems: 1, items: { type: 'string' } }
            : { type: 'string', minLength: 1 } }
          : { query: { type: 'string' } },
      },
    },
  },
})
const replies = [
  validUcp,
  rpc(1, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vibecart' } }),
  rpc(2, { tools: [
    genericTool('vibecart.list_products'),
    genericTool('vibecart.get_product', true),
    { name: 'vibecart.create_checkout' },
  ] }),
  rpc(1, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vibecart-ucp' } }),
  rpc(2, { tools: [
    ucpTool('search_catalog'),
    ucpTool('lookup_catalog', 'ids'),
    ucpTool('get_product', 'id'),
  ] }),
]
function stub(overrides = {}) {
  let index = 0
  const requests = []
  return { requests, fetchImpl: async (url, options) => {
    requests.push({ url, options })
    const payload = overrides[index] ?? replies[index]
    index++
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(payload) }
  } }
}

test('only public VibeCart HTTPS origins are accepted', () => {
  assert.equal(validatePublicTarget(origin), origin)
  assert.equal(validatePublicTarget('https://vibecart-git-safe-promptmeter.vercel.app'), 'https://vibecart-git-safe-promptmeter.vercel.app')
  for (const value of ['http://vibecart.vercel.app', 'https://localhost', 'https://127.0.0.1', 'https://evil.vercel.app', 'https://vibecart.vercel.app:444', 'https://vibecart.vercel.app/foo', 'https://vibecart.vercel.app@evil.test', 'https://vibecart.vercel.app?token=secret']) {
    assert.throws(() => validatePublicTarget(value))
  }
})

test('probe performs only five capability requests, never tools/call', async () => {
  const s = stub()
  const result = await probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl })
  assert.equal(result.discoveryVerified, true)
  assert.equal(result.requestCount, 5)
  assert.equal(result.realMerchantCatalogVerified, false)
  assert.equal(result.checkoutVerified, false)
  assert.deepEqual(s.requests.map(r => r.options.method), ['GET', 'POST', 'POST', 'POST', 'POST'])
  for (const r of s.requests) {
    assert.equal(r.options.redirect, 'manual')
    assert.equal(r.options.headers.authorization, undefined)
    if (r.options.body) assert.ok(['initialize', 'tools/list'].includes(JSON.parse(r.options.body).method))
  }
})

test('probe rejects missing UCP discovery catalog capabilities', async () => {
  const s = stub({ 0: { ucp: { ...validUcp.ucp, capabilities: {} } } })
  await assert.rejects(probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }), /missing/)
  assert.equal(s.requests.length, 1)
})

test('probe rejects stale or untrusted UCP discovery metadata without contacting MCP', async () => {
  const search = validUcp.ucp.capabilities['dev.ucp.shopping.catalog.search'][0]
  const service = validUcp.ucp.services['dev.ucp.shopping'][0]
  const invalid = [
    { ucp: { ...validUcp.ucp, capabilities: {
      ...validUcp.ucp.capabilities,
      'dev.ucp.shopping.catalog.search': [{ ...search, version: '2025-01-01' }],
    } } },
    { ucp: { ...validUcp.ucp, capabilities: {
      ...validUcp.ucp.capabilities,
      'dev.ucp.shopping.catalog.search': [{ ...search, schema: 'https://attacker.example/schema.json' }],
    } } },
    { ucp: { ...validUcp.ucp, capabilities: {
      ...validUcp.ucp.capabilities,
      'dev.ucp.shopping.catalog.search': [{ ...search, spec: 'https://ucp.dev/2025-01-01/specification/catalog/search' }],
    } } },
    { ucp: { ...validUcp.ucp, services: { 'dev.ucp.shopping': [{
      ...service, schema: 'https://ucp.dev.evil.test/schema.json',
    }] } } },
    { ucp: { ...validUcp.ucp, services: { 'dev.ucp.shopping': [{
      ...service, version: '2025-01-01',
    }] } } },
    // A same-version official domain with the WRONG operation's schema/spec
    // is not evidence that this capability conforms to the released contract.
    { ucp: { ...validUcp.ucp, services: { 'dev.ucp.shopping': [{
      ...service, schema: 'https://ucp.dev/2026-04-08/services/shopping/unrelated.openrpc.json',
    }] } } },
    { ucp: { ...validUcp.ucp, capabilities: {
      ...validUcp.ucp.capabilities,
      'dev.ucp.shopping.catalog.search': [{
        ...search, spec: 'https://ucp.dev/2026-04-08/specification/catalog/lookup',
      }],
    } } },
    { ucp: { ...validUcp.ucp, capabilities: {
      ...validUcp.ucp.capabilities,
      'dev.ucp.shopping.catalog.lookup': [{
        ...validUcp.ucp.capabilities['dev.ucp.shopping.catalog.lookup'][0],
        schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_search.json',
      }],
    } } },
  ]
  for (const discovery of invalid) {
    const s = stub({ 0: discovery })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      /UCP discovery/,
    )
    assert.equal(s.requests.length, 1, 'invalid discovery must not trigger MCP requests')
  }
})

test('probe rejects missing catalog tools without attempting calls', async () => {
  const s = stub({ 4: rpc(2, { tools: [ucpTool('search_catalog')] }) })
  await assert.rejects(probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }), /missing/)
  assert.equal(s.requests.length, 5)
})

test('probe rejects JSON-RPC error or mismatched request id', async () => {
  for (const invalid of [{ jsonrpc: '2.0', id: 1, error: { code: -1 } }, rpc(99, { tools: [] })]) {
    const s = stub({ 2: invalid })
    await assert.rejects(probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }), /invalid JSON-RPC/)
    assert.equal(s.requests.length, 3)
  }
})

test('probe rejects generic catalog tools that are not explicitly read-only', async () => {
  const unsafe = { ...genericTool('vibecart.get_product', true), annotations: { readOnlyHint: false, destructiveHint: false } }
  const s = stub({ 2: rpc(2, { tools: [genericTool('vibecart.list_products'), unsafe] }) })
  await assert.rejects(probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }), /unsafe or incompatible/)
  assert.equal(s.requests.length, 5)
})

test('probe rejects UCP catalog tools explicitly declaring destructive or non-read-only behavior', async () => {
  for (const { name, annotations } of [
    { name: 'search_catalog', annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'lookup_catalog', annotations: { readOnlyHint: true, destructiveHint: true } },
    { name: 'get_product', annotations: { destructiveHint: true } },
  ]) {
    const tools = [ucpTool('search_catalog'), ucpTool('lookup_catalog', 'ids'), ucpTool('get_product', 'id')]
    tools.find(tool => tool.name === name).annotations = annotations
    const s = stub({ 4: rpc(2, { tools }) })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      /UCP MCP advertises unsafe catalog tool/,
      name + ' must not be certified as safe when annotations contradict read-only discovery',
    )
    assert.equal(s.requests.length, 5)
    assert.ok(s.requests.every(request => !request.options.body ||
      ['initialize', 'tools/list'].includes(JSON.parse(request.options.body).method)))
  }
})

test('probe rejects catalog discovery that demands additional required credentials or inputs', async () => {
  const invalid = [
    { index: 2, name: 'vibecart.list_products', mutate: tool => {
      tool.inputSchema.required = ['merchantSecret']
      tool.inputSchema.properties.merchantSecret = { type: 'string' }
    }, error: /Generic MCP unsafe or incompatible/ },
    { index: 2, name: 'vibecart.get_product', mutate: tool => {
      tool.inputSchema.required.push('token')
      tool.inputSchema.properties.token = { type: 'string' }
    }, error: /Generic MCP unsafe or incompatible/ },
    { index: 2, name: 'vibecart.get_product', mutate: tool => {
      tool.inputSchema.properties.productId.minLength = 0
    }, error: /Generic MCP unsafe or incompatible/ },
    { index: 4, name: 'search_catalog', mutate: tool => {
      tool.inputSchema.required.push('secret')
      tool.inputSchema.properties.secret = { type: 'string' }
    }, error: /UCP MCP incompatible meta\/catalog schema/ },
    { index: 4, name: 'search_catalog', mutate: tool => {
      const meta = tool.inputSchema.properties.meta
      meta.required.push('token')
      meta.properties.token = { type: 'string' }
    }, error: /UCP MCP incompatible meta\/catalog schema/ },
    { index: 4, name: 'lookup_catalog', mutate: tool => {
      const catalog = tool.inputSchema.properties.catalog
      catalog.required.push('apiKey')
      catalog.properties.apiKey = { type: 'string' }
    }, error: /UCP MCP incompatible catalog lookup schema/ },
    { index: 4, name: 'get_product', mutate: tool => {
      const agent = tool.inputSchema.properties.meta.properties['ucp-agent']
      agent.required.push('password')
      agent.properties.password = { type: 'string' }
    }, error: /UCP MCP incompatible meta\/catalog schema/ },
  ]
  for (const { index, name, mutate, error } of invalid) {
    const payload = structuredClone(replies[index])
    mutate(payload.result.tools.find(tool => tool.name === name))
    const s = stub({ [index]: payload })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      error,
    )
    assert.equal(s.requests.length, 5)
    assert.ok(s.requests.every(request => !request.options.body ||
      ['initialize', 'tools/list'].includes(JSON.parse(request.options.body).method)))
  }
})

test('probe rejects composed or conditional schemas that conceal mandatory catalog inputs', async () => {
  const cases = [
    { index: 2, name: 'vibecart.list_products', target: tool => tool.inputSchema,
      key: 'allOf', value: [{ required: ['secret'] }], error: /Generic MCP unsafe or incompatible/ },
    { index: 2, name: 'vibecart.get_product', target: tool => tool.inputSchema,
      key: 'minProperties', value: 2, error: /Generic MCP unsafe or incompatible/ },
    { index: 4, name: 'search_catalog', target: tool => tool.inputSchema,
      key: 'dependentSchemas', value: { meta: { required: ['token'] } }, error: /meta\/catalog schema/ },
    { index: 4, name: 'search_catalog', target: tool => tool.inputSchema.properties.meta,
      key: 'if', value: { required: ['ucp-agent'] }, error: /meta\/catalog schema/ },
    { index: 4, name: 'lookup_catalog', target: tool => tool.inputSchema.properties.meta.properties['ucp-agent'],
      key: '$ref', value: '#/$defs/agentWithSecret', error: /meta\/catalog schema/ },
    { index: 4, name: 'search_catalog', target: tool => tool.inputSchema.properties.catalog,
      key: 'allOf', value: [{ required: ['apiKey'] }], error: /catalog search schema/ },
    { index: 4, name: 'lookup_catalog', target: tool => tool.inputSchema.properties.catalog,
      key: 'minProperties', value: 2, error: /catalog lookup schema/ },
    { index: 4, name: 'get_product', target: tool => tool.inputSchema.properties.catalog,
      key: 'dependentRequired', value: { id: ['token'] }, error: /catalog lookup schema/ },
  ]
  for (const { index, name, target, key, value, error } of cases) {
    const payload = structuredClone(replies[index])
    const tool = payload.result.tools.find(entry => entry.name === name)
    target(tool)[key] = value
    const s = stub({ [index]: payload })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      error,
      name + ' with ' + key + ' must not be certified as invokable',
    )
    assert.equal(s.requests.length, 5)
    assert.ok(s.requests.every(request => !request.options.body ||
      ['initialize', 'tools/list'].includes(JSON.parse(request.options.body).method)))
  }
})

test('probe rejects catalog ID or profile schemas narrowed to specific values', async () => {
  const cases = [
    { index: 2, name: 'vibecart.get_product',
      target: tool => tool.inputSchema.properties.productId,
      key: 'enum', value: ['only-one-id'], error: /Generic MCP unsafe or incompatible/ },
    { index: 4, name: 'search_catalog',
      target: tool => tool.inputSchema.properties.catalog.properties.query,
      key: 'const', value: 'fixed-query', error: /catalog search schema/ },
    { index: 4, name: 'lookup_catalog',
      target: tool => tool.inputSchema.properties.catalog.properties.ids.items,
      key: 'pattern', value: '^restricted-', error: /catalog lookup schema/ },
    { index: 4, name: 'get_product',
      target: tool => tool.inputSchema.properties.catalog.properties.id,
      key: 'maxLength', value: 3, error: /catalog lookup schema/ },
    { index: 4, name: 'get_product',
      target: tool => tool.inputSchema.properties.meta.properties['ucp-agent'].properties.profile,
      key: 'enum', value: ['https://only-one-agent.example/profile'],
      error: /meta\/catalog schema/ },
  ]
  for (const { index, name, target, key, value, error } of cases) {
    const payload = structuredClone(replies[index])
    target(payload.result.tools.find(tool => tool.name === name))[key] = value
    const s = stub({ [index]: payload })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      error,
      name + ' with ' + key + ' must not certify arbitrary merchant IDs or agent profiles',
    )
    assert.equal(s.requests.length, 5)
    assert.ok(s.requests.every(request => !request.options.body ||
      ['initialize', 'tools/list'].includes(JSON.parse(request.options.body).method)))
  }
})

test('probe rejects catalog schemas that cannot accept a short ID or single lookup', async () => {
  const cases = [
    { index: 2, name: 'vibecart.get_product',
      target: tool => tool.inputSchema.properties.productId,
      key: 'minLength', value: 500, error: /Generic MCP unsafe or incompatible/ },
    { index: 4, name: 'search_catalog',
      target: tool => tool.inputSchema.properties.catalog.properties.query,
      key: 'minLength', value: 2, error: /catalog search schema/ },
    { index: 4, name: 'get_product',
      target: tool => tool.inputSchema.properties.meta.properties['ucp-agent'].properties.profile,
      key: 'minLength', value: 999, error: /meta\/catalog schema/ },
    { index: 4, name: 'lookup_catalog',
      target: tool => tool.inputSchema.properties.catalog.properties.ids.items,
      key: 'minLength', value: 2, error: /catalog lookup schema/ },
    { index: 4, name: 'lookup_catalog',
      target: tool => tool.inputSchema.properties.catalog.properties.ids,
      key: 'maxItems', value: 0, error: /catalog lookup schema/ },
    { index: 4, name: 'lookup_catalog',
      target: tool => tool.inputSchema.properties.catalog.properties.ids,
      key: 'contains', value: { const: 'only-one-allowed-id' }, error: /catalog lookup schema/ },
  ]
  for (const { index, name, target, key, value, error } of cases) {
    const payload = structuredClone(replies[index])
    target(payload.result.tools.find(tool => tool.name === name))[key] = value
    const s = stub({ [index]: payload })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      error,
      name + ' with ' + key + ' must not be certified for arbitrary catalog IDs',
    )
    assert.equal(s.requests.length, 5)
    assert.ok(s.requests.every(request => !request.options.body ||
      ['initialize', 'tools/list'].includes(JSON.parse(request.options.body).method)))
  }
})

test('probe rejects UCP lookup tools with incompatible input schemas', async () => {
  const s = stub({ 4: rpc(2, { tools: [
    ucpTool('search_catalog'),
    ucpTool('lookup_catalog', 'id'),
    ucpTool('get_product', 'id'),
  ] }) })
  await assert.rejects(probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }), /incompatible catalog lookup schema/)
  assert.equal(s.requests.length, 5)
})

test('probe rejects UCP tools that cannot negotiate agent profile or construct catalog requests', async () => {
  const invalid = [
    { name: 'search_catalog', mutate: tool => { delete tool.inputSchema.properties.catalog.properties.query }, error: /catalog search schema/ },
    { name: 'search_catalog', mutate: tool => { delete tool.inputSchema.properties.meta.properties['ucp-agent'].required }, error: /meta\/catalog schema/ },
    { name: 'lookup_catalog', mutate: tool => { tool.inputSchema.properties.catalog.properties.ids.items.type = 'integer' }, error: /catalog lookup schema/ },
    { name: 'lookup_catalog', mutate: tool => { tool.inputSchema.properties.catalog.properties.ids.minItems = 0 }, error: /catalog lookup schema/ },
    { name: 'get_product', mutate: tool => { tool.inputSchema.properties.catalog.properties.id.minLength = 0 }, error: /catalog lookup schema/ },
  ]
  for (const { name, mutate, error } of invalid) {
    const tools = [
      ucpTool('search_catalog'),
      ucpTool('lookup_catalog', 'ids'),
      ucpTool('get_product', 'id'),
    ]
    mutate(tools.find(tool => tool.name === name))
    const s = stub({ 4: rpc(2, { tools }) })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      error,
    )
    assert.equal(s.requests.length, 5, 'probe must not invoke tools/call')
    assert.ok(s.requests.every(request => !request.options.body ||
      JSON.parse(request.options.body).method !== 'tools/call'))
  }
})

test('probe rejects incompatible MCP initialize handshakes before listing more tools', async () => {
  for (const { index, change } of [
    { index: 1, change: init => { delete init.protocolVersion } },
    { index: 1, change: init => { init.protocolVersion = '2024-11-05' } },
    { index: 1, change: init => { delete init.capabilities.tools } },
    { index: 3, change: init => { init.protocolVersion = '2024-11-05' } },
    { index: 3, change: init => { init.capabilities.tools = null } },
  ]) {
    const response = structuredClone(replies[index])
    change(response.result)
    const s = stub({ [index]: response })
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      /incompatible protocol or tools capability/,
    )
    assert.equal(s.requests.length, index + 1)
    assert.ok(s.requests.every(request => !request.options.body ||
      ['initialize', 'tools/list'].includes(JSON.parse(request.options.body).method)))
  }
})

function pagedStub(payloads) {
  let index = 0
  const requests = []
  return { requests, fetchImpl: async (url, options) => {
    requests.push({ url, options })
    const payload = payloads[index++]
    if (!payload) throw new Error('unexpected pagination request')
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(payload) }
  } }
}

test('probe exhausts paginated generic and UCP tool lists without invoking tools', async () => {
  const s = pagedStub([
    replies[0], replies[1],
    rpc(2, { tools: [genericTool('vibecart.list_products')], nextCursor: 'generic-page-2' }),
    rpc(3, { tools: [genericTool('vibecart.get_product', true)] }),
    replies[3],
    rpc(2, { tools: [ucpTool('search_catalog')], nextCursor: 'ucp-page-2' }),
    rpc(4, { tools: [ucpTool('lookup_catalog', 'ids'), ucpTool('get_product', 'id')] }),
  ])
  const result = await probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl })
  assert.equal(result.requestCount, 7)
  assert.equal(result.genericTools.length, 2)
  assert.equal(result.ucpTools.length, 3)
  assert.deepEqual(s.requests.filter(r => r.options.body && JSON.parse(r.options.body).params?.cursor)
    .map(r => JSON.parse(r.options.body).params.cursor), ['generic-page-2', 'ucp-page-2'])
  assert.ok(s.requests.every(r => !r.options.body ||
    ['initialize', 'tools/list'].includes(JSON.parse(r.options.body).method)))
})

test('probe fails closed on invalid, repeated or empty paginated tool pages', async () => {
  for (const { first, second, count } of [
    { first: { tools: [genericTool('vibecart.list_products')], nextCursor: '' }, count: 3 },
    { first: { tools: [genericTool('vibecart.list_products')], nextCursor: 'repeat' },
      second: { tools: [genericTool('vibecart.get_product', true)], nextCursor: 'repeat' }, count: 4 },
    { first: { tools: [genericTool('vibecart.list_products')], nextCursor: 'empty' },
      second: { tools: [], nextCursor: 'more' }, count: 4 },
  ]) {
    const s = pagedStub([replies[0], replies[1], rpc(2, first), ...(second ? [rpc(3, second)] : [])])
    await assert.rejects(
      probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
      /invalid pagination cursor/,
    )
    assert.equal(s.requests.length, count)
  }
})

test('probe rejects duplicate tool identities across pagination boundaries', async () => {
  const s = pagedStub([
    replies[0], replies[1],
    rpc(2, { tools: [genericTool('vibecart.list_products')], nextCursor: 'next' }),
    rpc(3, { tools: [genericTool('vibecart.list_products'), genericTool('vibecart.get_product', true)] }),
    replies[3], replies[4],
  ])
  await assert.rejects(
    probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl: s.fetchImpl }),
    /duplicate names/,
  )
  assert.equal(s.requests.length, 6)
})

test('probe rejects declared oversized JSON before reading the response body', async () => {
  let read = false
  const response = {
    headers: { get: name => name === 'content-length' ? String(256 * 1024 + 1) : null },
    text: async () => { read = true; return '{}' },
  }
  await assert.rejects(readBoundedProbeBody(response, '/.well-known/ucp'), /exceeded probe limit/)
  assert.equal(read, false)
})

test('probe caps actual UTF-8 response bytes, not just JavaScript string length', async () => {
  const response = {
    headers: { get: () => null },
    text: async () => '€'.repeat(90_000),
  }
  await assert.rejects(readBoundedProbeBody(response, '/mcp'), /exceeded probe limit/)
})

test('probe accepts a small streamed JSON body and cancels oversized streams before MCP calls', async () => {
  const encoder = new TextEncoder()
  const small = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"ok":true}'))
      controller.close()
    },
  })
  assert.equal(await readBoundedProbeBody({
    headers: { get: () => null }, body: small,
  }, '/mcp'), '{"ok":true}')

  let cancelled = false
  const large = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(180_000))
      controller.enqueue(new Uint8Array(90_000))
    },
    cancel() { cancelled = true },
  })
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method })
    return {
      ok: true, status: 200,
      headers: { get: name => name === 'content-type' ? 'application/json' : null },
      body: large,
    }
  }
  await assert.rejects(
    probeVibeCartCapabilitiesReadOnly({ baseUrl: origin, fetchImpl }),
    /exceeded probe limit/,
  )
  assert.equal(cancelled, true)
  assert.deepEqual(requests.map(request => request.method), ['GET'])
})
