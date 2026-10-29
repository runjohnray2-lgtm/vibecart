import assert from 'node:assert/strict'
import test from 'node:test'
import { page1, page2 } from './fixtures/shopify-sync-pages.mjs'
import { assertCatalogContract, loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
])
const {
  applyProducts,
  buildVariantIndex,
  createSnapshot,
  toCatalogFeed,
  toPilotCatalogFeed,
} = modules['shopify-catalog-sync']

const V = id => 'gid://shopify/ProductVariant/' + id

function verifiedSyntheticSnapshot() {
  const input = [...page1.products, ...page2.products]
  const applied = applyProducts(createSnapshot('USD'), input)
  assert.equal(applied.upserted, 3)
  return applied.snapshot
}

test('protected pilot selects only explicit trusted variants, retaining exact ids and cents', () => {
  const snapshot = verifiedSyntheticSnapshot()
  const complete = toCatalogFeed(snapshot)
  assert.equal(complete.products.length, 4)
  // The caller's ordering must not determine catalog ordering. Numeric REST
  // and GraphQL GID forms may identify the same exact approved variant.
  const pilot = toPilotCatalogFeed(snapshot, [V(31), '11'])
  assert.deepEqual(pilot.products.map(p => p.id), [V(11), V(31)])
  assert.deepEqual(pilot.products.map(p => p.priceCents), [1000, 725])
  assertCatalogContract(pilot.products)
  for (const product of pilot.products) {
    assert.deepEqual(
      Object.keys(product).sort(),
      ['description', 'id', 'image', 'name', 'priceCents', 'variant'].sort(),
      'server-only Shopify SKU and inventory metadata must not leak to the agent feed',
    )
  }
  const index = buildVariantIndex(snapshot)
  assert.equal(index.get(V(11)).sku, 'A-S')
  assert.equal(index.get(V(31)).sku, 'G-1')
  assert.equal(index.get(V(31)).inventoryPolicy, 'CONTINUE')
  assert.deepEqual(toCatalogFeed(snapshot), complete, 'pilot projection cannot mutate the full trusted snapshot')
})

test('pilot selection rejects unknown, duplicate, unapproved or oversized variant sets', () => {
  const snapshot = verifiedSyntheticSnapshot()
  for (const ids of [[], Array(21).fill(V(11)), ['not-a-shopify-id'], [V(11), '11'], [V(41)], [V(999)]]) {
    assert.throws(() => toPilotCatalogFeed(snapshot, ids))
  }
  assert.throws(() => toPilotCatalogFeed(snapshot, null), /requires 1/)
  assert.throws(() => toPilotCatalogFeed(snapshot, [11]), /invalid pilot Shopify variant id/)
  assert.deepEqual(toPilotCatalogFeed(snapshot, [V(21)]).products.map(p => p.id), [V(21)])
})

test('pilot selection validates unselected families and currency before projecting a subset', () => {
  const snapshot = verifiedSyntheticSnapshot()
  const before = toCatalogFeed(snapshot)
  const poisoned = new Map(snapshot.products)
  const unselected = poisoned.get('3')
  poisoned.set('3', [{
    ...unselected[0],
    shopify: { ...unselected[0].shopify, inventoryPolicy: undefined },
  }])
  assert.throws(
    () => toPilotCatalogFeed({ ...snapshot, products: poisoned }, [V(11)]),
    /inventoryPolicy/,
    'unselected corrupted Shopify families must not be silently hidden',
  )
  assert.throws(
    () => toPilotCatalogFeed({ ...snapshot, currencyCode: 'EUR' }, [V(11)]),
    /unsupported by USD-only/,
  )
  assert.deepEqual(toCatalogFeed(snapshot), before, 'failed pilot projection must preserve the trusted snapshot')
})
