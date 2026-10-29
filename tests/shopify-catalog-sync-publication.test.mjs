import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct, page1 } from './fixtures/shopify-sync-pages.mjs'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts'])
const { applyProducts, createSnapshot, syncShopifyCatalog, toCatalogFeed } = modules['shopify-catalog-sync']

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

test('invalid publication timestamps evict stale variants and cannot be exposed by direct sync', async () => {
  const original = gqlProduct(8, 'SYNTHETIC published', [[81, 'One', 'P-1', '3.00']])
  const base = applyProducts(createSnapshot('USD'), [original]).snapshot
  const before = toCatalogFeed(base)
  assert.equal(before.products.length, 1)
  const invalid = [undefined, '', 'yesterday', 0, '2026-02-30T00:00:00Z', '2026-10-01', '2026-10-01T00:00:00']
  for (const publishedAt of invalid) {
    const changed = { ...original, publishedAt }
    const result = applyProducts(base, [changed])
    assert.equal(result.upserted, 0)
    assert.equal(result.removed, 1)
    assert.match(result.skipped[0].reason, /publication status unknown/)
    assert.deepEqual(toCatalogFeed(result.snapshot).products, [])
  }
  const synced = await syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', base,
    fetchPage: async () => ({
      products: [{ ...original, publishedAt: 'not-a-date' }],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
  })
  assert.deepEqual(toCatalogFeed(synced.snapshot).products, [])
  assert.deepEqual(toCatalogFeed(base), before, 'last known-good snapshot remains unchanged')
})

test('valid ISO publication timestamps with offsets and REST naming remain accepted', () => {
  const original = gqlProduct(9, 'SYNTHETIC published', [[91, 'One', 'P-2', '3.00']])
  for (const fields of [
    { publishedAt: '2026-10-01T00:00:00-07:00' },
    { publishedAt: undefined, published_at: '2024-02-29T12:30:59.123Z' },
  ]) {
    const result = applyProducts(createSnapshot('USD'), [{ ...original, ...fields }])
    assert.equal(result.upserted, 1)
    assert.equal(result.skipped.length, 0)
    assert.equal(toCatalogFeed(result.snapshot).products.length, 1)
  }
})
