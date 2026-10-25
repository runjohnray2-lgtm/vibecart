import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditShopifyCatalogReadOnly,
  createReadOnlyShopifyTransport,
} from '../scripts/audit-shopify-catalog-readonly.mjs'

const READ = 'query VibeCartProducts { shop { currencyCode } }'
const COUNT = 'query VibeCartProductsCount { productsCount(limit: null) { count precision } }'
const DOCS = new Set([READ, COUNT, 'query VibeCartProductVariants { shop { id } }', 'query VibeCartShopCurrency { shop { currencyCode } }'])
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
    const documents = new Set([...DOCS].slice(0, 3).concat(unsafe))
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
  assert.equal(calls.length, 3)
  assert.ok(calls.every(c => c.document.trim().startsWith('query ')))
  assert.doesNotMatch(JSON.stringify(result), /SYN-101|SYNTHETIC test light|65\.99|ProductVariant/)
  assert.match(result.note, /MCP\/UCP.*NOT verified/)
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
          featuredMedia: null, media: { nodes: [] },
          variantsCount: { count: 1, precision: 'EXACT' },
          variants: { nodes: [{
            id: 'gid://shopify/ProductVariant/301', title: 'Red',
            sku: 'PRIVATE-IMAGELESS-SKU', price: '44.99',
            inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
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
  assert.equal(result.catalogVariants, 1)
  assert.equal(result.skippedRecords, 0)
  assert.equal(result.warnings, 0)
  assert.equal(result.missingImages, 1)
  assert.equal(result.catalogReady, false)
  assert.equal(result.verified, false)
  assert.match(result.note, /missing images/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-IMAGELESS-SKU|SYNTHETIC IMAGELESS LIGHT|44\.99|ProductVariant/)
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
  const ok = json({ data: { shop: { currencyCode: 'USD' } } })
  const throttled = new Response('', { status: 429, headers: { 'retry-after': '0' } })
  const graphqlThrottle = json({ errors: [{ message: 'throttled', extensions: { code: 'THROTTLED' } }] })

  for (const responses of [[throttled, ok], [graphqlThrottle, ok]]) {
    let calls = 0
    const delays = []
    const execute = createReadOnlyShopifyTransport({
      ...opts,
      sleepImpl: async ms => { delays.push(ms) },
      fetchImpl: async () => responses[calls++],
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
      fetchImpl: async () => responses[calls++],
    })
    await assert.rejects(execute(READ, {}), /bounded retries exhausted/)
    assert.equal(calls, 3, 'retry count is bounded')
  }

  let calls = 0
  const execute = createReadOnlyShopifyTransport({
    ...opts, maxRequests: 1,
    sleepImpl: async () => {},
    fetchImpl: async () => { calls++; return throttled },
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
