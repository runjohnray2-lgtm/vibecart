import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts'])
const { mapShopifyProducts } = modules['shopify-catalog-mapper']
const { SHOPIFY_PRODUCTS_QUERY } = modules['shopify-catalog-sync']

test('Admin query uses schema-verified featuredMedia and returns continuation cursor', () => {
  assert.match(SHOPIFY_PRODUCTS_QUERY, /featuredMedia\s*\{\s*preview\s*\{\s*image\s*\{\s*url\s*\}/)
  assert.doesNotMatch(SHOPIFY_PRODUCTS_QUERY, /featuredImage/)
  assert.match(SHOPIFY_PRODUCTS_QUERY, /media\(first: 5\)\s*\{\s*pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}\s*nodes\s*\{\s*id\s+preview\s*\{\s*image\s*\{\s*url\s*\}/)
  assert.doesNotMatch(SHOPIFY_PRODUCTS_QUERY, /\bimages\s*\(/)
  assert.doesNotMatch(SHOPIFY_PRODUCTS_QUERY, /inventoryQuantity\s+image\s*\{/)
  assert.match(SHOPIFY_PRODUCTS_QUERY, /variants\(first: 100\)\s*\{\s*pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/)
  assert.match(SHOPIFY_PRODUCTS_QUERY, /inventoryPolicy/)
  assert.match(SHOPIFY_PRODUCTS_QUERY, /variantsCount\s*\{\s*count\s+precision\s*\}/)
})

test('featuredMedia preview maps without changing real variant IDs, exact cents or DENY/CONTINUE policy', () => {
  const raw = {
    id: 'gid://shopify/Product/123', title: 'SYNTHETIC LED', status: 'ACTIVE',
    publishedAt: '2026-10-18T00:00:00Z',
    featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/led.jpg' } } },
    variants: { nodes: [
      { id: 'gid://shopify/ProductVariant/456', sku: 'LED-A', title: 'Red', price: '65.99', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
      { id: 'gid://shopify/ProductVariant/457', sku: 'LED-B', title: 'Amber', price: '65.99', inventoryPolicy: 'DENY', inventoryQuantity: 0 },
    ], pageInfo: { hasNextPage: false } },
  }
  const result = mapShopifyProducts([raw], { currencyCode: 'USD' })
  assert.equal(result.skipped.length, 0)
  assert.equal(result.products.length, 2)
  assert.deepEqual(result.products.map(p => p.id), ['gid://shopify/ProductVariant/456', 'gid://shopify/ProductVariant/457'])
  assert.deepEqual(result.products.map(p => p.priceCents), [6599, 6599])
  assert.deepEqual(result.products.map(p => p.shopify.inventoryPolicy), ['CONTINUE', 'DENY'])
  assert.deepEqual(result.products.map(p => p.image), ['https://cdn.shopify.com/led.jpg', 'https://cdn.shopify.com/led.jpg'])
})

test('null featuredMedia falls back to images connection', () => {
  const raw = {
    id: 'gid://shopify/Product/123', title: 'SYNTHETIC LED', publishedAt: '2026-10-18T00:00:00Z',
    featuredMedia: null, images: { nodes: [{ url: 'https://cdn.shopify.com/backup.jpg' }] },
    variants: { nodes: [{ id: 'gid://shopify/ProductVariant/456', price: '1.00' }], pageInfo: { hasNextPage: false } },
  }
  const result = mapShopifyProducts([raw], { currencyCode: 'USD' })
  assert.equal(result.products[0].image, 'https://cdn.shopify.com/backup.jpg')
})

test('null featuredMedia uses Admin media preview fallback without inventing variant identity or price', () => {
  const raw = {
    id: 'gid://shopify/Product/123', title: 'SYNTHETIC LED', status: 'ACTIVE',
    publishedAt: '2026-10-18T00:00:00Z', featuredMedia: null,
    media: { nodes: [
      { id: 'gid://shopify/MediaImage/1', preview: { image: null } },
      { id: 'gid://shopify/MediaImage/2', preview: { image: { url: 'https://cdn.shopify.com/media-fallback.jpg' } } },
    ] },
    variants: { nodes: [
      { id: 'gid://shopify/ProductVariant/456', price: '12.50', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
    ], pageInfo: { hasNextPage: false } },
  }
  const result = mapShopifyProducts([raw], { currencyCode: 'USD' })
  assert.equal(result.skipped.length, 0)
  assert.equal(result.products.length, 1)
  assert.equal(result.products[0].id, 'gid://shopify/ProductVariant/456')
  assert.equal(result.products[0].priceCents, 1250)
  assert.equal(result.products[0].shopify.inventoryPolicy, 'CONTINUE')
  assert.equal(result.products[0].image, 'https://cdn.shopify.com/media-fallback.jpg')
})

test('imageless first media page with continuation is not certified as a complete image audit', () => {
  const raw = {
    id: 'gid://shopify/Product/123', title: 'SYNTHETIC MULTIMEDIA LED',
    status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z', featuredMedia: null,
    media: { nodes: [{ id: 'gid://shopify/Video/999', preview: { image: null } }],
      pageInfo: { hasNextPage: true } },
    variants: { nodes: [
      { id: 'gid://shopify/ProductVariant/456', price: '12.50', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
    ], pageInfo: { hasNextPage: false } },
  }
  const incomplete = mapShopifyProducts([raw], { currencyCode: 'USD' })
  assert.equal(incomplete.products.length, 0, 'do not publish a family with uninspected image media')
  assert.equal(incomplete.skipped.length, 1)
  assert.match(incomplete.skipped[0].reason, /image coverage unverified/)
  const terminal = mapShopifyProducts([{ ...raw, media: {
    ...raw.media, pageInfo: { hasNextPage: false },
  } }], { currencyCode: 'USD' })
  assert.equal(terminal.products.length, 1, 'a fully inspected imageless family remains diagnosable')
  assert.equal(terminal.products[0].image, '')
  const imageFound = mapShopifyProducts([{ ...raw, media: {
    nodes: [{ id: 'gid://shopify/MediaImage/999', preview: { image: { url: 'https://cdn.shopify.com/valid.jpg' } } }],
    pageInfo: { hasNextPage: true },
  } }], { currencyCode: 'USD' })
  assert.equal(imageFound.products.length, 1, 'first-page image makes additional media irrelevant for fallback')
  assert.equal(imageFound.products[0].image, 'https://cdn.shopify.com/valid.jpg')
})

test('nested Admin query uses bounded first-page connections to avoid Shopify requested-cost blowups', () => {
  // Shopify imposes a 1,000-point per-query cap before executing GraphQL.
  // This is a conservative connection-size guard, NOT a live cost calculation.
  const products = Number(/products\(first: (\d+)/.exec(SHOPIFY_PRODUCTS_QUERY)?.[1])
  const variants = Number(/variants\(first: (\d+)/.exec(SHOPIFY_PRODUCTS_QUERY)?.[1])
  const media = Number(/media\(first: (\d+)/.exec(SHOPIFY_PRODUCTS_QUERY)?.[1])
  assert.equal(products, 5)
  assert.equal(variants, 100)
  assert.equal(media, 5)
  assert.ok(products * (variants + media) <= 600, 'nested connection request is too large')
  assert.match(SHOPIFY_PRODUCTS_QUERY, /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/)
})
