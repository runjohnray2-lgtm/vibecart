import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'
import { auditShopifyCatalogReadOnly } from '../scripts/audit-shopify-catalog-readonly.mjs'

// Synthetic *shape* only: 44 families / 970 variants, including 39 ACTIVE
// families / 921 variants and four >100-variant families. No merchant data,
// identifiers, pricing, inventory observations or credentials are copied.
const sizes = [150, 225, 189, 174, ...Array(33).fill(5), 9, 9, ...Array(4).fill(10), 9]
assert.equal(sizes.length, 44)
assert.equal(sizes.reduce((sum, n) => sum + n, 0), 970)
assert.equal(sizes.slice(0, 39).reduce((sum, n) => sum + n, 0), 921)

const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
  'lib/shopify-admin-graphql.ts',
])
const { createShopifyAdminCatalogSource } = modules['shopify-admin-graphql']
const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex } = modules['shopify-catalog-sync']

const id = index => 6001 + index
const productGid = index => 'gid://shopify/Product/' + id(index)
const variantGid = (index, n) => 'gid://shopify/ProductVariant/' + (id(index) * 1000 + n)
const variant = (index, n) => ({
  id: variantGid(index, n),
  title: 'Synthetic option ' + n,
  sku: 'SYN-' + id(index) + '-' + n,
  price: n % 2 ? '12.34' : '56.78',
  inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY',
  inventoryQuantity: 0,
})
const connection = (index, start) => {
  const end = Math.min(start + 99, sizes[index])
  return {
    nodes: Array.from({ length: end - start + 1 }, (_, offset) => variant(index, start + offset)),
    pageInfo: { hasNextPage: end < sizes[index], endCursor: end < sizes[index] ? 'v-' + index + '-' + end : null },
  }
}
const product = index => ({
  id: productGid(index),
  title: 'SYNTHETIC family ' + index,
  description: 'Synthetic catalog contract fixture',
  status: index < 39 ? 'ACTIVE' : 'DRAFT',
  publishedAt: index < 39 ? '2026-10-01T00:00:00Z' : null,
  updatedAt: '2026-10-25T00:00:00Z',
  featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic-fixture.jpg' } } },
  variantsCount: { count: sizes[index], precision: 'EXACT' },
  variants: connection(index, 1),
})

function fakeShopify() {
  const calls = []
  const execute = async (document, variables = {}) => {
    calls.push({ document, variables })
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 44, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      assert.match(document, /products\(first: 5,/)
      const start = variables.cursor === null ? 0 : Number(/^p-(\d+)$/.exec(variables.cursor)?.[1])
      assert.ok(Number.isSafeInteger(start) && start >= 0 && start < 44 && start % 5 === 0)
      const end = Math.min(start + 5, 44)
      return { data: { products: {
        nodes: Array.from({ length: end - start }, (_, offset) => product(start + offset)),
        pageInfo: { hasNextPage: end < 44, endCursor: end < 44 ? 'p-' + end : null },
      } } }
    }
    if (document.includes('VibeCartProductVariants(')) {
      const cursor = /^v-(\d+)-(100|200)$/.exec(variables.cursor)
      assert.ok(cursor, 'only the five expected >100-variant continuations are permitted')
      const index = Number(cursor[1])
      const start = Number(cursor[2]) + 1
      assert.ok(index >= 0 && index < 4)
      assert.equal(variables.productId, productGid(index))
      return { data: { product: {
        id: productGid(index),
        updatedAt: '2026-10-25T00:00:00Z',
        variantsCount: { count: sizes[index], precision: 'EXACT' },
        variants: connection(index, start),
      } } }
    }
    throw new Error('unexpected synthetic Shopify operation')
  }
  return { execute, calls }
}

test('complete synthetic 44-family / 970-variant read-only audit preserves published and draft counts', async () => {
  const { execute, calls } = fakeShopify()
  const report = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD', modules })
  assert.equal(report.traversalVerified, true)
  assert.equal(report.catalogReady, true)
  assert.equal(report.sellabilityVerified, false)
  assert.equal(report.productPages, 9)
  assert.equal(report.publishedProductFamilies, 39)
  assert.equal(report.catalogVariants, 921)
  assert.equal(report.observedShopifyVariants, 970)
  assert.equal(report.excludedUnpublished, 5)
  assert.equal(report.invalidSkippedRecords, 0)
  assert.equal(report.zeroStockDenyVariants + report.zeroStockContinueVariants, 970)
  assert.equal(calls.filter(call => call.document.includes('VibeCartProducts(')).length, 9)
  assert.equal(calls.filter(call => call.document.includes('VibeCartProductVariants(')).length, 5)
  assert.equal(calls.filter(call => call.document.includes('VibeCartProductsCount')).length, 2)
  assert.equal(calls.filter(call => call.document.includes('shop { currencyCode }')).length, 2)
  assert.ok(calls.every(call => /^query\b/.test(call.document.trim())))
  assert.doesNotMatch(JSON.stringify(report), /SYN-|ProductVariant|12\.34|56\.78/)
})

test('full synthetic pilot shape retains exact published variant IDs, cents, SKU and DENY/CONTINUE policy', async () => {
  const { execute, calls } = fakeShopify()
  const source = createShopifyAdminCatalogSource(execute)
  const result = await syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', fetchPage: source.fetchPage,
  })
  assert.equal(result.pages, 9)
  assert.equal(result.snapshot.products.size, 39)
  assert.equal(result.skipped.length, 5)
  assert.equal(result.warnings.length, 0)
  const feed = toCatalogFeed(result.snapshot)
  const index = buildVariantIndex(result.snapshot)
  assert.equal(feed.products.length, 921)
  assert.equal(index.size, 921)
  const byId = new Map(feed.products.map(entry => [entry.id, entry]))
  for (let family = 0; family < 44; family++) {
    for (const n of [1, sizes[family]]) {
      const variantId = variantGid(family, n)
      if (family >= 39) {
        assert.equal(byId.has(variantId), false, 'draft variants must not appear in the public feed')
        continue
      }
      assert.equal(byId.get(variantId)?.priceCents, n % 2 ? 1234 : 5678)
      assert.deepEqual(index.get(variantId), {
        productId: productGid(family),
        variantId,
        sku: 'SYN-' + id(family) + '-' + n,
        inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY',
      })
    }
  }
  assert.equal(calls.filter(call => call.document.includes('VibeCartProducts(')).length, 9)
  assert.equal(calls.filter(call => call.document.includes('VibeCartProductVariants(')).length, 5)
  assert.equal(calls.filter(call => call.document.includes('VibeCartProductsCount')).length, 2)
  assert.doesNotMatch(JSON.stringify(feed), /inventoryPolicy|inventoryQuantity|SYN-/)
})
