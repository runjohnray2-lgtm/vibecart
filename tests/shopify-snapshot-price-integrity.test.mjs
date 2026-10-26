import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

// Synthetic data only: no Shopify API, merchant secrets, network or payments.
const modules = await loadTsModules([
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
])
const { applyProducts, createSnapshot, toCatalogFeed } = modules['shopify-catalog-sync']

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
