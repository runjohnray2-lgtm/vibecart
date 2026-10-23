import assert from 'node:assert/strict'
import test from 'node:test'
import { probePublicMcp } from '../scripts/probe-public-mcp.mjs'

const ID = 'gid://shopify/ProductVariant/123'
const product = { id: ID, name: 'Synthetic light', priceCents: 6599 }
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
function mockFetch({ products = [product], annotations = { readOnlyHint: true, destructiveHint: false }, getProduct = product } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    if (options.signal.aborted) throw new Error('unexpected abort')
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, method: options.method, body })
    if (url.endsWith('/.well-known/ucp')) return json({ ucp: { version: '2026-04-08', capabilities: {
      'dev.ucp.shopping.catalog.search': [{}], 'dev.ucp.shopping.catalog.lookup': [{}],
    } } })
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

test('read-only discovery, initialize, list and get preserve verified variant price', async () => {
  const { fetchImpl, calls } = mockFetch()
  const result = await probePublicMcp({ baseUrl: 'https://merchant.example/', expectedProductId: ID, fetchImpl })
  assert.equal(result.productCount, 1)
  assert.equal(result.expectedProductMatched, true)
  assert.deepEqual(calls.map(x => x.body?.method ?? 'GET'), ['GET', 'initialize', 'tools/list', 'tools/call', 'tools/call'])
  assert.deepEqual(calls.filter(x => x.body?.method === 'tools/call').map(x => x.body.params.name),
    ['vibecart.list_products', 'vibecart.get_product'])
  assert.ok(calls.every(x => x.url.startsWith('https://merchant.example/')))
})

test('without expected Shopify variant, probe does not claim merchant proof or get product', async () => {
  const { fetchImpl, calls } = mockFetch()
  const result = await probePublicMcp({ baseUrl: 'https://merchant.example/', fetchImpl })
  assert.equal(result.expectedProductMatched, false)
  assert.match(result.note, /NOT verified/)
  assert.equal(calls.length, 4)
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
