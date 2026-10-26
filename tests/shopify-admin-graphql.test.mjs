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
// Count comes from an independent, unfiltered Shopify Admin query, never from
// the product page being tested.
const withCount = (execute, ...args) => async (document, variables) => {
  // Distinguish an omitted fixture argument (default count 1) from an
  // explicitly undefined Shopify count, which must fail closed.
  const count = args.length > 0 ? args[0] : 1
  const precision = args.length > 1 ? args[1] : 'EXACT'
  if (document.includes('VibeCartProductsCount')) {
    assert.match(document, /productsCount\(limit: null\)/)
    return { data: { productsCount: { count, precision } } }
  }
  return execute(document, variables)
}

test('Admin GraphQL envelope hydrates 225 variants with exact IDs, prices, policy and no writes', async () => {
  const calls = []
  const execute = async (document, variables) => {
    calls.push({ document, variables })
    if (document.includes('VibeCartProducts(')) return productEnvelope(product())
    if (document.includes('VibeCartProductVariants(')) {
      assert.equal(variables.productId, PRODUCT)
      if (variables.cursor === 'v100') return { data: { product: {
        id: PRODUCT, variantsCount: { count: 225, precision: 'EXACT' }, variants: variants(101, 100, true, 'v200'),
      } } }
      if (variables.cursor === 'v200') return { data: { product: {
        id: PRODUCT, variantsCount: { count: 225, precision: 'EXACT' }, variants: variants(201, 25, false, 'v225'),
      } } }
    }
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    throw new Error('unexpected GraphQL query')
  }
  const source = createShopifyAdminCatalogSource(withCount(execute))
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
    productId: PRODUCT, variantId: 'gid://shopify/ProductVariant/225', sku: 'SYN-225', inventoryPolicy: 'CONTINUE',
  })
  assert.equal(result.snapshot.products.get('10001')[1].shopify.inventoryPolicy, 'DENY')
  assert.deepEqual(calls.map(c => c.variables.cursor), [undefined, null, 'v100', 'v200'])
  assert.ok(calls.every(c => /^query\b/.test(c.document.trim())))
  assert.ok(calls.every(c => !/mutation|orderCreate|checkoutCreate/i.test(c.document)))
})


test('Admin continuation rejects missing, approximate or drifted Shopify variant counts', async () => {
  for (const freshCount of [undefined, { count: 226, precision: 'EXACT' }, { count: 225, precision: 'AT_LEAST' }]) {
    let continuationCalls = 0
    const source = createShopifyAdminCatalogSource(withCount(async document => {
      if (document.includes('VibeCartProducts(')) return productEnvelope(product())
      if (document.includes('VibeCartProductVariants(')) {
        assert.match(document, /variantsCount\s*\{\s*count\s+precision\s*\}/)
        continuationCalls++
        return { data: { product: {
          id: PRODUCT, variantsCount: freshCount,
          variants: variants(101, 100, true, 'v200'),
        } } }
      }
      throw new Error('unexpected GraphQL query')
    }))
    await assert.rejects(source.fetchPage(null), /continuation exact variantsCount missing or approximate|variant count changed or became unverifiable/)
    assert.equal(continuationCalls, 1, 'abort before another variant page or catalog publication')
  }
})

test('Admin continuation rejects same-count variant edits detected by Shopify product updatedAt', async () => {
  const first = { ...product(), updatedAt: '2026-10-25T00:00:00Z' }
  for (const continuedUpdatedAt of ['2026-10-25T00:00:01Z', undefined]) {
    let continuationCalls = 0
    const source = createShopifyAdminCatalogSource(withCount(async (document, variables) => {
      if (document.includes('VibeCartProducts(')) return productEnvelope(first)
      if (document.includes('VibeCartProductVariants(')) {
        assert.match(document, /product\(id: \$productId\)\s*\{\s*id\s+updatedAt\s+variantsCount/)
        assert.equal(variables.cursor, 'v100')
        continuationCalls++
        return { data: { product: {
          id: PRODUCT, updatedAt: continuedUpdatedAt,
          variantsCount: { count: 225, precision: 'EXACT' },
          variants: variants(101, 100, true, 'v200'),
        } } }
      }
      throw new Error('unexpected GraphQL operation')
    }))
    await assert.rejects(source.fetchPage(null), /product updatedAt changed or became unverifiable/)
    assert.equal(continuationCalls, 1, 'abort before a second continuation or publishing a mixed snapshot')
  }
})

test('Admin continuation accepts a stable product updatedAt across all 225 variants', async () => {
  const timestamp = '2026-10-25T00:00:00Z'
  const source = createShopifyAdminCatalogSource(withCount(async (document, variables) => {
    if (document.includes('VibeCartProducts(')) {
      return productEnvelope({ ...product(), updatedAt: timestamp })
    }
    if (document.includes('VibeCartProductVariants(')) {
      const first = variables.cursor === 'v100'
      assert.ok(first || variables.cursor === 'v200')
      return { data: { product: {
        id: PRODUCT, updatedAt: timestamp,
        variantsCount: { count: 225, precision: 'EXACT' },
        variants: first ? variants(101, 100, true, 'v200') : variants(201, 25, false, 'v225'),
      } } }
    }
    throw new Error('unexpected GraphQL operation')
  }))
  const page = await source.fetchPage(null)
  assert.equal(page.products.length, 1)
  assert.equal(page.products[0].variants.nodes.length, 225)
  assert.equal(page.products[0].variants.nodes[224].id, 'gid://shopify/ProductVariant/225')
})

test('Shopify HTTP-200 GraphQL errors reject partial product data and preserve last good snapshot', async () => {
  const base = createSnapshot('USD')
  const source = createShopifyAdminCatalogSource(withCount(async () => ({
    data: { products: { nodes: [product(variants(1, 1, false, null))], pageInfo: { hasNextPage: false } } },
    errors: [{ message: 'private provider error must not leak' }],
  })))
  await assert.rejects(syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', base, fetchPage: source.fetchPage,
  }), /partial data rejected/)
  assert.equal(toCatalogFeed(base).products.length, 0)
})

test('GraphQL errors on variant continuation reject entire family, never expose first 100', async () => {
  const source = createShopifyAdminCatalogSource(withCount(async document => {
    if (document.includes('VibeCartProducts(')) return productEnvelope(product())
    return { data: { product: { id: PRODUCT, variants: variants(101, 1, false, null) } },
      errors: [{ message: 'private error' }] }
  }))
  await assert.rejects(source.fetchPage(null), /partial data rejected/)
})

test('rejects missing connections, bad cursors and cross-product continuation', async () => {
  for (const envelope of [
    { data: { products: null } },
    { data: { products: { nodes: [], pageInfo: { hasNextPage: 'false' } } } },
    { data: { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } },
  ]) {
    const source = createShopifyAdminCatalogSource(withCount(async () => envelope))
    await assert.rejects(source.fetchPage(null), /invalid Shopify products connection|continuation cursor missing/)
  }
  const source = createShopifyAdminCatalogSource(withCount(async document => {
    if (document.includes('VibeCartProducts(')) return productEnvelope(product())
    return { data: { product: { id: 'gid://shopify/Product/other',
      variants: variants(101, 1, false, null) } } }
  }))
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
    const source = createShopifyAdminCatalogSource(withCount(async document => {
      assert.match(document, /variantsCount\s*\{\s*count\s+precision\s*\}/)
      return productEnvelope(item)
    }))
    await assert.rejects(source.fetchPage(null), /exact variantsCount missing, approximate or mismatched/)
  }
  const source = createShopifyAdminCatalogSource(withCount(async () => productEnvelope(product(one, 1))))
  const page = await source.fetchPage(null)
  assert.equal(page.products.length, 1)
  assert.equal(page.products[0].variants.nodes.length, 1)
})

test('independent exact Shopify productsCount rejects missing, approximate and silently truncated whole-product traversals', async () => {
  const single = product(variants(1, 1, false, null), 1)
  for (const [count, precision] of [[2, 'EXACT'], [1, 'AT_LEAST'], [undefined, 'EXACT'], [-1, 'EXACT']]) {
    const source = createShopifyAdminCatalogSource(withCount(async () => productEnvelope(single), count, precision))
    await assert.rejects(source.fetchPage(null), /productsCount missing or approximate|product pagination incomplete/)
  }
  const source = createShopifyAdminCatalogSource(async document => {
    if (document.includes('VibeCartProductsCount')) return { data: { productsCount: null } }
    return productEnvelope(single)
  })
  await assert.rejects(source.fetchPage(null), /productsCount missing or approximate/)
})

test('independent product count drift aborts a complete-looking traversal without publishing a snapshot', async () => {
  const single = product(variants(1, 1, false, null), 1)
  for (const changedCount of [0, 2]) {
    let countCalls = 0
    const source = createShopifyAdminCatalogSource(async document => {
      if (document.includes('VibeCartProductsCount')) {
        countCalls++
        return { data: { productsCount: {
          count: countCalls === 1 ? 1 : changedCount, precision: 'EXACT',
        } } }
      }
      if (document.includes('VibeCartProducts(')) return productEnvelope(single)
      throw new Error('unexpected GraphQL query')
    })
    const base = createSnapshot('USD')
    await assert.rejects(syncShopifyCatalog({
      shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD',
      base, fetchPage: source.fetchPage,
    }), /product count changed during traversal/)
    assert.equal(countCalls, 2, 'exact unfiltered count is checked before and after traversal')
    assert.equal(toCatalogFeed(base).products.length, 0, 'the original snapshot is unchanged')
  }
})

test('unfiltered two-page product traversal proves exact count and preserves both products', async () => {
  const first = product(variants(1, 1, false, null), 1)
  const second = { ...product(variants(2, 1, false, null), 1), id: 'gid://shopify/Product/10002' }
  const calls = []
  const source = createShopifyAdminCatalogSource(withCount(async (document, variables) => {
    calls.push(variables.cursor)
    assert.match(document, /VibeCartProducts\(/)
    if (variables.cursor === null) return { data: { products: {
      nodes: [first], pageInfo: { hasNextPage: true, endCursor: 'page-two' },
    } } }
    if (variables.cursor === 'page-two') return { data: { products: {
      nodes: [second], pageInfo: { hasNextPage: false, endCursor: null },
    } } }
    throw new Error('unexpected cursor')
  }, 2))
  const result = await syncShopifyCatalog({
    shopCurrencyCode: 'USD', expectedCurrencyCode: 'USD', fetchPage: source.fetchPage,
  })
  assert.equal(result.pages, 2)
  assert.equal(toCatalogFeed(result.snapshot).products.length, 2)
  assert.deepEqual(calls, [null, 'page-two'])
})
