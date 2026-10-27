import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditShopifyCatalogReadOnly,
  createReadOnlyShopifyTransport,
} from '../scripts/audit-shopify-catalog-readonly.mjs'

const READ = 'query VibeCartProducts { shop { currencyCode } }'
const COUNT = 'query VibeCartProductsCount { productsCount(limit: null) { count precision } }'
const DOCS = new Set([READ, COUNT, 'query VibeCartProductVariants { shop { id } }', 'query VibeCartShopCurrency { shop { currencyCode } }', 'query VibeCartProductMedia { shop { id } }'])
const opts = { shopDomain: 'synthetic-shop.myshopify.com', token: 'synthetic-private-token', allowedDocuments: DOCS }
const json = value => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' },
})

test('read-only transport uses exact Shopify host, POST, no redirects and only allowlisted queries', async () => {
  const calls = []
  const execute = createReadOnlyShopifyTransport({
    ...opts,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return json({ data: { shop: { currencyCode: 'USD' } } })
    },
  })
  assert.deepEqual(await execute(READ, { cursor: null }), { data: { shop: { currencyCode: 'USD' } } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://synthetic-shop.myshopify.com/admin/api/2026-10/graphql.json')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(calls[0].options.headers['x-shopify-access-token'], opts.token)
  assert.equal(JSON.parse(calls[0].options.body).query, READ)
  await assert.rejects(execute('mutation { productDelete(id: "x") { deletedProductId } }', {}), /unapproved/)
  assert.equal(calls.length, 1, 'rejected mutation must not make a network request')
})

test('read-only transport freezes its allowlist and refuses mixed query/mutation documents', async () => {
  const mutable = new Set(DOCS)
  let networkCalls = 0
  const execute = createReadOnlyShopifyTransport({
    ...opts, allowedDocuments: mutable,
    fetchImpl: async () => { networkCalls++; return json({ data: {} }) },
  })
  // A mutable Set supplied by a caller must never expand Admin token authority.
  mutable.delete(READ)
  const injected = 'mutation DeleteProduct { productDelete(id: "test") { deletedProductId } }'
  mutable.add(injected)
  await assert.rejects(execute(injected, {}), /unapproved GraphQL operation/)
  await execute(READ, {})
  assert.equal(networkCalls, 1, 'only the originally approved query reached the transport')

  for (const unsafe of [
    'query Safe { shop { id } } mutation DeleteProduct { productDelete(id: "test") { deletedProductId } }',
    'query Safe { shop { id } } subscription Watch { shop { id } }',
  ]) {
    const documents = new Set([...DOCS].slice(0, 4).concat(unsafe))
    assert.throws(() => createReadOnlyShopifyTransport({
      ...opts, allowedDocuments: documents,
    }), /read-only GraphQL queries only/)
  }
})

test('read-only transport refuses unsafe hosts, missing tokens and excessive requests', async () => {
  for (const shopDomain of ['radiantz.com', 'evil.myshopify.com.attacker.test', 'localhost',
    'https://synthetic-shop.myshopify.com', 'synthetic-shop.myshopify.com:443']) {
    assert.throws(() => createReadOnlyShopifyTransport({ ...opts, shopDomain }), /exact .*myshopify.com/)
  }
  assert.throws(() => createReadOnlyShopifyTransport({ ...opts, token: '' }), /private read-only Admin token/)
  assert.throws(() => createReadOnlyShopifyTransport({ ...opts, apiVersion: 'unstable' }), /pinned quarterly/)
  assert.throws(() => createReadOnlyShopifyTransport({ ...opts, maxRequests: 10000 }), /request limit/)
  let calls = 0
  const execute = createReadOnlyShopifyTransport({
    ...opts, maxRequests: 1, fetchImpl: async () => { calls++; return json({ data: {} }) },
  })
  await execute(READ, {})
  await assert.rejects(execute(READ, {}), /request limit reached/)
  assert.equal(calls, 1)
})

test('read-only transport refuses HTTP redirects and malformed responses without echoing token', async () => {
  for (const response of [
    new Response('', { status: 302, headers: { location: 'https://attacker.test/' } }),
    new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }),
  ]) {
    const execute = createReadOnlyShopifyTransport({ ...opts, fetchImpl: async () => response })
    await assert.rejects(execute(READ, {}), error => {
      assert.equal(error.message.includes(opts.token), false)
      return /Shopify audit/.test(error.message)
    })
  }
})

test('read-only audit traverses a real adapter contract and returns aggregates, never raw catalog records', async () => {
  const calls = []
  const execute = async (document, variables) => {
    calls.push({ document, variables })
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: { nodes: [{
        id: 'gid://shopify/Product/100', title: 'SYNTHETIC test light',
        description: 'Synthetic only', status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
        featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
        variantsCount: { count: 1, precision: 'EXACT' },
        variants: { nodes: [{
          id: 'gid://shopify/ProductVariant/101', title: 'Red',
          sku: 'SYN-101', price: '65.99', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
        }], pageInfo: { hasNextPage: false, endCursor: null } },
      }], pageInfo: { hasNextPage: false, endCursor: null } } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.deepEqual({
    verified: result.verified, traversalVerified: result.traversalVerified, catalogReady: result.catalogReady, readOnly: result.readOnly, currency: result.currency,
    productPages: result.productPages, publishedProductFamilies: result.publishedProductFamilies,
    catalogVariants: result.catalogVariants, skippedRecords: result.skippedRecords,
  }, {
    verified: true, traversalVerified: true, catalogReady: true, readOnly: true, currency: 'USD',
    productPages: 1, publishedProductFamilies: 1, catalogVariants: 1, skippedRecords: 0,
  })
  assert.equal(result.missingImages, 0)
  assert.equal(result.productFamiliesWithMissingImages, 0)
  assert.equal(result.denyPolicyVariants, 0)
  assert.equal(result.continuePolicyVariants, 1)
  assert.equal(result.sellabilityVerified, false, 'a read-only audit cannot authorize checkout')
  assert.equal(calls.length, 4, 'shop currency, opening count, product page and final count')
  assert.equal(calls.filter(c => c.document.includes('VibeCartProductsCount')).length, 2)
  assert.ok(calls.every(c => c.document.trim().startsWith('query ')))
  assert.doesNotMatch(JSON.stringify(result), /SYN-101|SYNTHETIC test light|65\.99|ProductVariant/)
  assert.match(result.note, /MCP\/UCP.*NOT verified/)
})

test('read-only audit distinguishes zero-stock DENY from made-to-order CONTINUE without claiming sellability', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/500', title: 'SYNTHETIC POLICY FIXTURE',
          description: 'Synthetic only', status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
          featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
          variantsCount: { count: 2, precision: 'EXACT' },
          variants: { nodes: [
            { id: 'gid://shopify/ProductVariant/501', title: 'DENY zero', sku: 'PRIVATE-DENY',
              price: '11.00', inventoryPolicy: 'DENY', inventoryQuantity: 0 },
            { id: 'gid://shopify/ProductVariant/502', title: 'CONTINUE zero', sku: 'PRIVATE-CONTINUE',
              price: '12.00', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
          ], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected read-only query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.equal(result.traversalVerified, true)
  assert.equal(result.catalogVariants, 2, 'the read-only catalog preserves both variant identities')
  assert.equal(result.denyPolicyVariants, 1)
  assert.equal(result.continuePolicyVariants, 1)
  assert.equal(result.sellabilityVerified, false, 'DENY with zero stock must never be checkout authorization')
  assert.equal(result.catalogReady, true, 'catalog mapping does not substitute for fresh sellability')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-DENY|PRIVATE-CONTINUE|SYNTHETIC POLICY FIXTURE|ProductVariant/)
})

test('read-only inventory observations count unpublished DENY/CONTINUE zero stock without implying sellability', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/810', title: 'PRIVATE DRAFT INVENTORY FIXTURE',
          status: 'DRAFT', publishedAt: null,
          featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
          variantsCount: { count: 5, precision: 'EXACT' },
          variants: { nodes: [
            { id: 'gid://shopify/ProductVariant/811', price: '11.00',
              inventoryPolicy: 'DENY', inventoryQuantity: 0 },
            { id: 'gid://shopify/ProductVariant/812', price: '12.00',
              inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
            { id: 'gid://shopify/ProductVariant/813', price: '13.00',
              inventoryPolicy: 'DENY', inventoryQuantity: null },
            { id: 'gid://shopify/ProductVariant/814', price: '14.00',
              inventoryPolicy: 'DENY', inventoryQuantity: -2 },
            { id: 'gid://shopify/ProductVariant/815', price: '15.00',
              inventoryPolicy: 'CONTINUE', inventoryQuantity: -1 },
          ], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected read-only query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.equal(result.traversalVerified, true)
  assert.equal(result.catalogReady, false, 'unpublished variants never enter the public catalog')
  assert.equal(result.catalogVariants, 0)
  assert.equal(result.observedShopifyVariants, 5)
  assert.equal(result.inventoryObservationsIncludeUnpublished, true)
  assert.equal(result.zeroStockDenyVariants, 1)
  assert.equal(result.zeroStockContinueVariants, 1)
  assert.equal(result.negativeStockDenyVariants, 1, 'oversold DENY inventory is not zero or positive stock')
  assert.equal(result.negativeStockContinueVariants, 1, 'oversold CONTINUE may still be made to order')
  assert.equal(result.nonPositiveStockDenyVariants, 2, 'both zero and negative DENY are non-positive')
  assert.equal(result.unknownInventoryQuantityVariants, 1, 'null inventory must not be treated as zero')
  assert.equal(result.sellabilityVerified, false)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE DRAFT|ProductVariant|11\.00|12\.00|13\.00|14\.00|15\.00/)
})

test('read-only inventory audit rejects malformed draft policy or quantity without leaking data', async () => {
  const invalid = [
    { inventoryPolicy: 'UNKNOWN', inventoryQuantity: 0 },
    { inventoryQuantity: 0 },
    { inventoryPolicy: 'DENY', inventoryQuantity: '0' },
    { inventoryPolicy: 'CONTINUE', inventoryQuantity: 0.5 },
    { inventoryPolicy: 'DENY', inventoryQuantity: Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const fields of invalid) {
    const execute = async document => {
      if (document.includes('shop { currencyCode }')) {
        return { data: { shop: { currencyCode: 'USD' } } }
      }
      if (document.includes('VibeCartProductsCount')) {
        return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
      }
      if (document.includes('VibeCartProducts(')) {
        return { data: { products: {
          nodes: [{
            id: 'gid://shopify/Product/910', title: 'PRIVATE DRAFT POLICY FIXTURE',
            status: 'DRAFT', publishedAt: null,
            variantsCount: { count: 1, precision: 'EXACT' },
            variants: { nodes: [{
              id: 'gid://shopify/ProductVariant/911', title: 'Private draft',
              sku: 'PRIVATE-DRAFT-SKU', price: '98.76', ...fields,
            }], pageInfo: { hasNextPage: false, endCursor: null } },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } }
      }
      throw new Error('unexpected query')
    }
    await assert.rejects(
      auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' }),
      error => {
        assert.match(error.message, /Shopify audit (?:rejected a variant with missing or invalid inventory policy|incomplete or invalid; private merchant details suppressed)/)
        assert.doesNotMatch(error.message, /PRIVATE|ProductVariant|911|98\.76|DRAFT-SKU/)
        return true
      },
      'unpublished malformed inventory evidence must not certify a complete audit',
    )
  }
})

test('read-only audit rejects missing or invalid inventory policy without leaking variant identities', async () => {
  for (const inventoryPolicy of [undefined, 'UNKNOWN']) {
    const privateVariantId = 'gid://shopify/ProductVariant/777'
    const execute = async document => {
      if (document.includes('shop { currencyCode }')) {
        return { data: { shop: { currencyCode: 'USD' } } }
      }
      if (document.includes('VibeCartProductsCount')) {
        return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
      }
      if (document.includes('VibeCartProducts(')) {
        return { data: { products: {
          nodes: [{
            id: 'gid://shopify/Product/700', title: 'PRIVATE SYNTHETIC POLICY',
            status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
            featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
            variantsCount: { count: 2, precision: 'EXACT' },
            variants: { nodes: [
              { id: 'gid://shopify/ProductVariant/701', title: 'Valid',
                price: '9.99', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
              { id: privateVariantId, title: 'Unknown',
                sku: 'PRIVATE-UNKNOWN-POLICY', price: '10.99',
                ...(inventoryPolicy ? { inventoryPolicy } : {}), inventoryQuantity: 0 },
            ], pageInfo: { hasNextPage: false, endCursor: null } },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } }
      }
      throw new Error('unexpected query')
    }
    await assert.rejects(
      auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' }),
      error => {
        assert.match(error.message, /Shopify audit rejected (?:a variant|1 variant) with missing or invalid inventory policy/)
        assert.doesNotMatch(error.message, /ProductVariant|PRIVATE-|777|10\.99/)
        return true
      },
      'a missing/unknown policy must block the whole merchant audit, not just one variant',
    )
  }
})


test('read-only audit suppresses variant IDs and unexpected transport details in every failure path', async () => {
  const privateId = 'gid://shopify/ProductVariant/99009'
  const privateSku = 'SENSITIVE-SYNTHETIC-SKU'
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    if (document.includes('VibeCartProductsCount')) return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    if (document.includes('VibeCartProducts(')) {
      const variant = { id: privateId, sku: privateSku, title: 'Synthetic',
        price: '123.45', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 }
      return { data: { products: { nodes: [{
        id: 'gid://shopify/Product/99001', title: 'PRIVATE SYNTHETIC PRODUCT',
        status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
        variantsCount: { count: 2, precision: 'EXACT' },
        variants: { nodes: [variant, { ...variant }], pageInfo: { hasNextPage: false, endCursor: null } },
      }], pageInfo: { hasNextPage: false, endCursor: null } } } }
    }
    throw new Error('unexpected query')
  }
  const assertPrivateError = error => {
    assert.match(error.message, /Shopify audit incomplete or invalid; private merchant details suppressed/)
    assert.doesNotMatch(error.message, /ProductVariant|99009|SENSITIVE-|123\.45|PRIVATE SYNTHETIC|secret/)
    return true
  }
  await assert.rejects(auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' }), assertPrivateError)
  await assert.rejects(auditShopifyCatalogReadOnly({
    execute: async () => { throw new Error('private secret: sk_test_NEVER_PRINT') },
    expectedCurrencyCode: 'USD',
  }), assertPrivateError)
})

test('read-only audit fails on currency mismatch or independently incomplete Shopify product count', async () => {
  const currency = async document => {
    if (document.includes('shop { currencyCode }')) return { data: { shop: { currencyCode: 'USD' } } }
    if (document.includes('VibeCartProductsCount')) return { data: { productsCount: { count: 2, precision: 'EXACT' } } }
    return { data: { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
  }
  await assert.rejects(auditShopifyCatalogReadOnly({ execute: currency, expectedCurrencyCode: 'EUR' }), /does not match/)
  await assert.rejects(auditShopifyCatalogReadOnly({ execute: currency, expectedCurrencyCode: 'USD' }), /incomplete/)
})

test('read-only audit does not certify catalog completeness when Shopify records are omitted', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/100', title: 'UNPUBLISHED SYNTHETIC',
          status: 'ACTIVE', publishedAt: null,
          variantsCount: { count: 1, precision: 'EXACT' },
          variants: { nodes: [{
            id: 'gid://shopify/ProductVariant/101', title: 'Red',
            sku: 'PRIVATE-SYN-101', price: '19.99',
            inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
          }], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({
    execute, expectedCurrencyCode: 'USD',
  })
  assert.equal(result.traversalVerified, true, 'exact Shopify traversal succeeded')
  assert.equal(result.catalogReady, false, 'an omitted family must fail catalog acceptance')
  assert.equal(result.verified, false, 'do not claim a fully verified usable catalog')
  assert.equal(result.publishedProductFamilies, 0)
  assert.equal(result.catalogVariants, 0)
  assert.ok(result.skippedRecords > 0)
  assert.match(result.note, /prevent complete VibeCart catalog verification/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SYN-101|UNPUBLISHED SYNTHETIC/)
})


test('read-only audit flags missing Shopify images without exposing private catalog details', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/300', title: 'SYNTHETIC IMAGELESS LIGHT',
          description: 'Synthetic only', status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
          featuredMedia: null, media: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          variantsCount: { count: 2, precision: 'EXACT' },
          variants: { nodes: [{
            id: 'gid://shopify/ProductVariant/301', title: 'Red',
            sku: 'PRIVATE-IMAGELESS-SKU', price: '44.99',
            inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
          }, {
            id: 'gid://shopify/ProductVariant/302', title: 'Amber',
            sku: 'PRIVATE-IMAGELESS-SKU-2', price: '45.99',
            inventoryPolicy: 'DENY', inventoryQuantity: 0,
          }], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.equal(result.traversalVerified, true)
  assert.equal(result.publishedProductFamilies, 1)
  assert.equal(result.catalogVariants, 2)
  assert.equal(result.skippedRecords, 0)
  assert.equal(result.warnings, 0)
  assert.equal(result.missingImages, 2, 'two variants lack images')
  assert.equal(result.productFamiliesWithMissingImages, 1, 'one product family needs image remediation')
  assert.equal(result.catalogReady, false)
  assert.equal(result.verified, false)
  assert.match(result.note, /missing images/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-IMAGELESS-SKU|SYNTHETIC IMAGELESS LIGHT|44\.99|45\.99|ProductVariant/)
})

test('read-only audit follows later media pages and verifies images without leaking merchant data', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 1, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [{
          id: 'gid://shopify/Product/300', title: 'PRIVATE MULTIMEDIA PRODUCT',
          status: 'ACTIVE', publishedAt: '2026-10-18T00:00:00Z',
          updatedAt: '2026-10-18T00:00:00Z', featuredMedia: null,
          media: { nodes: [{ id: 'gid://shopify/Video/999', preview: { image: null } }],
            pageInfo: { hasNextPage: true, endCursor: 'next-media' } },
          variantsCount: { count: 1, precision: 'EXACT' },
          variants: { nodes: [{
            id: 'gid://shopify/ProductVariant/301', price: '44.99',
            sku: 'PRIVATE-MEDIA-SKU', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
          }], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    if (document.includes('VibeCartProductMedia(')) {
      return { data: { product: {
        id: 'gid://shopify/Product/300', updatedAt: '2026-10-18T00:00:00Z',
        media: { nodes: [{ id: 'gid://shopify/MediaImage/1000',
          preview: { image: { url: 'https://cdn.shopify.com/synthetic-later.jpg' } } }],
          pageInfo: { hasNextPage: false, endCursor: 'done' } },
      } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.equal(result.traversalVerified, true, 'the Admin product traversal was exact')
  assert.equal(result.catalogReady, true, 'later image page is verified')
  assert.equal(result.publishedProductFamilies, 1)
  assert.equal(result.catalogVariants, 1)
  assert.equal(result.invalidSkippedRecords, 0)
  assert.equal(result.missingImages, 0, 'later image prevents false missing-image report')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-MULTIMEDIA|PRIVATE-MEDIA-SKU|44\\.99|ProductVariant/)
})

test('empty but EXACT Shopify traversal is not certified as a merchant-ready catalog', async () => {
  const execute = async document => {
    if (document.includes('shop { currencyCode }')) {
      return { data: { shop: { currencyCode: 'USD' } } }
    }
    if (document.includes('VibeCartProductsCount')) {
      return { data: { productsCount: { count: 0, precision: 'EXACT' } } }
    }
    if (document.includes('VibeCartProducts(')) {
      return { data: { products: {
        nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
      } } }
    }
    throw new Error('unexpected query')
  }
  const result = await auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode: 'USD' })
  assert.equal(result.traversalVerified, true, 'zero products is an exact, complete traversal')
  assert.equal(result.publishedProductFamilies, 0)
  assert.equal(result.catalogVariants, 0)
  assert.equal(result.skippedRecords, 0)
  assert.equal(result.warnings, 0)
  assert.equal(result.missingImages, 0)
  assert.equal(result.catalogReady, false, 'empty catalog is not merchant beta readiness')
  assert.equal(result.verified, false)
  assert.match(result.note, /no usable products/)
})


test('read-only audit counts legitimate unpublished exclusions but rejects a malformed published family', async () => {
  const variant = (id, price = '12.00') => ({
    id: 'gid://shopify/ProductVariant/' + id,
    title: 'Red', sku: 'SYNTHETIC-' + id, price,
    inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
  })
  const product = (id, status, publishedAt, price = '12.00') => ({
    id: 'gid://shopify/Product/' + id,
    title: 'SYNTHETIC PRODUCT ' + id,
    status, publishedAt,
    featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.jpg' } } },
    variantsCount: { count: 1, precision: 'EXACT' },
    variants: { nodes: [variant(id + 1000, price)], pageInfo: { hasNextPage: false, endCursor: null } },
  })
  const base = [
    product(100, 'ACTIVE', '2026-10-18T00:00:00Z'),
    product(200, 'DRAFT', null),
    product(300, 'ARCHIVED', '2026-10-18T00:00:00Z'),
  ]
  const run = async products => auditShopifyCatalogReadOnly({
    expectedCurrencyCode: 'USD',
    execute: async document => {
      if (document.includes('shop { currencyCode }')) {
        return { data: { shop: { currencyCode: 'USD' } } }
      }
      if (document.includes('VibeCartProductsCount')) {
        return { data: { productsCount: { count: products.length, precision: 'EXACT' } } }
      }
      if (document.includes('VibeCartProducts(')) {
        return { data: { products: {
          nodes: products,
          pageInfo: { hasNextPage: false, endCursor: null },
        } } }
      }
      throw new Error('unexpected query')
    },
  })
  const valid = await run(base)
  assert.equal(valid.traversalVerified, true)
  assert.equal(valid.verified, true, 'normal draft and archived products do not invalidate a published feed')
  assert.equal(valid.publishedProductFamilies, 1)
  assert.equal(valid.catalogVariants, 1)
  assert.equal(valid.skippedRecords, 2)
  assert.equal(valid.excludedUnpublished, 2)
  assert.equal(valid.invalidSkippedRecords, 0)
  assert.doesNotMatch(JSON.stringify(valid), /SYNTHETIC PRODUCT|SYNTHETIC-1100/)

  const invalid = await run([...base, product(400, 'ACTIVE', '2026-10-18T00:00:00Z', '12.345')])
  assert.equal(invalid.traversalVerified, true)
  assert.equal(invalid.verified, false, 'a rejected published variant must still block readiness')
  assert.equal(invalid.excludedUnpublished, 2)
  assert.ok(invalid.invalidSkippedRecords > 0)
  assert.equal(invalid.publishedProductFamilies, 1)
  assert.equal(invalid.catalogVariants, 1)
})

test('read-only transport retries only bounded Shopify throttling without exceeding request budget', async () => {
  const ok = () => json({ data: { shop: { currencyCode: 'USD' } } })
  const throttled = () => new Response('', { status: 429, headers: { 'retry-after': '0' } })
  const graphqlThrottle = () => json({ errors: [{ message: 'throttled', extensions: { code: 'THROTTLED' } }] })

  for (const responses of [[throttled, ok], [graphqlThrottle, ok]]) {
    let calls = 0
    const delays = []
    const execute = createReadOnlyShopifyTransport({
      ...opts,
      sleepImpl: async ms => { delays.push(ms) },
      fetchImpl: async () => responses[calls++](),
    })
    assert.deepEqual(await execute(READ, {}), { data: { shop: { currencyCode: 'USD' } } })
    assert.equal(calls, 2)
    assert.deepEqual(delays, [responses[0] === throttled ? 0 : 250])
  }

  for (const responses of [[throttled, throttled, throttled], [graphqlThrottle, graphqlThrottle, graphqlThrottle]]) {
    let calls = 0
    const execute = createReadOnlyShopifyTransport({
      ...opts,
      sleepImpl: async () => {},
      fetchImpl: async () => responses[calls++](),
    })
    await assert.rejects(execute(READ, {}), /bounded retries exhausted/)
    assert.equal(calls, 3, 'retry count is bounded')
  }

  let calls = 0
  const execute = createReadOnlyShopifyTransport({
    ...opts, maxRequests: 1,
    sleepImpl: async () => {},
    fetchImpl: async () => { calls++; return throttled() },
  })
  await assert.rejects(execute(READ, {}), /request limit reached/)
  assert.equal(calls, 1, 'retry attempts must count toward the hard request budget')

  for (const response of [
    new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    new Response('', { status: 503 }),
  ]) {
    let attempts = 0
    const execute = createReadOnlyShopifyTransport({
      ...opts,
      sleepImpl: async () => { throw new Error('unexpected retry') },
      fetchImpl: async () => { attempts++; return response },
    })
    await assert.rejects(execute(READ, {}), /Shopify audit/)
    assert.equal(attempts, 1, 'do not retry long Retry-After or non-throttle failures')
  }

  let errorCalls = 0
  const otherError = json({ errors: [{ message: 'bad query', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })
  const noRetry = createReadOnlyShopifyTransport({
    ...opts,
    sleepImpl: async () => { throw new Error('unexpected retry') },
    fetchImpl: async () => { errorCalls++; return otherError },
  })
  assert.deepEqual(await noRetry(READ, {}), { errors: [{ message: 'bad query', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })
  assert.equal(errorCalls, 1, 'non-throttle GraphQL errors must not be retried')
})


test('read-only transport rejects oversized declared Content-Length without buffering', async () => {
  let canceled = false
  const stream = new ReadableStream({
    cancel() { canceled = true },
  })
  const execute = createReadOnlyShopifyTransport({
    ...opts,
    fetchImpl: async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
    }),
  })
  await assert.rejects(execute(READ, {}), /Shopify audit response too large/)
  assert.equal(canceled, true, 'oversized declared response must be canceled')
})

test('read-only transport bounds Admin response by UTF-8 bytes, not JavaScript characters', async () => {
  // 530,000 non-ASCII characters exceed 1 MiB in UTF-8 even though
  // their JavaScript string length is below the former character cap.
  const execute = createReadOnlyShopifyTransport({
    ...opts,
    fetchImpl: async () => json({ data: { synthetic: 'é'.repeat(530000) } }),
  })
  await assert.rejects(execute(READ, {}), /Shopify audit response too large/)
})

test('read-only transport cancels streaming responses immediately after crossing the byte cap', async () => {
  let canceled = false
  let chunks = 0
  const stream = new ReadableStream({
    pull(controller) {
      chunks++
      controller.enqueue(new Uint8Array(600000).fill(65))
    },
    cancel() { canceled = true },
  }, { highWaterMark: 0 })
  const execute = createReadOnlyShopifyTransport({
    ...opts,
    fetchImpl: async () => new Response(stream, {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  })
  await assert.rejects(execute(READ, {}), /Shopify audit response too large/)
  assert.equal(canceled, true)
  assert.ok(chunks <= 3, 'reader must stop rather than download the full response')
})

test('read-only transport accepts valid JSON split across UTF-8 stream chunks', async () => {
  const expected = { data: { synthetic: 'valid' } }
  const bytes = new TextEncoder().encode(JSON.stringify(expected))
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 9))
      controller.enqueue(bytes.subarray(9))
      controller.close()
    },
  })
  const execute = createReadOnlyShopifyTransport({
    ...opts,
    fetchImpl: async () => new Response(stream, {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  })
  assert.deepEqual(await execute(READ, {}), expected)
})
