import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const code = await readFile('lib/shopify-variant-pages.ts', 'utf8')
const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exportsObject = {}
new Function('exports', js)(exportsObject)
const { hydrateShopifyProductVariants: hydrate, withHydratedShopifyVariants: wrap, SHOPIFY_VARIANTS_QUERY } = exportsObject

const P = 'gid://shopify/Product/99'
const V = n => ({ id: 'gid://shopify/ProductVariant/' + n, title: 'Size ' + n, sku: 'SKU-' + n, price: '12.34', inventoryPolicy: n % 2 ? 'CONTINUE' : 'DENY', inventoryQuantity: 0 })
const product = (size, more = true, cursor = 'c100') => ({
  id: P, title: 'Synthetic test product', publishedAt: '2026-10-18T00:00:00Z',
  variants: { nodes: Array.from({ length: size }, (_, i) => V(i + 1)), pageInfo: { hasNextPage: more, endCursor: cursor } },
})
const options = fetchVariantPage => ({ fetchVariantPage })

test('complete 225-variant pagination preserves IDs, SKUs, exact prices and inventory policy', async () => {
  const raw = product(100)
  const before = structuredClone(raw)
  const cursors = []
  const result = await hydrate(raw, options(async (id, cursor) => {
    assert.equal(id, P)
    cursors.push(cursor)
    if (cursor === 'c100') return { productId: id, variants: { nodes: Array.from({ length: 100 }, (_, i) => V(i + 101)), pageInfo: { hasNextPage: true, endCursor: 'c200' } } }
    if (cursor === 'c200') return { productId: id, variants: { nodes: Array.from({ length: 25 }, (_, i) => V(i + 201)), pageInfo: { hasNextPage: false, endCursor: 'c225' } } }
    throw new Error('unexpected cursor')
  }))
  assert.deepEqual(cursors, ['c100', 'c200'])
  assert.equal(result.variants.nodes.length, 225)
  assert.deepEqual(result.variants.nodes[224], V(225))
  assert.equal(result.variants.nodes[0].inventoryPolicy, 'CONTINUE')
  assert.equal(result.variants.nodes[1].inventoryPolicy, 'DENY')
  assert.equal(result.variants.pageInfo.hasNextPage, false)
  assert.deepEqual(raw, before)
})

test('150, 189 and 174 variant families are not silently truncated', async () => {
  for (const count of [150, 189, 174]) {
    const result = await hydrate(product(100), options(async id => ({
      productId: id,
      variants: { nodes: Array.from({ length: count - 100 }, (_, i) => V(i + 101)), pageInfo: { hasNextPage: false, endCursor: 'done' } },
    })))
    assert.equal(result.variants.nodes.length, count)
  }
})

test('complete single page does not fetch additional variants', async () => {
  const result = await hydrate(product(100, false), options(async () => { throw new Error('unexpected fetch') }))
  assert.equal(result.variants.nodes.length, 100)
})

test('rejects missing or invalid Admin inventory policy on initial and continuation pages', async () => {
  const noFetch = options(async () => { throw new Error('unexpected continuation fetch') })
  for (const policy of [undefined, null, 'UNKNOWN', 'deny']) {
    const initial = product(1, false)
    initial.variants.nodes[0] = { ...V(1), inventoryPolicy: policy }
    await assert.rejects(hydrate(initial, noFetch), /missing or invalid inventoryPolicy/)

    await assert.rejects(hydrate(product(100), options(async productId => ({
      productId,
      variants: {
        nodes: [{ ...V(101), inventoryPolicy: policy }],
        pageInfo: { hasNextPage: false, endCursor: 'done' },
      },
    }))), /missing or invalid inventoryPolicy/)
  }
})

test('rejects duplicate variant IDs across pages', async () => {
  await assert.rejects(hydrate(product(100), options(async id => ({
    productId: id, variants: { nodes: [V(100)], pageInfo: { hasNextPage: false } },
  }))), /duplicate Shopify variant id/)
})

test('rejects cursor loops and missing continuation cursor', async () => {
  await assert.rejects(hydrate(product(100), options(async id => ({
    productId: id, variants: { nodes: [V(101)], pageInfo: { hasNextPage: true, endCursor: 'c100' } },
  }))), /cursor did not advance/)
  await assert.rejects(hydrate(product(100, true, null), options(async () => { throw new Error('unexpected fetch') })), /cursor did not advance/)
})

test('rejects cross-product pagination results', async () => {
  await assert.rejects(hydrate(product(100), options(async () => ({
    productId: 'gid://shopify/Product/other', variants: { nodes: [V(101)], pageInfo: { hasNextPage: false } },
  }))), /product id mismatch/)
})

test('rejects empty continuation and missing IDs', async () => {
  await assert.rejects(hydrate(product(100), options(async id => ({
    productId: id, variants: { nodes: [], pageInfo: { hasNextPage: false } },
  }))), /empty Shopify continuation/)
  await assert.rejects(hydrate(product(100), options(async id => ({
    productId: id, variants: { nodes: [{ title: 'bad' }], pageInfo: { hasNextPage: false } },
  }))), /invalid variant id/)
})

test('rejects malformed Shopify GIDs on initial and continuation pages', async () => {
  const noFetch = options(async () => { throw new Error('unexpected continuation fetch') })
  for (const id of [
    'gid://shopify/ProductVariant/99',
    'gid://shopify/Product/0',
    'gid://shopify/Product/-1',
    'gid://shopify/Product/not-a-number',
    '99',
  ]) {
    await assert.rejects(hydrate({ ...product(1, false), id }, noFetch), /Shopify Product gid/)
  }
  for (const id of [
    'gid://shopify/Product/1',
    'gid://shopify/ProductVariant/0',
    'gid://shopify/ProductVariant/not-a-number',
    'gid://shopify/ProductVariant/1?foo=bar',
    '1',
  ]) {
    const raw = product(1, false)
    raw.variants.nodes[0] = { ...V(1), id }
    await assert.rejects(hydrate(raw, noFetch), /invalid variant id/)
  }
  await assert.rejects(hydrate(product(100), options(async productId => ({
    productId,
    variants: {
      nodes: [{ ...V(101), id: 'gid://shopify/Product/101' }],
      pageInfo: { hasNextPage: false },
    },
  }))), /invalid variant id/)
})

test('rejects unsafe limits and oversized catalogs', async () => {
  await assert.rejects(hydrate(product(100), { ...options(async () => ({})), maxVariantPages: 1 }), /page limit exceeded/)
  await assert.rejects(hydrate(product(100), { ...options(async id => ({
    productId: id, variants: { nodes: [V(101)], pageInfo: { hasNextPage: false } },
  })), maxVariantsPerProduct: 100 }), /count exceeds limit/)
  await assert.rejects(hydrate(product(100), { ...options(async () => ({})), maxVariantPages: 0 }), /invalid Shopify variant pagination limits/)
})

test('propagates failed Shopify page request without returning partial catalog', async () => {
  await assert.rejects(hydrate(product(100), options(async () => { throw new Error('Shopify 429') })), /Shopify 429/)
})

test('wrap hydrates every product before returning the page without mutating source', async () => {
  const raw = { products: [product(100), { ...product(2, false), id: 'gid://shopify/Product/100' }], pageInfo: { hasNextPage: false } }
  const before = structuredClone(raw)
  const fetch = wrap(async () => raw, options(async id => ({
    productId: id, variants: { nodes: [V(101)], pageInfo: { hasNextPage: false } },
  })))
  const page = await fetch(null)
  assert.equal(page.products[0].variants.nodes.length, 101)
  assert.equal(page.products[1].variants.nodes.length, 2)
  assert.deepEqual(raw, before)
})

test('a failed product aborts the entire product page', async () => {
  const fetch = wrap(async () => ({
    products: [{ ...product(2, false), id: 'gid://shopify/Product/1' }, product(100)],
    pageInfo: { hasNextPage: false },
  }), options(async () => { throw new Error('failed continuation') }))
  await assert.rejects(fetch(null), /failed continuation/)
})

test('reference query uses read-only Admin fields, not unavailable variant.image', () => {
  assert.match(SHOPIFY_VARIANTS_QUERY, /variants\(first: 100, after: \$cursor\)/)
  assert.match(SHOPIFY_VARIANTS_QUERY, /inventoryPolicy/)
  assert.doesNotMatch(SHOPIFY_VARIANTS_QUERY, /featuredImage|\bimage\s*\{/)
  assert.doesNotMatch(SHOPIFY_VARIANTS_QUERY, /mutation|checkout|orderCreate/i)
})
