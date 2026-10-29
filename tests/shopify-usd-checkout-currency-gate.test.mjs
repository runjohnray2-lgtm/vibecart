import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct } from './fixtures/shopify-sync-pages.mjs'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// The current VibeCart checkout creates USD Stripe line items. A two-decimal
// foreign Shopify currency must not silently become a USD customer charge.
// Offline synthetic fixtures only; no Shopify, database, or payment requests.
const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
])
const { applyProducts, buildVariantIndex, createSnapshot, syncShopifyCatalog, toCatalogFeed } =
  modules['shopify-catalog-sync']

test('non-USD Shopify prices cannot reach a USD-only feed or variant lookup', async () => {
  const synthetic = gqlProduct(901, 'SYNTHETIC EUR price', [[9011, 'One', 'SYN-EUR', '19.99']])
  const snapshot = applyProducts(createSnapshot('EUR'), [synthetic]).snapshot
  assert.equal(snapshot.products.size, 1, 'valid EUR Shopify data can still be mapped for diagnostics')
  for (const fn of [toCatalogFeed, buildVariantIndex]) {
    assert.throws(() => fn(snapshot), /EUR.*USD-only VibeCart payment currency/,
      'non-USD price must not be represented as a USD charge')
  }
  let fetches = 0
  await assert.rejects(() => syncShopifyCatalog({
    shopCurrencyCode: 'EUR', expectedCurrencyCode: 'EUR',
    fetchPage: async () => {
      fetches++
      throw new Error('foreign-currency sync must be rejected before fetching Shopify')
    },
  }), /EUR.*USD-only VibeCart payment currency/)
  assert.equal(fetches, 0, 'reject unsupported currency before external Admin requests')
})

test('USD Shopify mapping, public feed, and server-only index remain valid', async () => {
  const synthetic = gqlProduct(902, 'SYNTHETIC USD price', [[9021, 'One', 'SYN-USD', '19.99']])
  const snapshot = applyProducts(createSnapshot('USD'), [synthetic]).snapshot
  assert.equal(toCatalogFeed(snapshot).products[0].priceCents, 1999)
  assert.equal(buildVariantIndex(snapshot).get('gid://shopify/ProductVariant/9021').sku, 'SYN-USD')
})
