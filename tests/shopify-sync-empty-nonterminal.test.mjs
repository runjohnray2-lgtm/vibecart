import assert from 'node:assert/strict'
import test from 'node:test'
import { gqlProduct } from './fixtures/shopify-sync-pages.mjs'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts'])
const { applyProducts, createSnapshot, syncShopifyCatalog, toCatalogFeed } = modules['shopify-catalog-sync']
const currency = { shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD' }

test('direct sync rejects empty nonterminal product pages without replacing last-good catalog', async () => {
  const base = applyProducts(createSnapshot('USD'), [
    gqlProduct(970, 'SYNTHETIC original', [[9701, 'Red', 'ORIGINAL', '12.34']]),
  ]).snapshot
  const before = toCatalogFeed(base)
  let requests = 0
  await assert.rejects(
    syncShopifyCatalog({
      ...currency,
      base,
      fetchPage: async cursor => {
        requests++
        if (cursor === null) {
          return { products: [], pageInfo: { hasNextPage: true, endCursor: 'untrusted-next' } }
        }
        return {
          products: [gqlProduct(971, 'SYNTHETIC next', [[9711, 'Blue', 'NEXT', '15.00']])],
          pageInfo: { hasNextPage: false, endCursor: null },
        }
      },
    }),
    /empty Shopify product page with continuation/,
  )
  assert.equal(requests, 1, 'do not request a continuation from an invalid empty page')
  assert.deepEqual(toCatalogFeed(base), before, 'trusted base must remain unchanged')
})

test('direct sync still accepts a genuinely empty terminal catalog', async () => {
  const result = await syncShopifyCatalog({
    ...currency,
    fetchPage: async cursor => {
      assert.equal(cursor, null)
      return { products: [], pageInfo: { hasNextPage: false, endCursor: null } }
    },
  })
  assert.equal(result.pages, 1)
  assert.deepEqual(toCatalogFeed(result.snapshot).products, [])
})
