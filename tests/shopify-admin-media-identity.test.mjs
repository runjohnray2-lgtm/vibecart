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

const PRODUCT = 'gid://shopify/Product/987654'
const VERSION = '2026-10-27T00:00:00Z'
const mediaNode = (id, url = null) => ({
  id: 'gid://shopify/MediaImage/' + id,
  preview: { image: url ? { url } : null },
})
const mediaConnection = (nodes, hasNextPage, endCursor = null) => ({
  nodes, pageInfo: { hasNextPage, endCursor },
})
const product = media => ({
  id: PRODUCT,
  title: 'Synthetic light',
  description: 'Synthetic merchant fixture',
  status: 'ACTIVE',
  publishedAt: VERSION,
  updatedAt: VERSION,
  variantsCount: { count: 1, precision: 'EXACT' },
  variants: {
    nodes: [{
      id: 'gid://shopify/ProductVariant/9876541',
      title: 'Default Title', sku: 'SYN-1', price: '12.34',
      inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
    }],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
  featuredMedia: null,
  media,
})
function sourceFor(first, continuation = null) {
  let mediaRequests = 0
  const source = createShopifyAdminCatalogSource(async (document, variables) => {
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [product(first)],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    if (document.includes('VibeCartProductMedia(')) {
      mediaRequests++
      assert.equal(variables.productId, PRODUCT)
      assert.equal(variables.cursor, 'first-media-page')
      assert.ok(continuation, 'unexpected media continuation')
      return { data: { product: {
        id: PRODUCT, updatedAt: VERSION, media: continuation,
      } } }
    }
    throw new Error('unexpected GraphQL operation')
  })
  return { source, mediaRequests: () => mediaRequests }
}

test('read-only Admin rejects duplicate media identities on a terminal initial page', async () => {
  const { source, mediaRequests } = sourceFor(mediaConnection([
    mediaNode(11), mediaNode(11, 'https://cdn.example.test/valid.jpg'),
  ], false))
  await assert.rejects(source.fetchPage(null), /media pagination contains duplicate node id/)
  assert.equal(mediaRequests(), 0)
})

test('read-only Admin rejects duplicate media identities across cursor pages, even if repeated node has an image', async () => {
  const { source, mediaRequests } = sourceFor(
    mediaConnection([mediaNode(11)], true, 'first-media-page'),
    mediaConnection([mediaNode(11, 'https://cdn.example.test/valid.jpg')], false),
  )
  await assert.rejects(source.fetchPage(null), /media pagination contains duplicate node id/)
  assert.equal(mediaRequests(), 1)
})

test('read-only Admin accepts unique media identities and finds an image on a continuation page', async () => {
  const { source, mediaRequests } = sourceFor(
    mediaConnection([mediaNode(11)], true, 'first-media-page'),
    mediaConnection([mediaNode(12, 'https://cdn.example.test/valid.jpg')], false),
  )
  const page = await source.fetchPage(null)
  assert.equal(mediaRequests(), 1)
  assert.equal(page.products.length, 1)
  assert.deepEqual(page.products[0].media.nodes.map(node => node.id), [
    'gid://shopify/MediaImage/11', 'gid://shopify/MediaImage/12',
  ])
})
