import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct } from './fixtures/shopify-sync-pages.mjs'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// Synthetic only: Radiantz's real read-only Admin response exposed zero-stock
// DENY variants with inventoryItem.tracked=false and availableForSale=true.
const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts', 'lib/shopify-variant-pages.ts'])
const { applyProducts, buildVariantIndex, createSnapshot, toCatalogFeed, SHOPIFY_PRODUCTS_QUERY } = modules['shopify-catalog-sync']
const { SHOPIFY_VARIANTS_QUERY } = modules['shopify-variant-pages']
const V = id => 'gid://shopify/ProductVariant/' + id

test('zero DENY with disabled tracking preserves live-shaped Shopify evidence without public sellability claims', () => {
  const raw = gqlProduct(811, 'SYNTHETIC tracking', [
    [8111, 'Untracked zero', 'SYN-8111', '21.99'],
    [8112, 'Tracked zero', 'SYN-8112', '21.99'],
    [8113, 'Tracking unknown', 'SYN-8113', '21.99'],
    [8114, 'Legacy fields absent', 'SYN-8114', '21.99'],
  ])
  Object.assign(raw.variants.nodes[0], { inventoryPolicy: 'DENY', inventoryQuantity: 0, inventoryItem: { tracked: false }, availableForSale: true })
  Object.assign(raw.variants.nodes[1], { inventoryPolicy: 'DENY', inventoryQuantity: 0, inventoryItem: { tracked: true }, availableForSale: false })
  Object.assign(raw.variants.nodes[2], { inventoryPolicy: 'CONTINUE', inventoryQuantity: 0, inventoryItem: null, availableForSale: true })
  const result = applyProducts(createSnapshot('USD'), [raw])
  assert.equal(result.skipped.length, 0)
  const index = buildVariantIndex(result.snapshot)
  assert.deepEqual([index.get(V(8111)).inventoryTracked, index.get(V(8111)).availableForSale, index.get(V(8111)).inventoryQuantity, index.get(V(8111)).inventoryPolicy], [false, true, 0, 'DENY'])
  assert.deepEqual([index.get(V(8112)).inventoryTracked, index.get(V(8112)).availableForSale], [true, false])
  assert.deepEqual([index.get(V(8113)).inventoryTracked, index.get(V(8113)).availableForSale], [null, true])
  assert.equal('inventoryTracked' in index.get(V(8114)), false)
  assert.equal('availableForSale' in index.get(V(8114)), false)
  assert.equal(toCatalogFeed(result.snapshot).products.length, 4)
  assert.doesNotMatch(JSON.stringify(toCatalogFeed(result.snapshot)), /inventoryTracked|availableForSale|inventoryQuantity|inventoryPolicy/)
})

test('malformed Shopify tracking/availability rejects a variant family and restored server index', () => {
  for (const [patch, reason] of [
    [{ availableForSale: 'true' }, /availableForSale must be a boolean/],
    [{ availableForSale: null }, /availableForSale must be a boolean/],
    [{ inventoryItem: { tracked: 'false' } }, /inventoryItem.tracked must be a boolean/],
    [{ inventoryItem: {} }, /inventoryItem.tracked must be a boolean/],
    [{ inventoryItem: [] }, /inventoryItem.tracked must be a boolean/],
  ]) {
    const raw = gqlProduct(812, 'SYNTHETIC invalid tracking', [[8121, 'Option', 'SYN-8121', '9.99']])
    Object.assign(raw.variants.nodes[0], patch)
    const result = applyProducts(createSnapshot('USD'), [raw])
    assert.equal(result.snapshot.products.size, 0)
    assert.match(result.skipped.map(item => item.reason).join('; '), reason)
  }
  const valid = gqlProduct(813, 'SYNTHETIC restored tracking', [[8131, 'Option', 'SYN-8131', '9.99']])
  Object.assign(valid.variants.nodes[0], { inventoryItem: { tracked: false }, availableForSale: true })
  const trusted = applyProducts(createSnapshot('USD'), [valid]).snapshot
  const [[key, products]] = [...trusted.products]
  for (const [field, invalid] of [['inventoryTracked', 'false'], ['availableForSale', 'true']]) {
    const corrupted = { ...trusted, products: new Map([[key, products.map(p => ({
      ...p, shopify: { ...p.shopify, [field]: invalid },
    }))]]) }
    assert.throws(() => buildVariantIndex(corrupted), /invalid Shopify snapshot (inventoryTracked|availableForSale)/)
    assert.throws(() => toCatalogFeed(corrupted), /invalid Shopify snapshot (inventoryTracked|availableForSale)/)
  }
})

test('initial and continuation Admin GraphQL queries request the same stock semantics', () => {
  for (const query of [SHOPIFY_PRODUCTS_QUERY, SHOPIFY_VARIANTS_QUERY]) {
    assert.match(query, /inventoryPolicy\s+inventoryQuantity\s+availableForSale\s+inventoryItem\s*\{\s*tracked\s*\}/)
    assert.doesNotMatch(query, /mutation|checkout|orderCreate/i)
  }
})
