import assert from 'node:assert/strict'
import test from 'node:test'
import { probePublicMcp } from '../scripts/probe-public-mcp.mjs'

const ID = 'gid://shopify/ProductVariant/123'
const product = { id: ID, name: 'Synthetic light', priceCents: 6599 }
const agentProfileUrl = 'https://agent.example/profile.json'
const READ_ONLY_NAMES = new Set(['search_catalog', 'lookup_catalog', 'get_product', 'vibecart.list_products', 'vibecart.get_product'])
const ucpProduct = {
  id: ID, price_range: { min: { amount: 6599, currency: 'USD' }, max: { amount: 6599, currency: 'USD' } },
  variants: [{ id: ID, price: { amount: 6599, currency: 'USD' } }],
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
function mockFetch({ products = [product], annotations = { readOnlyHint: true, destructiveHint: false }, getProduct = product, badUcpEndpoint = false, missingUcpTool = false, badUcpPrice = false, emptyUcpSearch = false, searchPages = null } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    if (options.signal.aborted) throw new Error('unexpected abort')
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, method: options.method, body, headers: options.headers, redirect: options.redirect })
    if (url.endsWith('/.well-known/ucp')) return json({ ucp: { version: '2026-04-08', services: {
      'dev.ucp.shopping': [{ transport: 'mcp', endpoint: badUcpEndpoint ? 'https://evil.example/ucp/mcp' : `${new URL(url).origin}/ucp/mcp` }],
    }, capabilities: { 'dev.ucp.shopping.catalog.search': [{}], 'dev.ucp.shopping.catalog.lookup': [{}] } } })
    if (url.endsWith('/ucp/mcp')) {
      const expected = badUcpPrice ? {
        ...ucpProduct,
        price_range: { min: { amount: 1, currency: 'USD' }, max: { amount: 1, currency: 'USD' } },
      } : ucpProduct
      const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vibecart-ucp' } }
        : body.method === 'tools/list' ? { tools: [{ name: 'search_catalog' }, { name: 'lookup_catalog' }, ...(missingUcpTool ? [] : [{ name: 'get_product' }]), { name: 'create_cart' }] }
        : body.params.name === 'search_catalog' ? { structuredContent: searchPages ? searchPages[body.params.arguments.catalog.pagination.cursor ? 1 : 0] : { products: emptyUcpSearch ? [] : [expected], pagination: { has_next_page: false } } }
        : body.params.name === 'lookup_catalog' ? { structuredContent: { products: [expected] } }
        : body.params.name === 'get_product' ? { structuredContent: { product: expected } }
        : { error: 'unexpected UCP tool' }
      return json({ jsonrpc: '2.0', id: body.id, result })
    }
    const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vibecart' } }
      : body.method === 'tools/list' ? { tools: [
        { name: 'vibecart.list_products', annotations }, { name: 'vibecart.get_product', annotations },
        { name: 'vibecart.create_checkout', annotations: { readOnlyHint: false } },
      ] }
      : body.params.name === 'vibecart.list_products' ? { structuredContent: { success: true, products } }
      : { structuredContent: { success: true, product: getProduct } }
    return json({ jsonrpc: '2.0', id: body.id, result })
  }
  return { fetchImpl, calls }
}

test('read-only discovery, generic MCP and UCP transport, and verified variant price', async () => {
  const { fetchImpl, calls } = mockFetch()
  const result = await probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: ID, fetchImpl })
  assert.equal(result.productCount, 1)
  assert.equal(result.expectedProductMatched, true)
  assert.equal(result.independentShopifyPriceMatched, false)
  assert.match(result.note, /NOT independently verified/)
  assert.equal(result.ucpTransportVerified, true)
  assert.deepEqual(calls.map(x => x.body?.method ?? 'GET'), ['GET', 'initialize', 'tools/list', 'initialize', 'tools/list', 'tools/call', 'tools/call'])
  assert.deepEqual(calls.filter(x => x.body?.method === 'tools/call').map(x => x.body.params.name),
    ['vibecart.list_products', 'vibecart.get_product'])
  assert.ok(calls.every(x => x.url.startsWith('https://merchant.example/')))
})

test('without expected Shopify variant, probe does not claim merchant proof or get product', async () => {
  const { fetchImpl, calls } = mockFetch()
  const result = await probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl })
  assert.equal(result.expectedProductMatched, false)
  assert.equal(result.independentShopifyPriceMatched, false)
  assert.match(result.note, /NOT verified/)
  assert.equal(calls.length, 6)
})

test('fails closed on absent expected variant and duplicate catalog identity', async () => {
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: 'gid://shopify/ProductVariant/124', fetchImpl: mockFetch().fetchImpl }), /absent/)
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl: mockFetch({ products: [product, product] }).fetchImpl }), /duplicate/)
})

test('fails closed on unsafe origins, unsafe tool annotations and price mismatch', async () => {
  for (const baseUrl of ['http://merchant.example/', 'https://user:password@merchant.example/', 'https://merchant.example/path']) {
    await assert.rejects(probePublicMcp({ baseUrl, fetchImpl: mockFetch().fetchImpl }), /bare HTTPS origin/)
  }
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl: mockFetch({ annotations: { readOnlyHint: false, destructiveHint: false } }).fetchImpl }), /explicitly read-only/)
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: ID, fetchImpl: mockFetch({ getProduct: { ...product, priceCents: 1 } }).fetchImpl }), /identity and price/)
})

test('refuses HTTP redirects and malformed JSON-RPC responses', async () => {
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://other.example/' } }) }), /HTTP 302/)
  const { fetchImpl } = mockFetch()
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl: async (url, options) => {
    if (url.endsWith('/.well-known/ucp')) return fetchImpl(url, options)
    return json({ jsonrpc: '2.0', id: 99, result: {} })
  } }), /invalid MCP JSON-RPC/)
})

test('refuses advertised cross-origin UCP endpoint without contacting it', async () => {
  const { fetchImpl, calls } = mockFetch({ badUcpEndpoint: true })
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl }), /same-origin/)
  assert.equal(calls.length, 1)
})

test('refuses incomplete UCP transport tool advertisement', async () => {
  const { fetchImpl, calls } = mockFetch({ missingUcpTool: true })
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl }), /lacks required catalog tools/)
  assert.equal(calls.filter(x => x.body?.method === 'tools/call').length, 0)
})

test('independent Shopify price evidence is required for a price-verified pilot', async () => {
  const { fetchImpl, calls } = mockFetch()
  const verified = await probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: ID,
    expectedPriceCents: 6599, fetchImpl })
  assert.equal(verified.expectedProductMatched, true)
  assert.equal(verified.independentShopifyPriceMatched, true)
  assert.match(verified.note, /independently verified USD price/)
  assert.equal(calls.filter(x => x.body?.method === 'tools/call').length, 2)
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: ID,
    expectedPriceCents: 6600, fetchImpl: mockFetch().fetchImpl }), /differs from independently verified Shopify price/)
  await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', expectedPriceCents: 6599,
    fetchImpl: mockFetch().fetchImpl }), /requires an independently verified Shopify variant ID/)
  for (const invalidPrice of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '6599']) {
    await assert.rejects(probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: ID,
      expectedPriceCents: invalidPrice, fetchImpl: mockFetch().fetchImpl }), /non-negative safe integer/)
  }
})

test('negotiated UCP search/lookup/get prove independent Shopify identity and price without writes', async () => {
  const { fetchImpl, calls } = mockFetch()
  const result = await probePublicMcp({
    baseUrl: 'https://merchant.example/', expectedProductId: ID, expectedPriceCents: 6599,
    agentProfileUrl, fetchImpl,
  })
  assert.equal(result.ucpCatalogVerified, true)
  assert.equal(result.independentShopifyPriceMatched, true)
  assert.match(result.note, /UCP search\/lookup\/get/)
  const toolCalls = calls.filter(x => x.body?.method === 'tools/call')
  assert.deepEqual(toolCalls.map(x => x.body.params.name), [
    'search_catalog', 'lookup_catalog', 'get_product', 'vibecart.list_products', 'vibecart.get_product',
  ])
  assert.ok(toolCalls.every(x => READ_ONLY_NAMES.has(x.body.params.name)))
  assert.ok(toolCalls.slice(0, 3).every(x => x.body.params.arguments.meta['ucp-agent'].profile === agentProfileUrl))
})

test('UCP read-only catalog rejects stale price and empty search catalog', async () => {
  await assert.rejects(probePublicMcp({
    baseUrl: 'https://merchant.example/', expectedProductId: ID, expectedPriceCents: 6599,
    agentProfileUrl, fetchImpl: mockFetch({ badUcpPrice: true }).fetchImpl,
  }), /UCP search_catalog expected Shopify variant price/)
  await assert.rejects(probePublicMcp({
    baseUrl: 'https://merchant.example/', expectedProductId: ID, expectedPriceCents: 6599,
    agentProfileUrl, fetchImpl: mockFetch({ emptyUcpSearch: true }).fetchImpl,
  }), /UCP search_catalog did not return/)
})

test('UCP catalog calls require independent Shopify evidence and public profile URL', async () => {
  const { fetchImpl, calls } = mockFetch()
  await assert.rejects(probePublicMcp({
    baseUrl: 'https://merchant.example/', agentProfileUrl, fetchImpl,
  }), /requires independently verified Shopify variant ID and price/)
  for (const unsafe of ['http://agent.example/profile', 'https://user:secret@agent.example/profile',
    'https://localhost/profile', 'https://127.0.0.1/profile', 'https://agent.example/profile?token=x',
    'https://[::1]/profile', 'https://[fd00::1]/profile', 'https://[::ffff:127.0.0.1]/profile',
    'https://172.16.0.1/profile', 'https://100.64.0.1/profile', 'https://169.254.169.254/profile',
    'https://2130706433/profile', 'https://host.internal/profile',
    'https://host.localhost/profile', 'https://host.home.arpa/profile']) {
    await assert.rejects(probePublicMcp({
      baseUrl: 'https://merchant.example/', expectedProductId: ID, expectedPriceCents: 6599,
      agentProfileUrl: unsafe, fetchImpl,
    }), /public HTTPS profile URL/)
  }
  assert.equal(calls.length, 0)
})

test('UCP search must paginate to discover independently verified variant', async () => {
  const other = { ...ucpProduct, id: 'gid://shopify/ProductVariant/999',
    variants: [{ ...ucpProduct.variants[0], id: 'gid://shopify/ProductVariant/999' }] }
  const { fetchImpl, calls } = mockFetch({ searchPages: [
    { products: [other], pagination: { has_next_page: true, cursor: 'next' } },
    { products: [ucpProduct], pagination: { has_next_page: false } },
  ] })
  const result = await probePublicMcp({
    baseUrl: 'https://merchant.example/', expectedProductId: ID, expectedPriceCents: 6599,
    agentProfileUrl, fetchImpl,
  })
  assert.equal(result.ucpCatalogVerified, true)
  assert.equal(calls.filter(x => x.body?.params?.name === 'search_catalog').length, 2)
  assert.equal(calls.some(x => x.body?.params?.name === 'create_cart'), false)
})

test('UCP search refuses false discovery, repeated cursors and wrong price', async () => {
  const other = { ...ucpProduct, id: 'gid://shopify/ProductVariant/999',
    variants: [{ ...ucpProduct.variants[0], id: 'gid://shopify/ProductVariant/999' }] }
  const base = { baseUrl: 'https://merchant.example/', expectedProductId: ID,
    expectedPriceCents: 6599, agentProfileUrl }
  await assert.rejects(probePublicMcp({ ...base, fetchImpl: mockFetch({ searchPages: [
    { products: [other], pagination: { has_next_page: false } },
  ] }).fetchImpl }), /did not discover expected Shopify variant/)
  await assert.rejects(probePublicMcp({ ...base, fetchImpl: mockFetch({ searchPages: [
    { products: [other], pagination: { has_next_page: true, cursor: 'next' } },
    { products: [ucpProduct], pagination: { has_next_page: true, cursor: 'next' } },
  ] }).fetchImpl }), /cursor missing or repeated/)
  await assert.rejects(probePublicMcp({ ...base, fetchImpl: mockFetch({ badUcpPrice: true }).fetchImpl }),
    /search_catalog expected Shopify variant price/)
})

test('protected Preview read-only probe sends short-lived OIDC only to the explicitly approved host', async () => {
  const approvedPreviewHost = 'vibecart-git-agent-radiantz-promptmeter.vercel.app'
  const { fetchImpl, calls } = mockFetch()
  const result = await probePublicMcp({
    baseUrl: `https://${approvedPreviewHost}/`, expectedProductId: ID,
    expectedPriceCents: 6599, previewOidcToken: 'synthetic-test-token',
    approvedPreviewHost, fetchImpl,
  })
  assert.equal(result.independentShopifyPriceMatched, true)
  assert.ok(calls.length > 0)
  assert.ok(calls.every(call => call.url.startsWith(`https://${approvedPreviewHost}/`)))
  assert.ok(calls.every(call => call.headers['x-vercel-trusted-oidc-idp-token'] === 'synthetic-test-token'))
  assert.ok(calls.every(call => call.redirect === 'manual'))
  assert.ok(calls.every(call => !call.body?.params?.name || READ_ONLY_NAMES.has(call.body.params.name)))
})

test('protected Preview OIDC rejects production, unapproved and missing-token destinations before network', async () => {
  const approvedPreviewHost = 'vibecart-git-agent-radiantz-promptmeter.vercel.app'
  const { fetchImpl, calls } = mockFetch()
  for (const options of [
    { baseUrl: 'https://vibecart.vercel.app/', previewOidcToken: 'dummy', approvedPreviewHost: 'vibecart.vercel.app' },
    { baseUrl: 'https://evil.example/', previewOidcToken: 'dummy', approvedPreviewHost: 'evil.example' },
    { baseUrl: 'https://other-preview.vercel.app/', previewOidcToken: 'dummy', approvedPreviewHost },
    { baseUrl: `https://${approvedPreviewHost}/`, previewOidcToken: '', approvedPreviewHost },
    { baseUrl: `https://${approvedPreviewHost}/`, approvedPreviewHost },
    { baseUrl: `https://${approvedPreviewHost}:8443/`, previewOidcToken: 'dummy', approvedPreviewHost },
  ]) {
    await assert.rejects(probePublicMcp({ ...options, fetchImpl }), /Preview OIDC/)
  }
  assert.equal(calls.length, 0)
})

test('ordinary public probe never forwards OIDC credentials', async () => {
  const { fetchImpl, calls } = mockFetch()
  await probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl })
  assert.ok(calls.length > 0)
  assert.ok(calls.every(call => !('x-vercel-trusted-oidc-idp-token' in call.headers)))
})
