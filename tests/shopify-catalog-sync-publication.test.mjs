import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct, page1 } from './fixtures/shopify-sync-pages.mjs'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts'])
const { applyProducts, createSnapshot, toCatalogFeed } = modules['shopify-catalog-sync']

const mystery = () => gqlProduct(6, 'Mystery', [[61, 'One', 'M-1', '3.00']], { publishedAt: undefined })

test('a product without publication evidence is not exposed', () => {
  const result = applyProducts(createSnapshot('USD'), [mystery()])
  assert.equal(result.upserted, 0)
  assert.match(result.skipped[0].reason, /publication status unknown/)
  assert.equal(result.skipped[0].productId, 'gid://shopify/Product/6')
  assert.equal(toCatalogFeed(result.snapshot).products.length, 0)
})

test('losing publication evidence removes a previously synced product', () => {
  const synced = applyProducts(createSnapshot('USD'), page1.products)
  assert.equal(toCatalogFeed(synced.snapshot).products.length, 3)
  const next = applyProducts(synced.snapshot, [
    gqlProduct(2, 'Beta', [[21, 'Default Title', 'B-1', '5.00']], { publishedAt: undefined }),
  ])
  assert.equal(next.removed, 1)
  assert.equal(toCatalogFeed(next.snapshot).products.some(p => p.id === 'gid://shopify/ProductVariant/21'), false)
  assert.equal(toCatalogFeed(synced.snapshot).products.length, 3, 'input snapshot must not be mutated')
})

test('includeUnpublished cannot bypass publication verification in public snapshots', () => {
  const base = createSnapshot('USD')
  assert.throws(
    () => applyProducts(base, [mystery()], { includeUnpublished: true }),
    /includeUnpublished is not permitted for public catalog snapshots/,
  )
  assert.equal(toCatalogFeed(base).products.length, 0)
})

test('explicit null publishedAt still reports not published', () => {
  const result = applyProducts(createSnapshot('USD'), [
    gqlProduct(7, 'Hidden', [[71, 'One', 'H-1', '3.00']], { publishedAt: null }),
  ])
  assert.equal(result.upserted, 0)
  assert.match(result.skipped[0].reason, /not published/)
})
