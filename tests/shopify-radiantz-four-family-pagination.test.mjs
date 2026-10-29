import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// Synthetic stress case based only on the historical sizes of Radiantz's four
// >100-variant families (150, 225, 189, 174). No merchant IDs/data/credentials.
const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
  'lib/shopify-admin-graphql.ts',
])
const { createShopifyAdminCatalogSource } = modules['shopify-admin-graphql']
const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex } = modules['shopify-catalog-sync']

const sizes = new Map([[9001, 150], [9002, 225], [9003, 189], [9004, 174]])
const productGid = n => 'gid://shopify/Product/' + n
const variantGid = (p, n) => 'gid://shopify/ProductVariant/' + (p * 1000 + n)
const variant = (p, n) => ({
  id: variantGid(p, n),
  title: 'Synthetic option ' + n,
  sku: 'SYN-' + p + '-' + n,
  price: n % 2 ? '65.99' : '70.00',
  inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY',
  inventoryQuantity: 0,
})
const variantConnection = (p, start, end) => ({
  nodes: Array.from({ length: end - start + 1 }, (_, i) => variant(p, start + i)),
  pageInfo: {
    hasNextPage: end < sizes.get(p),
    endCursor: end < sizes.get(p) ? 'v-' + p + '-' + end : null,
  },
})
const product = p => ({
  id: productGid(p),
  title: 'SYNTHETIC Radiantz-like family ' + p,
  description: 'Synthetic fixture only',
  status: 'ACTIVE',
  publishedAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
  variantsCount: { count: sizes.get(p), precision: 'EXACT' },
  variants: variantConnection(p, 1, 100),
})

test('four large Radiantz-like families hydrate across product and variant cursors without omission', async () => {
  const operations = []
  const execute = async (document, variables) => {
    operations.push({ document, variables })
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 4, precision: 'EXACT' } } }
    }
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      assert.match(document, /products\(first: 5,/)
      assert.match(document, /media\(first: 5\)/)
      assert.doesNotMatch(document, /\bimages\s*\(/)
      const ids = variables.cursor === null ? [9001, 9002]
        : variables.cursor === 'p-second' ? [9003, 9004] : null
      assert.ok(ids, 'only the expected product continuation cursor is accepted')
      return { data: { products: {
        nodes: ids.map(product),
        pageInfo: {
          hasNextPage: variables.cursor === null,
          endCursor: variables.cursor === null ? 'p-second' : null,
        },
      } } }
    }
    if (document.includes('VibeCartProductVariants(')) {
      assert.match(document, /variants\(first: 100,/)
      const match = /^v-(900[1-4])-(100|200)$/.exec(variables.cursor)
      assert.ok(match, 'only a valid synthetic variant cursor is accepted')
      const p = Number(match[1])
      const start = Number(match[2]) + 1
      assert.equal(variables.productId, productGid(p))
      return { data: { product: {
        id: productGid(p), updatedAt: '2026-10-25T00:00:00Z',
        variantsCount: { count: sizes.get(p), precision: 'EXACT' },
        variants: variantConnection(p, start, Math.min(start + 99, sizes.get(p))),
      } } }
    }
    throw new Error('unexpected operation')
  }

  const source = createShopifyAdminCatalogSource(execute)
  assert.equal(await source.fetchShopCurrency(), 'USD')
  const result = await syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD',
    fetchPage: source.fetchPage,
  })
  assert.equal(result.pages, 2)
  assert.equal(result.snapshot.products.size, 4)
  assert.equal(result.skipped.length, 0)
  assert.equal(result.warnings.length, 0)

  const feed = toCatalogFeed(result.snapshot)
  const index = buildVariantIndex(result.snapshot)
  assert.equal(feed.products.length, 738)
  assert.equal(index.size, 738)
  for (const [p, size] of sizes) {
    assert.equal(result.snapshot.products.get(String(p)).length, size)
    for (const n of [1, 100, 101, size]) {
      const id = variantGid(p, n)
      const entry = feed.products.find(item => item.id === id)
      assert.ok(entry, 'missing synthetic variant ' + p + '/' + n)
      assert.equal(entry.priceCents, n % 2 ? 6599 : 7000)
      assert.deepEqual(index.get(id), {
        productId: productGid(p),
        variantId: id,
        sku: 'SYN-' + p + '-' + n,
        inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY',
        inventoryQuantity: 0,
      })
    }
  }
  assert.equal(operations.filter(op => op.document.includes('VibeCartProducts(')).length, 2)
  assert.equal(operations.filter(op => op.document.includes('VibeCartProductVariants(')).length, 5)
  assert.ok(operations.every(op => /^query\b/.test(op.document.trim())))
  assert.doesNotMatch(JSON.stringify(feed), /inventoryPolicy|inventoryQuantity|SYN-/)
})
