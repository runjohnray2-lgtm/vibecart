import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct } from './fixtures/shopify-sync-pages.mjs'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// Synthetic Shopify data only. No merchant API, database, payment, or network calls.
const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts'])
const { applyProducts, createSnapshot, syncShopifyCatalog, toCatalogFeed } = modules['shopify-catalog-sync']
const productId = n => 'gid://shopify/Product/' + n
const variantId = n => 'gid://shopify/ProductVariant/' + n
const opts = { shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD' }

function family(id, policies) {
  const product = gqlProduct(
    id,
    'SYNTHETIC ' + id,
    policies.map((_, i) => [id * 10 + i + 1, 'Option ' + (i + 1), 'SYNTH-' + id + '-' + (i + 1), '65.99']),
  )
  product.variants.nodes.forEach((variant, i) => {
    if (policies[i] === undefined) delete variant.inventoryPolicy
    else variant.inventoryPolicy = policies[i]
    variant.inventoryQuantity = 0
  })
  return product
}

test('direct sync preserves verified CONTINUE and DENY policies at zero stock without asserting sellability', () => {
  const result = applyProducts(createSnapshot('USD'), [family(701, ['CONTINUE', 'DENY'])])
  assert.equal(result.upserted, 1)
  assert.equal(result.removed, 0)
  assert.equal(result.skipped.length, 0)
  const variants = result.snapshot.products.get('701')
  assert.deepEqual(variants.map(p => p.shopify.inventoryPolicy), ['CONTINUE', 'DENY'])
  assert.deepEqual(variants.map(p => p.shopify.productId), [productId(701), productId(701)])
  assert.deepEqual(variants.map(p => p.shopify.variantId), [variantId(7011), variantId(7012)])
  assert.deepEqual(toCatalogFeed(result.snapshot).products.map(p => p.priceCents), [6599, 6599])
  assert.equal(JSON.stringify(toCatalogFeed(result.snapshot)).includes('inventoryQuantity'), false)
})

test('missing or invalid policy removes an entire family and its stale variants without mutating the base', () => {
  const base = applyProducts(createSnapshot('USD'), [family(702, ['CONTINUE', 'DENY'])]).snapshot
  const before = structuredClone(toCatalogFeed(base))
  for (const invalid of [undefined, null, '', 'BACKORDER', 1]) {
    const updated = family(702, ['CONTINUE', invalid])
    const result = applyProducts(base, [updated])
    assert.equal(result.upserted, 0)
    assert.equal(result.removed, 1)
    assert.equal(result.snapshot.products.has('702'), false)
    assert.match(result.skipped.map(s => s.reason).join('; '), /inventory policy missing or invalid/)
    assert.deepEqual(toCatalogFeed(base), before)
  }
})

test('paged sync excludes unverified-policy family and retains valid sibling family', async () => {
  const base = applyProducts(createSnapshot('USD'), [family(703, ['CONTINUE'])]).snapshot
  const before = structuredClone(toCatalogFeed(base))
  const pages = [
    { products: [family(703, [undefined])], pageInfo: { hasNextPage: true, endCursor: 'page-2' } },
    { products: [family(704, ['DENY'])], pageInfo: { hasNextPage: false, endCursor: null } },
  ]
  const cursors = []
  const result = await syncShopifyCatalog({ ...opts, base, fetchPage: async cursor => {
    cursors.push(cursor)
    return pages[cursors.length - 1]
  } })
  assert.deepEqual(cursors, [null, 'page-2'])
  assert.equal(result.removed, 1)
  assert.equal(result.upserted, 1)
  assert.deepEqual(toCatalogFeed(result.snapshot).products.map(p => p.id), [variantId(7041)])
  assert.deepEqual(toCatalogFeed(base), before)
})
