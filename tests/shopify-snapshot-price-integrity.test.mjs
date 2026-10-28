import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// Synthetic data only: no Shopify API, merchant secrets, network or payments.
const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
])
const { applyProducts, buildVariantIndex, createSnapshot, toCatalogFeed } = modules['shopify-catalog-sync']

const raw = {
  id: 123,
  title: 'SYNTHETIC product',
  status: 'ACTIVE',
  published_at: '2026-10-25T00:00:00Z',
  variants: [{ id: 456, title: 'Default Title', sku: 'SYN-456', price: '19.99', inventoryPolicy: 'DENY' }],
}

test('public feed rejects reconstructed snapshot prices that cannot represent exact cents', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const trusted = toCatalogFeed(base)
  assert.equal(trusted.products.length, 1)
  assert.equal(trusted.products[0].priceCents, 1999)

  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1999', undefined, null]) {
    const malformed = {
      ...base,
      products: new Map([['123', [{ ...base.products.get('123')[0], priceCents: bad }]]]),
    }
    assert.throws(() => toCatalogFeed(malformed), /invalid Shopify snapshot priceCents/, String(bad))
    assert.deepEqual(toCatalogFeed(base), trusted, 'bad reconstructed snapshot must not mutate last-good data')
  }
})

test('server-only Shopify variant index rejects corrupted restored cents without changing trusted data', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const trustedIndex = buildVariantIndex(base)
  assert.equal(trustedIndex.get('456').variantId, '456')

  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1999', undefined, null]) {
    const malformed = {
      ...base,
      products: new Map([['123', [{ ...base.products.get('123')[0], priceCents: bad }]]]),
    }
    assert.throws(() => buildVariantIndex(malformed), /invalid Shopify snapshot priceCents/,
      'server-side identity index must not trust malformed merchant prices')
    assert.equal(buildVariantIndex(base).get('456').variantId, '456',
      'rejected restored snapshot must leave last-good identity index intact')
  }
  for (const valid of [0, 1, 1999, Number.MAX_SAFE_INTEGER]) {
    const snapshot = {
      ...base,
      products: new Map([['123', [{ ...base.products.get('123')[0], priceCents: valid }]]]),
    }
    assert.equal(buildVariantIndex(snapshot).get('456').variantId, '456')
  }
})

test('public feed continues to accept exact nonnegative integer cents including zero', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  for (const priceCents of [0, 1, 1999, Number.MAX_SAFE_INTEGER]) {
    const snapshot = {
      ...base,
      products: new Map([['123', [{ ...base.products.get('123')[0], priceCents }]]]),
    }
    assert.equal(toCatalogFeed(snapshot).products[0].priceCents, priceCents)
  }
})


test('public feed rejects malformed or credential-bearing images in reconstructed snapshots', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const trusted = toCatalogFeed(base)
  for (const image of [
    null, undefined, 7, 'http://cdn.shopify.com/product.jpg',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://',
    'https://operator:private@cdn.shopify.com/product.jpg',
    'https://cdn.shopify.com/' + 'x'.repeat(2001),
  ]) {
    const malformed = {
      ...base,
      products: new Map([['123', [{ ...base.products.get('123')[0], image }]]]),
    }
    assert.throws(() => toCatalogFeed(malformed), /invalid Shopify snapshot image/, String(image))
    assert.deepEqual(toCatalogFeed(base), trusted, 'bad restored snapshot must not alter the last-good feed')
  }
})

test('public feed permits missing images for diagnostics and normal HTTPS product images', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  for (const image of ['', 'https://cdn.shopify.com/synthetic-product.jpg']) {
    const restored = {
      ...base,
      products: new Map([['123', [{ ...base.products.get('123')[0], image }]]]),
    }
    assert.equal(toCatalogFeed(restored).products[0].image, image)
  }
})

test('restored Shopify snapshot display fields must satisfy the public catalog contract', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const original = toCatalogFeed(base)
  const good = base.products.get('123')[0]
  const invalid = [
    ['name', '', /invalid Shopify snapshot name/],
    ['name', '   ', /invalid Shopify snapshot name/],
    ['name', null, /invalid Shopify snapshot name/],
    ['name', 'x'.repeat(501), /invalid Shopify snapshot name/],
    ['description', null, /invalid Shopify snapshot description/],
    ['description', 42, /invalid Shopify snapshot description/],
    ['description', 'x'.repeat(5001), /invalid Shopify snapshot description/],
    ['variant', '', /invalid Shopify snapshot variant title/],
    ['variant', '   ', /invalid Shopify snapshot variant title/],
    ['variant', null, /invalid Shopify snapshot variant title/],
    ['variant', 'x'.repeat(501), /invalid Shopify snapshot variant title/],
  ]
  for (const [field, value, expected] of invalid) {
    const corrupted = {
      ...base,
      products: new Map([['123', [{ ...good, [field]: value }]]]),
    }
    assert.throws(() => toCatalogFeed(corrupted), expected, field)
    assert.deepEqual(toCatalogFeed(base), original, 'last-good snapshot remains unchanged')
  }
  const accepted = {
    ...base,
    products: new Map([['123', [{
      ...good, name: 'SYNTHETIC valid product', description: '', variant: 'Small',
    }]]]),
  }
  assert.equal(toCatalogFeed(accepted).products[0].variant, 'Small')
})

test('restored Shopify snapshot currency must be supported and canonical before feed or index exposure', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const trustedFeed = toCatalogFeed(base)
  const trustedIndex = buildVariantIndex(base)
  const invalidCurrencies = [undefined, null, '', 'usd', ' USD ', 'US D', 'ZZZ', 'ABC', 'XTS', 'JPY', 'KWD', 42]
  for (const currencyCode of invalidCurrencies) {
    const corrupted = { ...base, currencyCode }
    assert.throws(() => toCatalogFeed(corrupted), /currencyCode|currency .*not (?:a )?supported/,
      'public catalog must reject invalid restored currency: ' + String(currencyCode))
    assert.throws(() => buildVariantIndex(corrupted), /currencyCode|currency .*not (?:a )?supported/,
      'server-side variant index must reject invalid restored currency: ' + String(currencyCode))
    assert.deepEqual(toCatalogFeed(base), trustedFeed, 'last-good feed must remain unchanged')
    assert.deepEqual(buildVariantIndex(base), trustedIndex, 'last-good index must remain unchanged')
  }
  assert.equal(toCatalogFeed(base).products[0].priceCents, 1999)
  assert.equal(buildVariantIndex(base).get('456').inventoryPolicy, 'DENY')
})

test('server-only variant index rejects restored display fields excluded by the public feed', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const good = base.products.get('123')[0]
  const trustedIndex = buildVariantIndex(base)
  const trustedFeed = toCatalogFeed(base)
  const invalid = [
    ['name', '', /invalid Shopify snapshot name/],
    ['name', null, /invalid Shopify snapshot name/],
    ['name', 'x'.repeat(501), /invalid Shopify snapshot name/],
    ['description', 7, /invalid Shopify snapshot description/],
    ['description', 'x'.repeat(5001), /invalid Shopify snapshot description/],
    ['variant', '   ', /invalid Shopify snapshot variant title/],
    ['variant', 'x'.repeat(501), /invalid Shopify snapshot variant title/],
    ['image', 'http://cdn.shopify.com/unsafe.jpg', /invalid Shopify snapshot image/],
    ['image', 'https://operator:private@cdn.shopify.com/unsafe.jpg', /invalid Shopify snapshot image/],
    ['image', null, /invalid Shopify snapshot image/],
  ]
  for (const [field, value, expected] of invalid) {
    const corrupted = {
      ...base,
      products: new Map([['123', [{ ...good, [field]: value }]]]),
    }
    assert.throws(() => toCatalogFeed(corrupted), expected, field + ' feed')
    assert.throws(() => buildVariantIndex(corrupted), expected, field + ' index')
    assert.deepEqual(buildVariantIndex(base), trustedIndex, 'last-good index must be unchanged')
    assert.deepEqual(toCatalogFeed(base), trustedFeed, 'last-good feed must be unchanged')
  }
  const valid = {
    ...base,
    products: new Map([['123', [{
      ...good, name: 'SYNTHETIC updated', description: '', variant: 'Small',
      image: 'https://cdn.shopify.com/synthetic.jpg',
    }]]]),
  }
  assert.equal(buildVariantIndex(valid).get('456').variantId, '456')
  assert.equal(toCatalogFeed(valid).products[0].variant, 'Small')
})


test('server-only variant index obeys the public 10,000-variant cap for restored snapshots', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const template = base.products.get('123')[0]
  const variants = Array.from({ length: 10_001 }, (_, offset) => {
    const variantId = String(20000 + offset)
    return {
      ...template,
      id: variantId,
      shopify: { ...template.shopify, variantId },
    }
  })
  const snapshot = { ...base, products: new Map([['123', variants]]) }
  assert.equal(buildVariantIndex({ ...snapshot, products: new Map([['123', variants.slice(0, 10_000)]]) }).size, 10_000)
  assert.throws(() => toCatalogFeed(snapshot), /catalog would exceed 10000 products/)
  assert.throws(() => buildVariantIndex(snapshot), /Shopify variant index exceeds 10000 products/,
    'the server-only lookup must not accept more variants than the public feed can expose')
  assert.equal(buildVariantIndex(base).size, 1, 'the rejected oversized snapshot leaves trusted data intact')
})

test('restored Shopify snapshots reject empty or malformed product families without silent omissions', () => {
  const base = applyProducts(createSnapshot('USD'), [raw]).snapshot
  const trustedFeed = toCatalogFeed(base)
  const trustedIndex = buildVariantIndex(base)
  assert.equal(trustedFeed.products.length, 1)
  assert.equal(trustedIndex.size, 1)

  // A restored map entry means Shopify had a product family. Silently
  // skipping it would make both the public feed and internal index appear
  // complete even though its entire variant list has disappeared.
  for (const variants of [[], null, {}, 'corrupted']) {
    const restored = {
      ...base,
      products: new Map([['123', base.products.get('123')], ['999', variants]]),
    }
    assert.throws(() => toCatalogFeed(restored), /Shopify snapshot family has no valid variants/,
      'public feed must reject an incomplete restored family')
    assert.throws(() => buildVariantIndex(restored), /Shopify snapshot family has no valid variants/,
      'server-side index must reject the same incomplete restored family')
    assert.deepEqual(toCatalogFeed(base), trustedFeed, 'last-good feed remains intact')
    assert.deepEqual(buildVariantIndex(base), trustedIndex, 'last-good index remains intact')
  }
})
