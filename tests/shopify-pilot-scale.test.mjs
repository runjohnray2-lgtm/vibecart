import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// Synthetic scale contract, NOT a claim about the live Radiantz catalog.
// Exercise the real offline Admin adapter -> pagination -> sync -> feed/index
// path without network access, credentials, database access or payments.
const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
  'lib/shopify-admin-graphql.ts',
])
const { createShopifyAdminCatalogSource } = modules['shopify-admin-graphql']
const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex } = modules['shopify-catalog-sync']

const P = id => 'gid://shopify/Product/' + id
const V = id => 'gid://shopify/ProductVariant/' + id
const updatedAt = '2026-10-25T00:00:00Z'

// Four >100-variant families plus forty smaller families:
// 225 + 189 + 174 + 150 + (32 * 6) + (8 * 5) = 970 variants.
const counts = [225, 189, 174, 150, ...Array(32).fill(6), ...Array(8).fill(5)]
const families = counts.map((count, i) => {
  const id = P(10001 + i)
  const variants = Array.from({ length: count }, (_, j) => ({
    id: V(1000000 + i * 1000 + j + 1),
    title: 'Option ' + (j + 1),
    sku: i === 0 && j === 0 ? '  SYN-0-0  ' : 'SYN-' + i + '-' + j,
    price: j % 2 === 0 ? '65.99' : '70.00',
    inventoryPolicy: j % 2 === 0 ? 'CONTINUE' : 'DENY',
    inventoryQuantity: 0,
  }))
  const image = 'https://cdn.example.test/synthetic-' + i + '.jpg'
  return {
    id, variants,
    firstPage: {
      id, title: 'SYNTHETIC product ' + i, description: 'Synthetic fixture only',
      status: 'ACTIVE', publishedAt: updatedAt, updatedAt,
      featuredMedia: { preview: { image: { url: image } } },
      media: { nodes: [{ id: 'gid://shopify/MediaImage/' + (20001 + i),
        preview: { image: { url: image } } }],
        pageInfo: { hasNextPage: false, endCursor: null } },
      variantsCount: { count, precision: 'EXACT' },
      variants: {
        nodes: variants.slice(0, 100),
        pageInfo: { hasNextPage: count > 100,
          endCursor: count > 100 ? 'v:' + i + ':100' : null },
      },
    },
  }
})

test('44-product/970-variant synthetic Admin walk preserves exact prices, SKUs and zero-stock policies', async () => {
  assert.equal(families.length, 44)
  assert.equal(counts.reduce((sum, n) => sum + n, 0), 970)
  const calls = { count: 0, products: 0, variants: 0, media: 0, currency: 0 }
  const execute = async (document, variables) => {
    assert.match(document.trim(), /^query\b/)
    assert.doesNotMatch(document, /\bmutation\b|orderCreate|checkoutCreate/i)
    if (document.includes('VibeCartProductsCount')) {
      calls.count++
      return { data: { productsCount: { count: 44, precision: 'EXACT' } } }
    }
    if (document.includes('shop { currencyCode }')) {
      calls.currency++
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      calls.products++
      assert.match(document, /products\(first: 5, after: \$cursor, query: \$query, sortKey: ID\)/)
      assert.equal(variables.query, null)
      const offset = variables.cursor === null ? 0 : Number(/^p:(\d+)$/.exec(variables.cursor)?.[1])
      assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset < 44)
      const end = Math.min(offset + 5, 44)
      return { data: { products: {
        nodes: families.slice(offset, end).map(f => f.firstPage),
        pageInfo: { hasNextPage: end < 44, endCursor: end < 44 ? 'p:' + end : null },
      } } }
    }
    if (document.includes('VibeCartProductVariants(')) {
      calls.variants++
      const match = /^v:(\d+):(\d+)$/.exec(variables.cursor)
      assert.ok(match, 'variant cursor must be from a prior page')
      const i = Number(match[1])
      const offset = Number(match[2])
      const family = families[i]
      assert.ok(family)
      assert.equal(variables.productId, family.id)
      assert.ok(offset >= 100 && offset < family.variants.length)
      const end = Math.min(offset + 100, family.variants.length)
      return { data: { product: {
        id: family.id, updatedAt, variantsCount: { count: family.variants.length, precision: 'EXACT' },
        variants: {
          nodes: family.variants.slice(offset, end),
          pageInfo: { hasNextPage: end < family.variants.length,
            endCursor: end < family.variants.length ? 'v:' + i + ':' + end : null },
        },
      } } }
    }
    if (document.includes('VibeCartProductMedia(')) {
      calls.media++
      throw new Error('all synthetic products have a verified first-page image')
    }
    throw new Error('unexpected Shopify GraphQL document')
  }

  const source = createShopifyAdminCatalogSource(execute)
  assert.equal(await source.fetchShopCurrency(), 'USD')
  const result = await syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', fetchPage: source.fetchPage,
  })
  assert.equal(result.pages, 9)
  assert.equal(result.upserted, 44)
  assert.equal(result.removed, 0)
  assert.deepEqual(result.skipped, [])
  assert.equal(result.snapshot.products.size, 44)

  const feed = toCatalogFeed(result.snapshot).products
  const index = buildVariantIndex(result.snapshot)
  assert.equal(feed.length, 970)
  assert.equal(index.size, 970)
  let continueCount = 0
  let denyCount = 0
  for (const family of families) {
    for (const raw of family.variants) {
      const product = feed.find(p => p.id === raw.id)
      assert.ok(product, 'every Shopify variant must appear in the feed: ' + raw.id)
      assert.equal(product.priceCents, raw.price === '65.99' ? 6599 : 7000)
      assert.match(product.image, /^https:\/\/cdn\.example\.test\//)
      const ref = index.get(raw.id)
      assert.deepEqual(ref, {
        productId: family.id, variantId: raw.id, sku: raw.sku,
        inventoryPolicy: raw.inventoryPolicy, inventoryQuantity: 0,
      })
      if (raw.inventoryPolicy === 'CONTINUE') continueCount++
      else denyCount++
    }
  }
  assert.equal(index.get(families[0].variants[0].id).sku, '  SYN-0-0  ')
  assert.ok(continueCount > 0 && denyCount > 0,
    'both zero-stock policies must survive catalog mapping without claiming checkout eligibility')
  assert.deepEqual(calls, { count: 2, products: 9, variants: 5, media: 0, currency: 1 })
})
