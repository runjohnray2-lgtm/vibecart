import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { gqlProduct, page1, page2 } from './fixtures/shopify-sync-pages.mjs'
import { assertCatalogContract, loadTsModules } from './helpers/shopify-test-utils.mjs'

const mapperPath = 'lib/shopify-catalog-mapper.ts'
const syncPath = 'lib/shopify-catalog-sync.ts'
const syncSource = fs.readFileSync(syncPath, 'utf8')
const modules = await loadTsModules([mapperPath, syncPath])
const {
  SHOPIFY_PRODUCTS_QUERY,
  SHOPIFY_SHOP_CURRENCY_QUERY,
  applyProductDeleted,
  applyProducts,
  buildVariantIndex,
  createSnapshot,
  isShopifySyncEnabled,
  shopifyNumericId,
  syncShopifyCatalog,
  toCatalogFeed,
} = modules['shopify-catalog-sync']

const V = id => 'gid://shopify/ProductVariant/' + id
const P = id => 'gid://shopify/Product/' + id
const OPTS = { shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD' }

function pager(pages) {
  const cursors = []
  const fetchPage = async cursor => {
    cursors.push(cursor)
    const found = pages[cursors.length - 1]
    if (!found) throw new Error('unexpected extra page request')
    return found
  }
  return { fetchPage, cursors }
}

async function fullSync() {
  const { fetchPage, cursors } = pager([page1, page2])
  const result = await syncShopifyCatalog({ ...OPTS, fetchPage })
  return { result, cursors }
}

test('full sync follows cursors across pages and builds a deterministic feed', async () => {
  const { result, cursors } = await fullSync()
  assert.deepEqual(cursors, [null, 'c1'])
  assert.equal(result.pages, 2)
  assert.equal(result.upserted, 3)
  assert.equal(result.removed, 0)
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /not published/)
  assert.equal(result.skipped[0].productId, P(4))
  const feed = toCatalogFeed(result.snapshot)
  assert.deepEqual(feed.products.map(p => p.id), [V(11), V(12), V(21), V(31)])
  assert.deepEqual(feed.products.map(p => p.priceCents), [1000, 2050, 500, 725])
  assertCatalogContract(feed.products)
  const beta = feed.products.find(p => p.id === V(21))
  assert.equal('variant' in beta, false)
})

test('feed carries only catalog-contract fields; identifiers stay in the server-side index', async () => {
  const { result } = await fullSync()
  const feed = toCatalogFeed(result.snapshot)
  const allowed = new Set(['id', 'name', 'description', 'priceCents', 'image', 'variant'])
  for (const product of feed.products) {
    for (const key of Object.keys(product)) assert.ok(allowed.has(key), 'unexpected field ' + key)
  }
  const index = buildVariantIndex(result.snapshot)
  assert.equal(index.size, 4)
  assert.deepEqual(index.get(V(11)), { productId: P(1), variantId: V(11), sku: 'A-S', inventoryPolicy: 'CONTINUE' })
  assert.deepEqual(index.get(V(31)), { productId: P(3), variantId: V(31), sku: 'G-1', inventoryPolicy: 'CONTINUE' })
  assert.equal(index.get(V(41)), undefined)
  assert.equal(index.get('nope'), undefined)
})

test('cross-product variant collision fails closed in index and atomic sync', async () => {
  const first = gqlProduct(501, 'SYNTHETIC Alpha', [[777, 'Red', 'ALPHA', '65.99']])
  const second = gqlProduct(502, 'SYNTHETIC Beta', [[777, 'Amber', 'BETA', '70.00']])
  const base = createSnapshot('USD')
  const mapped = applyProducts(base, [first, second])
  assert.equal(mapped.upserted, 2)
  assert.throws(() => buildVariantIndex(mapped.snapshot), /duplicate Shopify variant id in snapshot/)
  assert.throws(() => toCatalogFeed(mapped.snapshot), /duplicate catalog id in snapshot/)

  const fetchPage = async () => ({
    products: [first, second], pageInfo: { hasNextPage: false, endCursor: null },
  })
  await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage, base }), /duplicate Shopify variant id in snapshot/)
  assert.equal(base.products.size, 0, 'failed sync must not mutate the previous snapshot')
})

test('REST and Admin GID aliases of one variant cannot appear as two catalog entries', async () => {
  const first = gqlProduct(801, 'SYNTHETIC first', [[888, 'Red', 'FIRST', '65.99']])
  const second = gqlProduct(802, 'SYNTHETIC second', [[888, 'Amber', 'SECOND', '70.00']])
  const restAlias = {
    ...second,
    variants: {
      ...second.variants,
      nodes: second.variants.nodes.map(variant => ({ ...variant, id: '888' })),
    },
  }
  const base = createSnapshot('USD')
  const applied = applyProducts(base, [first, restAlias])
  assert.equal(applied.upserted, 2, 'both representations pass the individual Shopify ID checks')
  assert.throws(() => toCatalogFeed(applied.snapshot), /duplicate Shopify variant id in snapshot/)
  assert.throws(() => buildVariantIndex(applied.snapshot), /duplicate Shopify variant id in snapshot/)

  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS,
    base,
    fetchPage: async () => ({
      products: [first, restAlias],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
  }), /duplicate Shopify variant id in snapshot/)
  assert.equal(base.products.size, 0, 'failed sync must not mutate the last known-good snapshot')
})

test('duplicate product identities within or across pages fail closed without changing the last good snapshot', async () => {
  const first = gqlProduct(601, 'First', [[6101, 'Red', 'FIRST', '65.99']])
  const repeated = gqlProduct(601, 'Second', [[6102, 'Amber', 'SECOND', '70.00']], { id: 601 })
  const base = applyProducts(createSnapshot('USD'), [
    gqlProduct(600, 'Previously accepted', [[6001, 'One', 'OLD', '12.34']]),
  ]).snapshot
  const before = toCatalogFeed(base)

  for (const pages of [
    [{ products: [first, repeated], pageInfo: { hasNextPage: false, endCursor: null } }],
    [
      { products: [first], pageInfo: { hasNextPage: true, endCursor: 'next' } },
      { products: [repeated], pageInfo: { hasNextPage: false, endCursor: null } },
    ],
  ]) {
    const { fetchPage } = pager(pages)
    await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage, base }), /duplicate Shopify product id/)
    assert.deepEqual(toCatalogFeed(base), before, 'failed sync must leave last good snapshot untouched')
  }
})

test('direct applyProducts rejects duplicate Product REST/GID aliases without mutating the trusted snapshot', () => {
  const base = applyProducts(createSnapshot('USD'), [
    gqlProduct(600, 'SYNTHETIC trusted', [[6001, 'One', 'OLD', '12.34']]),
  ]).snapshot
  const before = toCatalogFeed(base)
  const first = gqlProduct(601, 'SYNTHETIC first', [[6101, 'Red', 'FIRST', '65.99']])
  const alias = gqlProduct(601, 'SYNTHETIC second', [[6102, 'Amber', 'SECOND', '70.00']], { id: 601 })

  assert.throws(() => applyProducts(base, [first, alias]),
    /duplicate Shopify product id in applyProducts batch/,
    'a later REST alias must not silently overwrite the Admin GID family')
  assert.throws(() => applyProducts(base, [alias, first]),
    /duplicate Shopify product id in applyProducts batch/,
    'duplicate detection must work in either order')
  assert.deepEqual(toCatalogFeed(base), before, 'the previous trusted snapshot is immutable')

  const distinct = applyProducts(base, [first, gqlProduct(602, 'SYNTHETIC other', [[6201, 'One', 'OK', '9.99']])])
  assert.equal(distinct.upserted, 2, 'distinct products still upsert normally')
  assert.equal(toCatalogFeed(distinct.snapshot).products.length, before.products.length + 2)
})

test('incremental sync upserts a changed product and drops its removed variants', async () => {
  const { result: first } = await fullSync()
  const updated = gqlProduct(1, 'Alpha', [[11, 'Small', 'A-S', '11.00']])
  const { fetchPage, cursors } = pager([{ products: [updated], pageInfo: { hasNextPage: false, endCursor: null } }])
  const second = await syncShopifyCatalog({ ...OPTS, fetchPage, base: first.snapshot })
  assert.deepEqual(cursors, [null])
  assert.equal(second.upserted, 1)
  const products = toCatalogFeed(second.snapshot).products
  assert.deepEqual(products.map(p => p.id), [V(11), V(21), V(31)])
  assert.equal(products[0].priceCents, 1100)
  assert.equal(toCatalogFeed(first.snapshot).products.length, 4, 'base snapshot must not be mutated')
})

test('filtered traversal cannot prune unseen products and fullRefresh fails closed', async () => {
  const { result: initial } = await fullSync()
  const before = toCatalogFeed(initial.snapshot)
  const onlyOne = gqlProduct(1, 'Alpha', [[11, 'Small', 'A-S', '11.00']])
  let calls = 0
  const fetchPage = async () => {
    calls += 1
    return { products: [onlyOne], pageInfo: { hasNextPage: false, endCursor: null } }
  }
  const incremental = await syncShopifyCatalog({ ...OPTS, base: initial.snapshot, fetchPage })
  assert.equal(incremental.removed, 0)
  assert.deepEqual(toCatalogFeed(incremental.snapshot).products.map(p => p.id), [V(11), V(21), V(31)])

  await assert.rejects(
    () => syncShopifyCatalog({ ...OPTS, base: initial.snapshot, fetchPage, fullRefresh: true }),
    /fullRefresh requires independently verified unfiltered traversal/,
  )
  assert.equal(calls, 1, 'unsafe fullRefresh must fail before any further page requests')
  assert.deepEqual(toCatalogFeed(initial.snapshot), before, 'last-known-good snapshot remains unchanged')
})

test('sync aborts on invalid product identity or incomplete pages without changing base', async () => {
  const { result: initial } = await fullSync()
  const before = toCatalogFeed(initial.snapshot)
  const badId = gqlProduct(9, 'Invalid', [[91, 'One', 'BAD', '10.00']], { id: null })
  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS, base: initial.snapshot,
    fetchPage: async () => ({ products: [badId], pageInfo: { hasNextPage: false, endCursor: null } }),
  }), /invalid id/)
  const { fetchPage } = pager([
    { products: [gqlProduct(1, 'Alpha', [[11, 'One', 'OK', '10.00']])],
      pageInfo: { hasNextPage: true, endCursor: 'next' } },
    { products: [], pageInfo: { hasNextPage: true, endCursor: 'next' } },
  ])
  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS, base: initial.snapshot, fetchPage,
  }), /cursor did not advance/)
  assert.deepEqual(toCatalogFeed(initial.snapshot), before)
})

test('incremental sync rejects unidentified products instead of silently accepting a partial update', async () => {
  const { result: initial } = await fullSync()
  const before = toCatalogFeed(initial.snapshot)
  const valid = gqlProduct(1, 'Updated', [[11, 'Small', 'A-S', '12.00']])
  const unidentified = gqlProduct(9, 'Unknown identity', [[91, 'One', 'BAD', '10.00']], { id: null })
  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS,
    base: initial.snapshot,
    fetchPage: async () => ({
      products: [valid, unidentified],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
  }), /invalid id/)
  assert.deepEqual(toCatalogFeed(initial.snapshot), before, 'last-known-good snapshot must remain intact')
})

test('public catalog snapshots reject unpublished-product overrides before Shopify reads', async () => {
  const published = gqlProduct(881, 'SYNTHETIC published', [[8811, 'One', 'PUB', '12.34']])
  const unpublished = { ...published, publishedAt: null }
  const base = applyProducts(createSnapshot('USD'), [published]).snapshot
  const before = toCatalogFeed(base)

  assert.throws(
    () => applyProducts(base, [unpublished], { includeUnpublished: true }),
    /includeUnpublished is not permitted for public catalog snapshots/,
  )
  let requests = 0
  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS, base, includeUnpublished: true,
    fetchPage: async () => {
      requests += 1
      return { products: [unpublished], pageInfo: { hasNextPage: false, endCursor: null } }
    },
  }), /includeUnpublished is not permitted for public Shopify catalog sync/)
  assert.equal(requests, 0, 'unsafe override must fail before the Shopify transport is called')
  assert.deepEqual(toCatalogFeed(base), before, 'existing published snapshot must remain unchanged')

  const safe = applyProducts(base, [unpublished])
  assert.deepEqual(toCatalogFeed(safe.snapshot).products, [], 'default path must omit unpublished product')
})

test('an update that archives or unpublishes a product removes it from the feed', async () => {
  const { result } = await fullSync()
  const archived = applyProducts(result.snapshot, [
    gqlProduct(2, 'Beta', [[21, 'Default Title', 'B-1', '5.00']], { status: 'ARCHIVED' }),
  ])
  assert.equal(archived.removed, 1)
  assert.match(archived.skipped[0].reason, /status is ARCHIVED/)
  assert.deepEqual(toCatalogFeed(archived.snapshot).products.map(p => p.id), [V(11), V(12), V(31)])

  const unpublished = applyProducts(archived.snapshot, [
    gqlProduct(3, 'Gamma', [[31, 'One', 'G-1', '7.25']], { publishedAt: null }),
  ])
  assert.equal(unpublished.removed, 1)
  assert.deepEqual(toCatalogFeed(unpublished.snapshot).products.map(p => p.id), [V(11), V(12)])
})

test('missing or invalid status never exposes a published Shopify product', async () => {
  const product = gqlProduct(811, 'SYNTHETIC light', [[8111, 'Red', 'R-1', '65.99']])
  const base = applyProducts(createSnapshot('USD'), [product]).snapshot
  const original = toCatalogFeed(base)
  assert.equal(original.products.length, 1)
  for (const status of [undefined, null, ' ', 0]) {
    const raw = { ...product, status }
    const applied = applyProducts(base, [raw])
    assert.equal(applied.removed, 1)
    assert.equal(applied.upserted, 0)
    assert.match(applied.skipped[0].reason, /status unknown/)
    assert.deepEqual(toCatalogFeed(applied.snapshot).products, [])
    const synced = await syncShopifyCatalog({
      ...OPTS, base, fetchPage: async () => ({
        products: [raw], pageInfo: { hasNextPage: false, endCursor: null },
      }),
    })
    assert.deepEqual(toCatalogFeed(synced.snapshot).products, [])
    assert.deepEqual(toCatalogFeed(base), original, 'previous snapshot is immutable')
  }
})

test('a sellable-variant change removes the product instead of keeping a stale price', async () => {
  const { result } = await fullSync()
  const badPrice = applyProducts(result.snapshot, [gqlProduct(2, 'Beta', [[21, 'Default Title', 'B-1', '5.999']])])
  assert.equal(badPrice.removed, 1)
  assert.match(badPrice.skipped[0].reason, /more than two decimal/)
  assert.equal(toCatalogFeed(badPrice.snapshot).products.some(p => p.id === V(21)), false)
})

test('sync omits an entire family when one variant is rejected, preserving unrelated valid products', async () => {
  const old = gqlProduct(920, 'SYNTHETIC previous', [[9201, 'Old', 'OLD', '11.00']])
  const base = applyProducts(createSnapshot('USD'), [old]).snapshot
  const before = toCatalogFeed(base)
  const partial = gqlProduct(920, 'SYNTHETIC partial', [
    [9201, 'Good', 'GOOD', '65.99'],
    [9202, 'Bad price', 'BAD', '12.345'],
  ])
  const other = gqlProduct(921, 'SYNTHETIC valid', [[9211, 'Good', 'OK', '70.00']])

  const applied = applyProducts(base, [partial, other])
  assert.equal(applied.removed, 1)
  assert.equal(applied.upserted, 1)
  assert.equal(applied.snapshot.products.has('920'), false)
  assert.deepEqual(toCatalogFeed(applied.snapshot).products.map(p => p.id), [V(9211)])
  assert.ok(applied.skipped.some(s => s.variantId === V(9202) && /more than two decimal/.test(s.reason)))
  assert.ok(applied.skipped.some(s => /entire family omitted/.test(s.reason)))
  assert.deepEqual(toCatalogFeed(base), before, 'base snapshot remains unchanged')

  const synced = await syncShopifyCatalog({
    ...OPTS, base,
    fetchPage: async () => ({ products: [partial, other], pageInfo: { hasNextPage: false, endCursor: null } }),
  })
  assert.equal(synced.removed, 1)
  assert.equal(synced.upserted, 1)
  assert.deepEqual(toCatalogFeed(synced.snapshot).products.map(p => p.id), [V(9211)])
})

test('delete webhooks accept numeric ids and global ids', async () => {
  const { result } = await fullSync()
  const numeric = applyProductDeleted(result.snapshot, [3])
  assert.equal(numeric.removed, 1)
  const rest = applyProductDeleted(numeric.snapshot, [P(1), '2', 999, null, {}])
  assert.equal(rest.removed, 2)
  assert.equal(toCatalogFeed(rest.snapshot).products.length, 0)
  assert.equal(toCatalogFeed(result.snapshot).products.length, 4)
})

test('product delete webhooks ignore cross-resource and malformed ids with matching numeric suffixes', async () => {
  const { result } = await fullSync()
  const before = toCatalogFeed(result.snapshot)
  const rejected = applyProductDeleted(result.snapshot, [
    V(1), 'gid://shopify/Collection/2', 'gid://shopify/Product/3?other=1',
    'gid://shopify/Product/03', '/Product/2', '3.0', -1,
  ])
  assert.equal(rejected.removed, 0, 'non-Product identities must never remove a real product')
  assert.deepEqual(toCatalogFeed(rejected.snapshot), before)
  const accepted = applyProductDeleted(rejected.snapshot, [P(3)])
  assert.equal(accepted.removed, 1, 'valid Product GIDs must continue to delete')
  assert.equal(toCatalogFeed(accepted.snapshot).products.length, before.products.length - 1)
})

test('sync refuses cross-resource or malformed product identities without replacing cached products', async () => {
  const original = gqlProduct(1, 'SYNTHETIC original', [[11, 'One', 'GOOD', '10.00']])
  const base = applyProducts(createSnapshot('USD'), [original]).snapshot
  const before = toCatalogFeed(base)
  const badIds = [
    V(1), 'gid://shopify/Collection/1', 'gid://shopify/Product/1?other=1',
    'gid://shopify/Product/01', '/Product/1', '1.0', '01', '0',
  ]
  for (const id of badIds) {
    const impostor = { ...original, id, title: 'SYNTHETIC impostor' }
    const direct = applyProducts(base, [impostor])
    assert.equal(direct.upserted, 0, 'invalid product identity must not be cached: ' + id)
    assert.deepEqual(toCatalogFeed(direct.snapshot), before)
    await assert.rejects(() => syncShopifyCatalog({
      ...OPTS, base,
      fetchPage: async () => ({ products: [impostor], pageInfo: { hasNextPage: false, endCursor: null } }),
    }), /invalid id/, 'sync must reject invalid product identity: ' + id)
  }
  const invalidPreferredGid = { ...original, admin_graphql_api_id: V(1) }
  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS, base,
    fetchPage: async () => ({ products: [invalidPreferredGid], pageInfo: { hasNextPage: false, endCursor: null } }),
  }), /invalid id/)
  const validNumeric = { ...original, id: '1' }
  assert.equal(applyProducts(base, [validNumeric]).upserted, 1, 'valid REST numeric product id remains supported')
  assert.deepEqual(toCatalogFeed(base), before, 'failed sync leaves the last good snapshot untouched')
})

test('direct sync omits a whole family with cross-resource or malformed Shopify variant ids', async () => {
  const original = gqlProduct(931, 'SYNTHETIC trusted', [[9311, 'One', 'GOOD', '10.00']])
  const base = applyProducts(createSnapshot('USD'), [original]).snapshot
  const before = toCatalogFeed(base)
  const valid = gqlProduct(931, 'SYNTHETIC updated', [
    [9311, 'One', 'GOOD', '10.00'],
    [9312, 'Two', 'SECOND', '12.00'],
  ])
  const invalidIds = [
    P(9312), 'gid://shopify/Collection/9312',
    'gid://shopify/ProductVariant/9312?inventory_item_id=2',
    'gid://shopify/ProductVariant/09312',
    '/ProductVariant/9312', '9312.0', '09312', '0',
  ]

  for (const id of invalidIds) {
    const variants = valid.variants.nodes.map((variant, index) =>
      index === 1 ? { ...variant, id } : variant)
    const poisoned = { ...valid, variants: { ...valid.variants, nodes: variants } }
    const applied = applyProducts(base, [poisoned])
    assert.equal(applied.upserted, 0, 'invalid variant must not enter snapshot: ' + id)
    assert.equal(applied.removed, 1, 'stale family must be removed: ' + id)
    assert.deepEqual(toCatalogFeed(applied.snapshot).products, [])
    assert.ok(applied.skipped.some(item =>
      item.variantId === id && /invalid Shopify ProductVariant id; entire family omitted/.test(item.reason)))

    const synced = await syncShopifyCatalog({
      ...OPTS, base,
      fetchPage: async () => ({
        products: [poisoned], pageInfo: { hasNextPage: false, endCursor: null },
      }),
    })
    assert.equal(synced.upserted, 0)
    assert.deepEqual(toCatalogFeed(synced.snapshot).products, [])
    assert.deepEqual(toCatalogFeed(base), before, 'last known-good snapshot stays unchanged')
  }

  const wrongPreferredId = {
    ...valid,
    variants: {
      ...valid.variants,
      nodes: valid.variants.nodes.map((variant, index) =>
        index === 1 ? { ...variant, admin_graphql_api_id: P(9312) } : variant),
    },
  }
  // A malformed preferred Admin GID paired with a valid variant id is now a
  // conflicting dual identity, not a skippable single malformed id. Reject
  // the whole batch atomically so a stale trusted price cannot be replaced.
  assert.throws(() => applyProducts(base, [wrongPreferredId]),
    /conflicting Shopify ProductVariant ids/,
    'invalid preferred Admin GID must not fall back to another variant id')
  await assert.rejects(() => syncShopifyCatalog({
    ...OPTS, base,
    fetchPage: async () => ({
      products: [wrongPreferredId], pageInfo: { hasNextPage: false, endCursor: null },
    }),
  }), /conflicting Shopify ProductVariant ids/)
  assert.deepEqual(toCatalogFeed(base), before,
    'conflicting preferred Admin identity must not mutate last known-good snapshot')

  const restVariant = {
    ...valid,
    variants: {
      ...valid.variants,
      nodes: valid.variants.nodes.map((variant, index) =>
        index === 1 ? { ...variant, id: '9312' } : variant),
    },
  }
  assert.equal(applyProducts(base, [restVariant]).upserted, 1,
    'positive REST numeric variant ids remain supported')
  assert.equal(applyProducts(base, [valid]).upserted, 1,
    'valid ProductVariant GIDs remain supported')
})

test('conflicting REST and Admin identities fail atomically instead of mispricing another Shopify item', async () => {
  const product = gqlProduct(941, 'SYNTHETIC trusted', [[9411, 'One', 'GOOD', '10.00']])
  const base = applyProducts(createSnapshot('USD'), [product]).snapshot
  const before = toCatalogFeed(base)
  const dual = {
    ...product, admin_graphql_api_id: P(941), id: 941,
    variants: {
      ...product.variants,
      nodes: product.variants.nodes.map(variant => ({
        ...variant, admin_graphql_api_id: V(9411), id: 9411,
      })),
    },
  }
  assert.equal(applyProducts(base, [dual]).upserted, 1, 'matching REST and GID representations remain valid')
  const badProduct = { ...dual, id: 942 }
  const badVariant = {
    ...dual,
    variants: { ...dual.variants, nodes: [{ ...dual.variants.nodes[0], id: 9412 }] },
  }
  for (const [raw, resource] of [[badProduct, 'Product'], [badVariant, 'ProductVariant']]) {
    assert.throws(() => applyProducts(base, [raw]), new RegExp('conflicting Shopify ' + resource + ' ids'))
    await assert.rejects(() => syncShopifyCatalog({
      ...OPTS, base,
      fetchPage: async () => ({ products: [raw], pageInfo: { hasNextPage: false, endCursor: null } }),
    }), new RegExp('conflicting Shopify ' + resource + ' ids'))
    assert.deepEqual(toCatalogFeed(base), before, 'rejected update cannot mutate the trusted snapshot')
  }
})

test('unlabelled Shopify Money prices omit the entire family without corrupting the trusted snapshot', async () => {
  const trusted = gqlProduct(992, 'SYNTHETIC trusted', [[9921, 'Red', 'RED', '10.00']])
  const base = applyProducts(createSnapshot('USD'), [trusted]).snapshot
  const before = toCatalogFeed(base)
  const changed = gqlProduct(992, 'SYNTHETIC changed', [
    [9921, 'Red', 'RED', '11.00'],
    [9922, 'Amber', 'AMBER', '12.00'],
  ])
  const poisoned = {
    ...changed,
    variants: {
      ...changed.variants,
      nodes: changed.variants.nodes.map((variant, i) =>
        i === 1 ? { ...variant, price: { amount: '12.00' } } : variant),
    },
  }
  const direct = applyProducts(base, [poisoned])
  assert.equal(direct.upserted, 0)
  assert.equal(direct.removed, 1)
  assert.equal(toCatalogFeed(direct.snapshot).products.length, 0)
  assert.ok(direct.skipped.some(item => /price currencyCode is missing/.test(item.reason)))
  assert.ok(direct.skipped.some(item => /entire family omitted/.test(item.reason)))
  const synced = await syncShopifyCatalog({
    ...OPTS, base,
    fetchPage: async () => ({
      products: [poisoned], pageInfo: { hasNextPage: false, endCursor: null },
    }),
  })
  assert.equal(toCatalogFeed(synced.snapshot).products.length, 0)
  assert.deepEqual(toCatalogFeed(base), before, 'last known-good snapshot must not be mutated')
})

test('currency must be verified, never assumed', async () => {
  const fetchPage = async () => page2
  await assert.rejects(() => syncShopifyCatalog({ shopCurrencyCode: 'EUR', expectedCurrencyCode: 'USD', fetchPage }), /does not match/)
  await assert.rejects(() => syncShopifyCatalog({ shopCurrencyCode: 'JPY', expectedCurrencyCode: 'JPY', fetchPage }), /two minor-unit/)
  await assert.rejects(() => syncShopifyCatalog({ expectedCurrencyCode: 'USD', fetchPage }), /currencyCode is required/)
  await assert.rejects(() => syncShopifyCatalog({ shopCurrencyCode: 'USD', fetchPage }), /currencyCode is required/)
  const eur = createSnapshot('eur')
  assert.equal(eur.currencyCode, 'EUR')
  await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage, base: eur }), /base snapshot currency/)
})

test('product pagination limits reject invalid overrides before Shopify requests', async () => {
  let calls = 0
  const fetchPage = async () => {
    calls += 1
    return { products: [], pageInfo: { hasNextPage: false, endCursor: null } }
  }
  for (const maxPages of [0, -1, 1.5, 201, NaN, Infinity, Number.MAX_SAFE_INTEGER, '3']) {
    await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage, maxPages }), /invalid Shopify product pagination limits/)
  }
  assert.equal(calls, 0, 'invalid override must fail before any Shopify request')
  const result = await syncShopifyCatalog({ ...OPTS, fetchPage, maxPages: 200 })
  assert.equal(result.pages, 1)
  assert.equal(calls, 1)
})

test('pagination guards: repeated cursor, page limit, invalid page, failed fetch', async () => {
  const loop = pager([
    { products: [], pageInfo: { hasNextPage: true, endCursor: 'x' } },
    { products: [], pageInfo: { hasNextPage: true, endCursor: 'x' } },
  ])
  await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage: loop.fetchPage }), /cursor did not advance/)

  const endless = async cursor => ({ products: [], pageInfo: { hasNextPage: true, endCursor: String(cursor) + 'n' } })
  await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage: endless, maxPages: 3 }), /exceeded maxPages/)

  await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage: async () => ({ products: 'nope' }) }), /invalid page/)

  const { result: first } = await fullSync()
  let calls = 0
  const flaky = async () => {
    calls += 1
    if (calls === 1) return page1
    throw new Error('boom')
  }
  await assert.rejects(() => syncShopifyCatalog({ ...OPTS, fetchPage: flaky, base: first.snapshot }), /boom/)
  assert.equal(toCatalogFeed(first.snapshot).products.length, 4)
})

test('a product with an incomplete variant list is not exposed', () => {
  const big = gqlProduct(5, 'Big', [[51, 'x', 'S', '1.00']], {
    variants: { pageInfo: { hasNextPage: true }, nodes: [{ id: V(51), title: 'x', sku: 'S', price: '1.00' }] },
  })
  const result = applyProducts(createSnapshot('USD'), [big])
  assert.equal(result.upserted, 0)
  assert.match(result.skipped[0].reason, /truncated/)
})

test('feature flag is off unless explicitly true', () => {
  assert.equal(isShopifySyncEnabled({}), false)
  assert.equal(isShopifySyncEnabled({ VIBECART_SHOPIFY_SYNC_ENABLED: '1' }), false)
  assert.equal(isShopifySyncEnabled({ VIBECART_SHOPIFY_SYNC_ENABLED: 'false' }), false)
  assert.equal(isShopifySyncEnabled({ VIBECART_SHOPIFY_SYNC_ENABLED: ' TRUE ' }), true)
})

test('reference queries request what the mapper needs', () => {
  for (const field of ['hasNextPage', 'endCursor', 'inventoryPolicy', 'inventoryQuantity', 'publishedAt', 'status', 'sku', 'price']) {
    assert.ok(SHOPIFY_PRODUCTS_QUERY.includes(field), 'missing ' + field)
  }
  assert.ok(SHOPIFY_PRODUCTS_QUERY.includes('variants(first: 100)'))
  assert.match(SHOPIFY_SHOP_CURRENCY_QUERY, /currencyCode/)
})

test('shopifyNumericId extracts the numeric tail of gids and numeric ids', () => {
  assert.equal(shopifyNumericId('gid://shopify/Product/123'), '123')
  assert.equal(shopifyNumericId('456'), '456')
  assert.equal(shopifyNumericId('gid://shopify/ProductVariant/1?inventory_item_id=9'), '1')
  assert.equal(shopifyNumericId('abc'), undefined)
})

/** Remove comment trivia without transpiling away unused imports or altering runtime code. */
function withoutTsComments(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.Standard, source)
  const chars = source.split('')
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    for (let i = scanner.getTokenPos(); i < scanner.getTextPos(); i += 1) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
    }
  }
  return chars.join('')
}

test('isolation guard ignores comments but still detects executable dependencies', () => {
  const forbidden = /stripe|checkout|cart-store|neon|process\.env|fetch\(/i
  assert.doesNotMatch(withoutTsComments('// checkout is a separate concern\n/* stripe */\nexport const ok = 1'), forbidden)
  assert.match(withoutTsComments("import unused from 'stripe'"), forbidden)
  assert.match(withoutTsComments("export const bad = fetch('https://example.test')"), forbidden)
  assert.match(withoutTsComments('export const bad = process.env.KEY'), forbidden)
})

test('sync module stays isolated: imports only a type and the mapper, no payment, database or env', () => {
  const code = withoutTsComments(syncSource)
  assert.doesNotMatch(code, /stripe|checkout|cart-store|neon|process\.env|fetch\(/i)
  assert.deepEqual(syncSource.match(/from '[^']+'/g), ["from '@/lib/products'", "from '@/lib/shopify-catalog-mapper'"])
})

test('Shopify SKUs remain exact and unsupported SKUs never silently enter a partial catalog family', async () => {
  const trusted = gqlProduct(980, 'SYNTHETIC trusted', [[9801, 'One', '  SKU-9801  ', '10.00']])
  const base = applyProducts(createSnapshot('USD'), [trusted]).snapshot
  const before = toCatalogFeed(base)
  assert.equal(buildVariantIndex(base).get(V(9801)).sku, '  SKU-9801  ',
    'merchant SKU whitespace must not be silently trimmed')
  assert.doesNotMatch(JSON.stringify(before), /SKU-9801/,
    'the exact SKU belongs only in the server-side index')

  const updated = gqlProduct(980, 'SYNTHETIC updated', [
    [9801, 'One', 'GOOD', '11.00'],
    [9802, 'Two', 'SECOND', '12.00'],
  ])
  for (const [badSku, expected] of [
    ['X'.repeat(201), /variant sku is longer than 200/],
    [42, /variant sku is not a string/],
  ]) {
    const poisoned = {
      ...updated,
      variants: {
        ...updated.variants,
        nodes: updated.variants.nodes.map((variant, i) =>
          i === 1 ? { ...variant, sku: badSku } : variant),
      },
    }
    const direct = applyProducts(base, [poisoned])
    assert.equal(direct.upserted, 0, 'a rejected SKU must not publish valid siblings')
    assert.equal(direct.removed, 1, 'stale product family must be removed from new snapshot')
    assert.equal(toCatalogFeed(direct.snapshot).products.length, 0)
    assert.ok(direct.skipped.some(item => expected.test(item.reason)))
    assert.ok(direct.skipped.some(item => /entire family omitted/.test(item.reason)))

    const synced = await syncShopifyCatalog({
      ...OPTS, base,
      fetchPage: async () => ({
        products: [poisoned], pageInfo: { hasNextPage: false, endCursor: null },
      }),
    })
    assert.equal(toCatalogFeed(synced.snapshot).products.length, 0)
    assert.deepEqual(toCatalogFeed(base), before,
      'invalid SKU must not mutate the last-known-good snapshot')
  }
})

test('direct Shopify variantsCount rejects truncated or approximate families without corrupting the trusted snapshot', async () => {
  const original = gqlProduct(760, 'SYNTHETIC complete', [[7601, 'One', 'SKU-7601', '19.99']])
  const base = applyProducts(createSnapshot('USD'), [original]).snapshot
  const before = toCatalogFeed(base)
  const withCount = (count, precision = 'EXACT') => ({
    ...original,
    variantsCount: { count, precision },
  })
  const malformed = [
    withCount(2),                 // A false terminal pageInfo cannot hide missing variants.
    withCount(1, 'AT_LEAST'),     // An approximate count is not completeness proof.
    withCount('1'),              // No string coercion.
    withCount(-1),
    { ...original, variantsCount: null },
    { ...original, variantsCount: undefined },
  ]
  for (const product of malformed) {
    const applied = applyProducts(base, [product])
    assert.equal(applied.removed, 1)
    assert.equal(applied.upserted, 0)
    assert.match(applied.skipped[0].reason, /exact variantsCount missing, approximate or mismatched/)
    assert.deepEqual(toCatalogFeed(applied.snapshot).products, [])

    const synced = await syncShopifyCatalog({
      ...OPTS, base,
      fetchPage: async () => ({
        products: [product], pageInfo: { hasNextPage: false, endCursor: null },
      }),
    })
    assert.deepEqual(toCatalogFeed(synced.snapshot).products, [])
    assert.deepEqual(toCatalogFeed(base), before, 'failed family must not mutate last good snapshot')
  }

  const complete = applyProducts(base, [withCount(1)])
  assert.equal(complete.upserted, 1)
  assert.deepEqual(toCatalogFeed(complete.snapshot), before)
  // Older REST/direct fixtures without a count remain supported.
  assert.equal(applyProducts(createSnapshot('USD'), [original]).upserted, 1)
})
