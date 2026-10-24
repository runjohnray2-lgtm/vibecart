import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
  'lib/shopify-admin-graphql.ts',
])
const { createShopifyAdminCatalogSource } = modules['shopify-admin-graphql']
const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex, createSnapshot } = modules['shopify-catalog-sync']
const PRODUCT = 'gid://shopify/Product/10001'
const variant = n => ({
  id: 'gid://shopify/ProductVariant/' + n,
  title: 'Option ' + n, sku: 'SYN-' + n, price: n % 2 ? '65.99' : '70.00',
  inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY', inventoryQuantity: 0,
})
const variants = (start, count, hasNextPage, endCursor) => ({
  nodes: Array.from({ length: count }, (_, i) => variant(start + i)),
  pageInfo: { hasNextPage, endCursor },
})
const product = (variantConnection = variants(1, 100, true, 'v100'), expectedCount = 225, precision = 'EXACT') => ({
  id: PRODUCT, title: 'SYNTHETIC light', description: 'Synthetic fixture',
  status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
  variants: variantConnection,
  variantsCount: { count: expectedCount, precision },
})
const productEnvelope = p => ({ data: { products: {
  nodes: [p], pageInfo: { hasNextPage: false, endCursor: null },
} } })

test('Admin GraphQL envelope hydrates 225 variants with exact IDs, prices, policy and no writes', async () => {
  const calls = []
  const execute = async (document, variables) => {
    calls.push({ document, variables })
    if (document.includes('VibeCartProducts(')) return productEnvelope(product())
    if (document.includes('VibeCartProductVariants(')) {
      assert.equal(variables.productId, PRODUCT)
      if (variables.cursor === 'v100') return { data: { product: {
        id: PRODUCT, variants: variants(101, 100, true, 'v200'),
      } } }
      if (variables.cursor === 'v200') return { data: { product: {
        id: PRODUCT, variants: variants(201, 25, false, 'v225'),
      } } }
    }
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    throw new Error('unexpected GraphQL query')
  }
  const source = createShopifyAdminCatalogSource(execute)
  assert.equal(await source.fetchShopCurrency(), 'USD')
  const result = await syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', fetchPage: source.fetchPage,
  })
  assert.equal(result.pages, 1)
  assert.equal(result.upserted, 1)
  assert.equal(result.skipped.length, 0)
  const feed = toCatalogFeed(result.snapshot).products
  assert.equal(feed.length, 225)
  assert.equal(feed.find(p => p.id.endsWith('/225')).priceCents, 6599)
  const index = buildVariantIndex(result.snapshot)
  assert.deepEqual(index.get('gid://shopify/ProductVariant/225'), {
    productId: PRODUCT, variantId: 'gid://shopify/ProductVariant/225', sku: 'SYN-225',
  })
  assert.equal(result.snapshot.products.get('10001')[1].shopify.inventoryPolicy, 'DENY')
  assert.deepEqual(calls.map(c => c.variables.cursor), [undefined, null, 'v100', 'v200'])
  assert.ok(calls.every(c => /^query\b/.test(c.document.trim())))
  assert.ok(calls.every(c => !/mutation|orderCreate|checkoutCreate/i.test(c.document)))
})

test('Shopify HTTP-200 GraphQL errors reject partial product data and preserve last good snapshot', async () => {
  const base = createSnapshot('USD')
  const source = createShopifyAdminCatalogSource(async () => ({
    data: { products: { nodes: [product(variants(1, 1, false, null))], pageInfo: { hasNextPage: false } } },
    errors: [{ message: 'private provider error must not leak' }],
  }))
  await assert.rejects(syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', base, fetchPage: source.fetchPage,
  }), /partial data rejected/)
  assert.equal(toCatalogFeed(base).products.length, 0)
})

test('GraphQL errors on variant continuation reject entire family, never expose first 100', async () => {
  const source = createShopifyAdminCatalogSource(async document => {
    if (document.includes('VibeCartProducts(')) return productEnvelope(product())
    return { data: { product: { id: PRODUCT, variants: variants(101, 1, false, null) } },
      errors: [{ message: 'private error' }] }
  })
  await assert.rejects(source.fetchPage(null), /partial data rejected/)
})

test('rejects missing connections, bad cursors and cross-product continuation', async () => {
  for (const envelope of [
    { data: { products: null } },
    { data: { products: { nodes: [], pageInfo: { hasNextPage: 'false' } } } },
    { data: { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } },
  ]) {
    const source = createShopifyAdminCatalogSource(async () => envelope)
    await assert.rejects(source.fetchPage(null), /invalid Shopify products connection|continuation cursor missing/)
  }
  const source = createShopifyAdminCatalogSource(async document => {
    if (document.includes('VibeCartProducts(')) return productEnvelope(product())
    return { data: { product: { id: 'gid://shopify/Product/other',
      variants: variants(101, 1, false, null) } } }
  })
  await assert.rejects(source.fetchPage(null), /product id mismatch/)
})

test('currency is read and validated without a default or credential exposure', async () => {
  const source = createShopifyAdminCatalogSource(async document => {
    assert.match(document, /shop \{ currencyCode \}/)
    return { data: { shop: { currencyCode: 'JPY' } } }
  })
  await assert.rejects(source.fetchShopCurrency(), /two minor-unit digits/)
  const broken = createShopifyAdminCatalogSource(async () => ({ data: { shop: {} } }))
  await assert.rejects(broken.fetchShopCurrency(), /currencyCode is required/)
  const code = fs.readFileSync('lib/shopify-admin-graphql.ts', 'utf8')
  assert.doesNotMatch(code, /process\.env|fetch\(|Authorization|shpat_|mutation\s*\{/)
})

test('Admin catalog source requires independently exact Shopify variant counts before exposing a page', async () => {
  const one = variants(1, 1, false, null)
  const broken = [
    product(one, 225),
    product(one, 1, 'AT_LEAST'),
    { ...product(one, 1), variantsCount: undefined },
  ]
  for (const item of broken) {
    const source = createShopifyAdminCatalogSource(async document => {
      assert.match(document, /variantsCount\s*\{\s*count\s+precision\s*\}/)
      return productEnvelope(item)
    })
    await assert.rejects(source.fetchPage(null), /exact variantsCount missing, approximate or mismatched/)
  }
  const source = createShopifyAdminCatalogSource(async () => productEnvelope(product(one, 1)))
  const page = await source.fetchPage(null)
  assert.equal(page.products.length, 1)
  assert.equal(page.products[0].variants.nodes.length, 1)
})
