import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct, page1, page2 } from './fixtures/shopify-sync-pages.mjs'
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


test('protected pilot rejects known-unavailable variants but preserves untracked zero DENY and zero CONTINUE', () => {
  const raw = gqlProduct(88, 'SYNTHETIC pilot availability', [
    [881, 'Untracked zero DENY', 'SYN-881', '21.99'],
    [882, 'Tracked zero DENY', 'SYN-882', '21.99'],
    [883, 'Tracked zero CONTINUE', 'SYN-883', '21.99'],
    [884, 'Unavailable CONTINUE', 'SYN-884', '21.99'],
  ])
  Object.assign(raw.variants.nodes[0], {
    inventoryPolicy: 'DENY', inventoryQuantity: 0,
    inventoryItem: { tracked: false }, availableForSale: true,
  })
  Object.assign(raw.variants.nodes[1], {
    inventoryPolicy: 'DENY', inventoryQuantity: 0,
    inventoryItem: { tracked: true }, availableForSale: false,
  })
  Object.assign(raw.variants.nodes[2], {
    inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
    inventoryItem: { tracked: true }, availableForSale: true,
  })
  Object.assign(raw.variants.nodes[3], {
    inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
    inventoryItem: { tracked: true }, availableForSale: false,
  })
  const applied = applyProducts(createSnapshot('USD'), [raw])
  assert.equal(applied.skipped.length, 0)
  const snapshot = applied.snapshot
  const before = toCatalogFeed(snapshot)
  assert.deepEqual(
    toPilotCatalogFeed(snapshot, [V(883), V(881)]).products.map(p => p.id),
    [V(881), V(883)],
    'a zero-stock DENY variant can remain available when tracking is disabled',
  )
  for (const id of [V(882), V(884)]) {
    assert.throws(
      () => toPilotCatalogFeed(snapshot, [id]),
      /explicitly reported unavailable/,
    )
  }
  assert.throws(
    () => toPilotCatalogFeed(snapshot, [V(881), V(882)]),
    /explicitly reported unavailable/,
    'one known-unavailable selection must fail the whole protected pilot projection',
  )
  assert.deepEqual(toCatalogFeed(snapshot), before, 'failed pilot selection must not mutate the trusted source')
})

test('restored Shopify identities must remain strings at feed and server-index boundaries', () => {
  const trusted = verifiedSyntheticSnapshot()
  const [familyKey, variants] = [...trusted.products][0]
  const originalFeed = toCatalogFeed(trusted)
  for (const [field, invalid] of [
    ['id', 11],
    ['shopify.productId', 1],
    ['shopify.variantId', 11],
    ['id', null],
    ['shopify.productId', null],
    ['shopify.variantId', null],
  ]) {
    const bad = { ...variants[0], shopify: { ...variants[0].shopify } }
    if (field === 'id') bad.id = invalid
    else bad.shopify[field.split('.')[1]] = invalid
    const families = new Map(trusted.products)
    families.set(familyKey, [bad, ...variants.slice(1)])
    const corrupted = { ...trusted, products: families }
    const reason = /invalid Shopify variant id in snapshot|Shopify snapshot product id mismatch/
    assert.throws(() => buildVariantIndex(corrupted), reason, field)
    assert.throws(() => toCatalogFeed(corrupted), reason, field)
    assert.throws(() => toPilotCatalogFeed(corrupted, [V(11)]), reason, field)
  }
  assert.deepEqual(toCatalogFeed(trusted), originalFeed, 'rejected snapshots cannot mutate the trusted source')
})
