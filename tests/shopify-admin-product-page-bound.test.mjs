import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
  'lib/shopify-admin-graphql.ts',
])
const { createShopifyAdminCatalogSource } = modules['shopify-admin-graphql']

const product = n => ({
  id: 'gid://shopify/Product/' + n,
  title: 'Synthetic light ' + n,
  status: 'ACTIVE',
  publishedAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
  variantsCount: { count: 1, precision: 'EXACT' },
  variants: {
    nodes: [{
      id: 'gid://shopify/ProductVariant/' + (10000 + n),
      title: 'Default Title', sku: 'SYN-' + n, price: '12.34',
      inventoryPolicy: 'DENY', inventoryQuantity: 0,
    }],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
})

function sourceFor(nodes, hasNextPage = false) {
  const calls = { counts: 0, products: 0, variants: 0 }
  const source = createShopifyAdminCatalogSource(async (document, variables) => {
    if (document.includes('VibeCartProductsCount')) {
      calls.counts++
      return { data: { productsCount: { count: nodes.length, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      calls.products++
      assert.equal(variables.cursor, null)
      return { data: { products: {
        nodes,
        pageInfo: { hasNextPage, endCursor: hasNextPage ? 'next' : null },
      } } }
    }
    if (document.includes('VibeCartProductVariants(')) calls.variants++
    throw new Error('unexpected read-only GraphQL operation')
  })
  return { source, calls }
}

test('Admin rejects oversized first: 5 product pages before variant hydration', async () => {
  for (const hasNextPage of [false, true]) {
    const { source, calls } = sourceFor(Array.from({ length: 6 }, (_, i) => product(i + 1)), hasNextPage)
    await assert.rejects(source.fetchPage(null), /Shopify product page exceeds first: 5/)
    assert.deepEqual(calls, { counts: 1, products: 1, variants: 0 })
  }
})

test('Admin accepts exactly five products with independently verified count', async () => {
  const { source, calls } = sourceFor(Array.from({ length: 5 }, (_, i) => product(i + 1)))
  const page = await source.fetchPage(null)
  assert.equal(page.products.length, 5)
  assert.deepEqual(page.products.map(p => p.id), [
    'gid://shopify/Product/1', 'gid://shopify/Product/2',
    'gid://shopify/Product/3', 'gid://shopify/Product/4',
    'gid://shopify/Product/5',
  ])
  assert.deepEqual(calls, { counts: 2, products: 1, variants: 0 })
})
