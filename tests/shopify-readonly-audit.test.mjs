import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditShopifyCatalogReadOnly,
  createReadOnlyShopifyTransport,
} from '../scripts/audit-shopify-catalog-readonly.mjs'

const READ = 'query VibeCartProducts { shop { currencyCode } }'
const COUNT = 'query VibeCartProductsCount { productsCount(limit: null) { count precision } }'
const DOCS = new Set([READ, COUNT, 'query VibeCartProductVariants { shop { id } }', 'query VibeCartShopCurrency { shop { currencyCode } }'])
const opts = { shopDomain: 'synthetic-shop.myshopify.com', token: 'synthetic-private-token', allowedDocuments: DOCS }
const json = value => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' },
})

test('read-only transport uses exact Shopify host, POST, no redirects and only allowlisted queries', async () => {
  const calls = []
  const execute = createReadOnlyShopifyTransport({
    ...opts,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return json({ data: { shop: { currencyCode: 'USD' } } })
    },
  })
  assert.deepEqual(await execute(READ, { cursor: null }), { data: { shop: { currencyCode: 'USD' } } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://synthetic-shop.myshopify.com/admin/api/2026-10/graphql.json')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(calls[0].options.headers['x-shopify-access-token'], opts.token)
  assert.equal(JSON.parse(calls[0].options.body).query, READ)
  await assert.rejects(execute('mutation { productDelete(id: "x") { deletedProductId } }', {}), /unapproved/)
  assert.equal(calls.length, 1, 'rejected mutation must not make a network request')
})

test('read-only transport refuses unsafe hosts, missing tokens and excessive requests', async () => {
  for (const shopDomain of ['radiantz.com', 'evil.myshopify.com.attacker.test', 'localhost',
    'https://synthetic-shop.myshopify.com', 'synthetic-shop.myshopify.com:443']) {
    assert.throws(() => createReadOnlyShopifyTransport({ ...opts, shopDomain }), /exact .*myshopify.com/)
  }
  assert.throws(() => createReadOnlyShopifyTransport({ ...opts, token: '' }), /private read-only Admin token/)
  assert.throws(() => createReadOnlyShopifyTransport({ ...opts, apiVersion: 'unstable' }), /pinned quarterly/)
  assert.throws(() => createReadOnlyShopifyTransport({ ...opts, maxRequests: 10000 }), /request limit/)
  let calls = 0
  const execute = createReadOnlyShopifyTransport({
    ...opts, maxRequests: 1, fetchImpl: async () => { calls++; return json({ data: {} }) },
  })
  await execute(READ, {})
  await assert.rejects(execute(READ, {}), /request limit reached/)
  assert.equal(calls, 1)
})

test('read-only transport refuses HTTP redirects and malformed responses without echoing token', async () => {
  for (const response of [
    new Response('', { status: 302, headers: { location: 'https://attacker.test/' } }),
    new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }),
  ]) {
    const execute = createReadOnlyShopifyTransport({ ...opts, fetchImpl: async () => response })
    await assert.rejects(execute(READ, {}), error => {
      assert.equal(error.message.includes(opts.token), false)
      return /Shopify audit/.test(error.message)
    })
  }
})

test('read-only audit traverses a real adapter contract and returns aggregates, never raw catalog records', async () => {
  const calls = []
  const execute = async (document, variables) => {
    calls.push({ document, variables })
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: { nodes: [{
        id: 'gid://shopify/Product/100', title: 'SYNTHETIC test light',
        description: 'Synthetic only', status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
        featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
        variantsCount: { count: 1, precision: 'EXACT' },
        variants: { nodes: [{
          id: 'gid://shopify/ProductVariant/101', title: 'Red',
          sku: 'SYN-101', price: '65.99', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
        }], pageInfo: { hasNextPage: false, endCursor: null } },
      }], pageInfo: { hasNextPage: false, endCursor: null } } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.deepEqual({
    verified: result.verified, traversalVerified: result.traversalVerified, catalogReady: result.catalogReady, readOnly: result.readOnly, currency: result.currency,
    productPages: result.productPages, publishedProductFamilies: result.publishedProductFamilies,
    catalogVariants: result.catalogVariants, skippedRecords: result.skippedRecords,
  }, {
    verified: true, traversalVerified: true, catalogReady: true, readOnly: true, currency: 'USD',
    productPages: 1, publishedProductFamilies: 1, catalogVariants: 1, skippedRecords: 0,
  })
  assert.equal(calls.length, 3)
  assert.ok(calls.every(c => c.document.trim().startsWith('query ')))
  assert.doesNotMatch(JSON.stringify(result), /SYN-101|SYNTHETIC test light|65\.99|ProductVariant/)
  assert.match(result.note, /MCP\/UCP.*NOT verified/)
})

test('read-only audit fails on currency mismatch or independently incomplete Shopify product count', async () => {
  const currency = async document => {
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    if (document.includes('VibeCartProductsCount')) return { data: { productsCount: { count: 2, precision: 'EXACT' } } }
    return { data: { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
  }
  await assert.rejects(auditShopifyCatalogReadOnly({ execute: currency, expectedCurrencyCode: 'EUR' }), /does not match/)
  await assert.rejects(auditShopifyCatalogReadOnly({ execute: currency, expectedCurrencyCode: 'USD' }), /incomplete/)
})

test('read-only audit does not certify catalog completeness when Shopify records are omitted', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/100', title: 'UNPUBLISHED SYNTHETIC',
          status: 'ACTIVE', publishedAt: null,
          variantsCount: { count: 1, precision: 'EXACT' },
          variants: { nodes: [{
            id: 'gid://shopify/ProductVariant/101', title: 'Red',
            sku: 'PRIVATE-SYN-101', price: '19.99',
            inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
          }], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({
    execute, expectedCurrencyCode: 'USD',
  })
  assert.equal(result.traversalVerified, true, 'exact Shopify traversal succeeded')
  assert.equal(result.catalogReady, false, 'an omitted family must fail catalog acceptance')
  assert.equal(result.verified, false, 'do not claim a fully verified usable catalog')
  assert.equal(result.publishedProductFamilies, 0)
  assert.equal(result.catalogVariants, 0)
  assert.ok(result.skippedRecords > 0)
  assert.match(result.note, /complete VibeCart catalog NOT verified/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SYN-101|UNPUBLISHED SYNTHETIC/)
})


test('read-only audit flags missing Shopify images without exposing private catalog details', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/300', title: 'SYNTHETIC IMAGELESS LIGHT',
          description: 'Synthetic only', status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
          featuredMedia: null, media: { nodes: [] },
          variantsCount: { count: 1, precision: 'EXACT' },
          variants: { nodes: [{
            id: 'gid://shopify/ProductVariant/301', title: 'Red',
            sku: 'PRIVATE-IMAGELESS-SKU', price: '44.99',
            inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
          }], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.equal(result.traversalVerified, true)
  assert.equal(result.publishedProductFamilies, 1)
  assert.equal(result.catalogVariants, 1)
  assert.equal(result.skippedRecords, 0)
  assert.equal(result.warnings, 0)
  assert.equal(result.missingImages, 1)
  assert.equal(result.catalogReady, false)
  assert.equal(result.verified, false)
  assert.match(result.note, /missing images/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-IMAGELESS-SKU|SYNTHETIC IMAGELESS LIGHT|44\\.99|ProductVariant/)
})
