import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules, assertCatalogContract } from './helpers/shopify-test-utils.mjs'

// Integration contract for the real offline Shopify mapper, sync, and
// pagination adapter. Synthetic data only; never invokes Shopify or checkout.
const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
])
const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex, createSnapshot } = modules['shopify-catalog-sync']
const { withHydratedShopifyVariants } = modules['shopify-variant-pages']

const PRODUCT_ID = 'gid://shopify/Product/94001'
const variant = n => ({
  id: `gid://shopify/ProductVariant/${n}`,
  title: `Option ${n}`,
  sku: `SYNTH-${n}`,
  price: n % 2 ? '65.99' : '70.00',
  inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY',
  inventoryQuantity: 0,
})
const product = () => ({
  id: PRODUCT_ID,
  title: 'SYNTHETIC Radiantz-like light',
  status: 'ACTIVE',
  publishedAt: '2026-10-18T00:00:00Z',
  featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
  variantsCount: { count: 225, precision: 'EXACT' },
  variants: {
    nodes: Array.from({ length: 100 }, (_, i) => variant(i + 1)),
    pageInfo: { hasNextPage: true, endCursor: 'after100' },
  },
})
const opts = { shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD' }
const nextPage = async (id, cursor) => {
  assert.equal(id, PRODUCT_ID)
  if (cursor === 'after100') return {
    productId: id,
    variantsCount: { count: 225, precision: 'EXACT' },
    variants: { nodes: Array.from({ length: 100 }, (_, i) => variant(i + 101)), pageInfo: { hasNextPage: true, endCursor: 'after200' } },
  }
  if (cursor === 'after200') return {
    productId: id,
    variantsCount: { count: 225, precision: 'EXACT' },
    variants: { nodes: Array.from({ length: 25 }, (_, i) => variant(i + 201)), pageInfo: { hasNextPage: false, endCursor: 'after225' } },
  }
  throw new Error('unexpected cursor')
}

test('real sync consumes all 225 hydrated variants and preserves Shopify IDs, exact cents and policy', async () => {
  const raw = product()
  const before = structuredClone(raw)
  const fetchPage = withHydratedShopifyVariants(async () => ({
    products: [raw], pageInfo: { hasNextPage: false, endCursor: null },
  }), { fetchVariantPage: nextPage })
  const result = await syncShopifyCatalog({ ...opts, fetchPage })
  assert.equal(result.pages, 1)
  assert.equal(result.upserted, 1)
  assert.equal(result.skipped.length, 0)
  const feed = toCatalogFeed(result.snapshot)
  assert.equal(feed.products.length, 225)
  assertCatalogContract(feed.products)
  const index = buildVariantIndex(result.snapshot)
  assert.equal(index.size, 225)
  for (const n of [1, 2, 100, 101, 200, 225]) {
    const id = `gid://shopify/ProductVariant/${n}`
    assert.equal(feed.products.find(p => p.id === id)?.priceCents, n % 2 ? 6599 : 7000)
    assert.deepEqual(index.get(id), { productId: PRODUCT_ID, variantId: id, sku: `SYNTH-${n}`, inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY', inventoryQuantity: 0 })
    const entry = result.snapshot.products.get('94001')?.find(p => p.id === id)
    assert.equal(entry?.shopify.inventoryPolicy, n % 2 ? 'CONTINUE' : 'DENY')
  }
  assert.deepEqual(raw, before, 'hydration must not modify source data')
})

test('failed continuation leaves prior snapshot untouched, never publishes partial variant family', async () => {
  const base = createSnapshot('USD')
  const fetchPage = withHydratedShopifyVariants(async () => ({
    products: [product()], pageInfo: { hasNextPage: false, endCursor: null },
  }), { fetchVariantPage: async () => { throw new Error('synthetic Shopify 429') } })
  await assert.rejects(syncShopifyCatalog({ ...opts, fetchPage, base }), /synthetic Shopify 429/)
  assert.equal(base.products.size, 0)
  assert.equal(toCatalogFeed(base).products.length, 0)
})
