import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as fixtures from './fixtures/shopify-products.mjs'
import { assertCatalogContract, loadTsModules } from './helpers/shopify-test-utils.mjs'

const sourcePath = 'lib/shopify-catalog-mapper.ts'
const source = fs.readFileSync(sourcePath, 'utf8')
const modules = await loadTsModules([sourcePath])
const { mapShopifyProducts, normalizeCurrency, priceToCents, shopifyId } = modules['shopify-catalog-mapper']
const USD = { currencyCode: 'USD' }

const ALL = [
  fixtures.restMultiVariant,
  fixtures.defaultTitleOnly,
  fixtures.graphqlEdges,
  fixtures.floatTraps,
  fixtures.archivedProduct,
  fixtures.noVariants,
  fixtures.badVariants,
]

function byId(result, id) {
  return result.products.find(product => product.id === id)
}

test('REST multi-variant product keeps real ids, SKUs and exact cents', () => {
  const result = mapShopifyProducts([fixtures.restMultiVariant], USD)
  assert.equal(result.skipped.length, 0)
  assert.equal(result.products.length, 3)

  const small = byId(result, '41000000000001')
  assert.equal(small.name, 'Trail Jacket')
  assert.equal(small.variant, 'Small / Blue')
  assert.equal(small.sku, 'TJ-S-BL')
  assert.equal(small.priceCents, 12900)
  assert.deepEqual(small.shopify, { productId: '7234567890123', variantId: '41000000000001' })
  assert.equal(small.description, 'Warm & light Packable')
  assert.equal(small.image, 'https://cdn.shopify.com/s/files/1/0001/jacket-blue-small.jpg')

  const medium = byId(result, '41000000000002')
  assert.equal(medium.priceCents, 12950)
  assert.equal(medium.image, 'https://cdn.shopify.com/s/files/1/0001/jacket-front.jpg')

  const large = byId(result, '41000000000003')
  assert.equal(large.priceCents, 10)
  assert.equal('sku' in large, false, 'empty SKU must not be invented')
})

test('missing optional fields are left empty, never invented', () => {
  const result = mapShopifyProducts([fixtures.defaultTitleOnly], USD)
  assert.equal(result.skipped.length, 0)
  const [only] = result.products
  assert.equal(only.id, '42000000000001')
  assert.equal(only.priceCents, 1900)
  assert.equal(only.description, '')
  assert.equal(only.image, '')
  assert.equal('variant' in only, false, 'Default Title is not a real variant name')
  assert.equal('sku' in only, false)
  assert.deepEqual(only.shopify, { productId: '8000000000001', variantId: '42000000000001' })
})

test('GraphQL edges/nodes, Money objects and image precedence', () => {
  const result = mapShopifyProducts({ products: { edges: [{ node: fixtures.graphqlEdges }] } }, USD)
  assert.equal(result.skipped.length, 0)
  const gold = byId(result, 'gid://shopify/ProductVariant/43000000000001')
  const silver = byId(result, 'gid://shopify/ProductVariant/43000000000002')
  assert.equal(gold.priceCents, 123456)
  assert.equal(gold.sku, 'PIN-GOLD')
  assert.equal(gold.image, 'https://cdn.shopify.com/s/files/1/0002/pin.png')
  assert.equal(gold.description, 'Hard enamel, 1.5 inch.')
  assert.equal(silver.priceCents, 820)
  assert.equal(silver.image, 'https://cdn.shopify.com/s/files/1/0002/pin-silver.png')
  assert.equal(gold.shopify.productId, 'gid://shopify/Product/9100000000001')
})

test('price conversion is exact where parseFloat * 100 is not', () => {
  const table = [
    ['19.99', 1999],
    ['1.15', 115],
    ['0.29', 29],
    ['4.35', 435],
    ['0', 0],
    ['0.00', 0],
    ['7', 700],
    ['7.5', 750],
    ['7.50', 750],
    ['7.500', 750],
    ['1234567.89', 123456789],
    [' 12.30 ', 1230],
  ]
  for (const [input, expected] of table) assert.equal(priceToCents(input), expected, input)
  assert.equal(mapShopifyProducts([fixtures.floatTraps], USD).products.map(p => p.priceCents).join(','), '1999,115,29,435')
})

test('price conversion rejects anything it cannot represent exactly', () => {
  for (const bad of ['12.345', '-1.00', '1e3', '1,234.00', '$5', '', ' ', '.5', '5.', 'abc', '99999999999999.00']) {
    assert.throws(() => priceToCents(bad), undefined, JSON.stringify(bad))
  }
  assert.throws(() => priceToCents(19.99), /decimal string/)
  assert.throws(() => priceToCents(undefined), /missing/)
  assert.throws(() => priceToCents(null), /missing/)
})

test('unmappable items are skipped with a reason and valid siblings survive', () => {
  const result = mapShopifyProducts(ALL, USD)
  const reasons = result.skipped.map(item => item.reason)
  assert.ok(reasons.some(r => /more than two decimal/.test(r)))
  assert.ok(reasons.some(r => /price is missing/.test(r)))
  assert.ok(reasons.some(r => /decimal string, not a number/.test(r)))
  assert.ok(reasons.some(r => /EUR does not match expected USD/.test(r)))
  assert.ok(reasons.some(r => /variant id is missing/.test(r)))
  assert.ok(reasons.some(r => /duplicate variant id/.test(r)))
  assert.ok(reasons.some(r => /non-negative decimal/.test(r)))
  assert.ok(reasons.some(r => /status is archived/.test(r)))
  assert.ok(reasons.some(r => /no variants/.test(r)))

  const ok = byId(result, '46000000000008')
  assert.equal(ok.sku, 'OK-1')
  assert.equal(ok.priceCents, 500)
  assert.equal(byId(result, '46000000000001'), undefined)
  assert.equal(byId(result, '45000000000001'), undefined)
  assert.equal(byId(result, '44000000000001').priceCents, 1999)
})

test('a different shop currency is honored but embedded currencies are never converted', () => {
  const eur = { id: 1, title: 'EU', variants: [{ id: 2, title: 'x', price: { amount: '10.00', currencyCode: 'EUR' } }] }
  assert.equal(mapShopifyProducts([eur], USD).products.length, 0)
  const mapped = mapShopifyProducts([eur], { currencyCode: 'eur' })
  assert.equal(mapped.products[0].priceCents, 1000)
})

test('Money prices without a currencyCode fail closed instead of inheriting USD', () => {
  const product = {
    id: 991, title: 'SYNTHETIC currency check',
    variants: [
      { id: 9911, price: { amount: '10.00' } },
      { id: 9912, priceV2: { amount: '11.00', currencyCode: ' ' } },
      { id: 9913, priceV2: { amount: '12.00', currencyCode: 42 } },
      { id: 9914, priceV2: { amount: '13.00', currencyCode: 'USD' } },
      { id: 9915, price: '14.00' },
    ],
  }
  const result = mapShopifyProducts([product], USD)
  assert.deepEqual(result.products.map(p => p.id), ['9914', '9915'])
  assert.deepEqual(result.products.map(p => p.priceCents), [1300, 1400])
  assert.equal(result.skipped.length, 3)
  for (const skipped of result.skipped) assert.match(skipped.reason, /price currencyCode is missing/)
})

test('conflicting dual Shopify price fields fail closed instead of silently choosing one', () => {
  const product = {
    id: 992, title: 'SYNTHETIC dual-price check',
    variants: [
      { id: 9921, price: '10.00', priceV2: { amount: '10.00', currencyCode: 'USD' } },
      { id: 9922, price: '10.00', priceV2: { amount: '11.00', currencyCode: 'USD' } },
      { id: 9923, price: '10.00', priceV2: { amount: '10.00', currencyCode: 'EUR' } },
      { id: 9924, price: { amount: '9.50', currencyCode: 'USD' }, priceV2: { amount: '9.50', currencyCode: 'USD' } },
      { id: 9925, price: '10.00', priceV2: { amount: '10.000', currencyCode: 'USD' } },
    ],
  }
  const mapped = mapShopifyProducts([product], USD)
  assert.deepEqual(mapped.products.map(p => p.id), ['9921', '9924', '9925'])
  assert.deepEqual(mapped.products.map(p => p.priceCents), [1000, 950, 1000])
  assert.equal(mapped.skipped.length, 2)
  assert.match(mapped.skipped.find(p => p.variantId === '9922').reason, /conflicting Shopify price/)
  assert.match(mapped.skipped.find(p => p.variantId === '9923').reason, /currency EUR does not match expected USD/)
})

test('currencyCode is required and must use two minor-unit digits', () => {
  assert.throws(() => mapShopifyProducts([], {}), /currencyCode is required/)
  assert.throws(() => mapShopifyProducts([]), /currencyCode is required/)
  assert.throws(() => mapShopifyProducts([], { currencyCode: 'US' }), /currencyCode is required/)
  for (const code of ['JPY', 'krw', 'KWD', 'BHD']) assert.throws(() => normalizeCurrency(code), /two minor-unit/)
  assert.equal(normalizeCurrency(' usd '), 'USD')
  assert.equal(normalizeCurrency('EUR'), 'EUR')
})

test('global ids from admin_graphql_api_id win over numeric ids', () => {
  const product = {
    id: 111,
    admin_graphql_api_id: 'gid://shopify/Product/111',
    title: 'T',
    variants: [{ id: 222, admin_graphql_api_id: 'gid://shopify/ProductVariant/222', title: 'v', price: '1.00' }],
  }
  const [mapped] = mapShopifyProducts([product], USD).products
  assert.equal(mapped.id, 'gid://shopify/ProductVariant/222')
  assert.deepEqual(mapped.shopify, { productId: 'gid://shopify/Product/111', variantId: 'gid://shopify/ProductVariant/222' })
})

test('unpublished products are skipped unless explicitly included', () => {
  const product = { id: 1, title: 'U', published_at: null, variants: [{ id: 2, price: '1.00' }] }
  const hidden = mapShopifyProducts([product], USD)
  assert.equal(hidden.products.length, 0)
  assert.match(hidden.skipped[0].reason, /not published/)
  assert.equal(mapShopifyProducts([product], { ...USD, includeUnpublished: true }).products.length, 1)
  assert.equal(mapShopifyProducts([{ ...product, published_at: '2026-01-01T00:00:00Z' }], USD).products.length, 1)
  assert.equal(mapShopifyProducts([{ id: 1, title: 'No field', variants: [{ id: 2, price: '1.00' }] }], USD).products.length, 1)
})

test('zero quantity never excludes a variant; the Shopify inventory policy is preserved as reported', () => {
  const product = {
    id: 1,
    title: 'Made to order',
    variants: [
      { id: 10, price: '1.00', inventoryPolicy: 'DENY', inventoryQuantity: 0 },
      { id: 11, price: '1.00', inventoryPolicy: 'DENY', inventoryQuantity: -2 },
      { id: 12, price: '1.00', inventory_policy: 'deny', inventory_quantity: 0 },
      { id: 13, price: '1.00', inventoryPolicy: 'CONTINUE', inventoryQuantity: 0 },
      { id: 14, price: '1.00', inventoryPolicy: 'DENY' },
      { id: 15, price: '1.00', inventoryPolicy: 'continue', inventoryQuantity: 3 },
      { id: 16, price: '1.00' },
      { id: 17, price: '1.00', inventoryPolicy: 'WEIRD' },
    ],
  }
  const result = mapShopifyProducts([product], USD)
  assert.deepEqual(result.products.map(p => p.id), ['10', '11', '12', '13', '14', '15', '16', '17'])
  assert.equal(result.skipped.length, 0, 'nothing may be excluded for quantity')
  const policies = Object.fromEntries(result.products.map(p => [p.id, p.shopify.inventoryPolicy]))
  assert.deepEqual(policies, {
    10: 'DENY',
    11: 'DENY',
    12: 'DENY',
    13: 'CONTINUE',
    14: 'DENY',
    15: 'CONTINUE',
    16: undefined,
    17: undefined,
  })
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /WEIRD/)
  for (const p of result.products) {
    assert.equal('inventoryQuantity' in p, false, 'quantity must not be copied')
    assert.equal('inventoryQuantity' in p.shopify, false, 'quantity must not be copied')
  }
})

test('products with a truncated variant list are skipped whole', () => {
  const product = { id: 1, title: 'Big', variants: { pageInfo: { hasNextPage: true }, nodes: [{ id: 2, price: '1.00' }] } }
  const result = mapShopifyProducts([product], USD)
  assert.equal(result.products.length, 0)
  assert.match(result.skipped[0].reason, /truncated/)
})

test('GraphQL variants without explicit complete pagination evidence fail closed', () => {
  const raw = {
    id: 'gid://shopify/Product/9876',
    title: 'SYNTHETIC large light strip',
    status: 'ACTIVE',
    publishedAt: '2026-10-18T00:00:00Z',
    variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1234', price: '65.99' }] },
  }
  for (const pageInfo of [undefined, {}, { hasNextPage: 'false' }, { hasNextPage: null }]) {
    const variants = { ...raw.variants, ...(pageInfo === undefined ? {} : { pageInfo }) }
    const result = mapShopifyProducts([{ ...raw, variants }], USD)
    assert.equal(result.products.length, 0)
    assert.match(result.skipped[0].reason, /pagination status unknown/)
  }
  const complete = mapShopifyProducts([{ ...raw, variants: { ...raw.variants, pageInfo: { hasNextPage: false } } }], USD)
  assert.equal(complete.products.length, 1, 'completed GraphQL connections still map')
  const rest = mapShopifyProducts([{ ...raw, variants: raw.variants.nodes }], USD)
  assert.equal(rest.products.length, 1, 'REST arrays remain supported')
})

test('accepted input wrappers: array, { products: [] }, { products: { nodes } }', () => {
  const p = fixtures.defaultTitleOnly
  assert.equal(mapShopifyProducts([p], USD).products.length, 1)
  assert.equal(mapShopifyProducts({ products: [p] }, USD).products.length, 1)
  assert.equal(mapShopifyProducts({ products: { nodes: [p] } }, USD).products.length, 1)
  assert.equal(mapShopifyProducts(null, USD).products.length, 0)
  assert.equal(mapShopifyProducts('nope', USD).products.length, 0)
  assert.equal(mapShopifyProducts([42], USD).skipped.length, 1)
})

test('shopifyId preserves identifiers exactly and rejects unsafe numbers', () => {
  assert.equal(shopifyId(7234567890123), '7234567890123')
  assert.equal(shopifyId('gid://shopify/Product/1'), 'gid://shopify/Product/1')
  assert.equal(shopifyId(' 123 '), '123')
  assert.equal(shopifyId(2 ** 60), undefined)
  assert.equal(shopifyId(-1), undefined)
  assert.equal(shopifyId(undefined), undefined)
})

test('output satisfies the catalog contract and carries no invented fields', () => {
  const result = mapShopifyProducts(ALL, USD)
  assert.ok(result.products.length > 0)
  assertCatalogContract(result.products)
  const allowed = new Set(['id', 'name', 'description', 'priceCents', 'image', 'variant', 'sku', 'shopify'])
  for (const product of result.products) {
    for (const key of Object.keys(product)) assert.ok(allowed.has(key), 'unexpected field ' + key)
  }
  assert.doesNotThrow(() => JSON.stringify({ products: result.products }))
})

test('mapper stays isolated from payments, database, env and routes', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /stripe|checkout|cart-store|neon|process\.env|fetch\(/i)
  const imports = source.match(/^import .*$/gm) ?? []
  assert.deepEqual(imports, ["import type { VibeProduct } from '@/lib/products'"])
})


test('credential-bearing Shopify media URLs are never exposed or mistaken for verified images', () => {
  const raw = {
    id: 'gid://shopify/Product/301', title: 'SYNTHETIC safe media',
    status: 'ACTIVE', publishedAt: '2026-10-26T00:00:00Z',
    featuredMedia: { preview: { image: { url: 'https://operator:secret@cdn.shopify.com/featured.jpg' } } },
    media: {
      nodes: [{ id: 'gid://shopify/MediaImage/302', preview: { image: { url: 'https://cdn.shopify.com/safe.jpg' } } }],
      pageInfo: { hasNextPage: true, endCursor: 'more-media' },
    },
    variants: { nodes: [{ id: 'gid://shopify/ProductVariant/303', price: '19.99', inventoryPolicy: 'CONTINUE' }],
      pageInfo: { hasNextPage: false } },
  }
  const mapped = mapShopifyProducts([raw], USD)
  assert.equal(mapped.products.length, 1)
  assert.equal(mapped.products[0].image, 'https://cdn.shopify.com/safe.jpg')
  const unsafeOnly = { ...raw, media: { nodes: [], pageInfo: { hasNextPage: false } } }
  assert.equal(mapShopifyProducts([unsafeOnly], USD).products[0].image, '',
    'terminal imageless product is diagnostic, not a leaked credential URL')
  const uninspected = { ...raw, media: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'more-media' } } }
  const incomplete = mapShopifyProducts([uninspected], USD)
  assert.equal(incomplete.products.length, 0)
  assert.match(incomplete.skipped[0].reason, /image coverage unverified/)
})

test('imageless GraphQL media requires explicit terminal pagination evidence', () => {
  const raw = {
    id: 'gid://shopify/Product/771', title: 'SYNTHETIC media completeness',
    status: 'ACTIVE', publishedAt: '2026-10-26T00:00:00Z',
    variants: { nodes: [{
      id: 'gid://shopify/ProductVariant/772', price: '19.99',
      inventoryPolicy: 'CONTINUE', inventoryQuantity: 0,
    }], pageInfo: { hasNextPage: false } },
    media: { nodes: [] },
  }
  for (const pageInfo of [undefined, {}, { hasNextPage: 'false' }, { hasNextPage: null },
    { hasNextPage: true, endCursor: 'more' }]) {
    const media = { nodes: [], ...(pageInfo === undefined ? {} : { pageInfo }) }
    const result = mapShopifyProducts([{ ...raw, media }], USD)
    assert.equal(result.products.length, 0, 'unknown media coverage must omit the entire family')
    assert.equal(result.skipped.length, 1)
    assert.match(result.skipped[0].reason, /image coverage unverified/)
  }
  const terminal = mapShopifyProducts([{ ...raw, media: {
    nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
  } }], USD)
  assert.equal(terminal.products.length, 1)
  assert.equal(terminal.products[0].image, '', 'terminal imageless product remains diagnosable')
  assert.equal(terminal.products[0].priceCents, 1999)
  assert.equal(terminal.products[0].shopify.inventoryPolicy, 'CONTINUE')
  const featured = mapShopifyProducts([{ ...raw,
    featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/safe.png' } } },
  }], USD)
  assert.equal(featured.products.length, 1, 'a verified image needs no additional media pages')
  assert.equal(featured.products[0].image, 'https://cdn.shopify.com/safe.png')
  const rest = mapShopifyProducts([{ ...raw, media: [] }], USD)
  assert.equal(rest.products.length, 1, 'REST media arrays remain compatible')
})

test('nonempty whitespace-only SKU is rejected instead of silently losing merchant identity', () => {
  const raw = {
    id: 880, title: 'SYNTHETIC SKU identity',
    variants: [
      { id: 881, title: 'Empty allowed', sku: '', price: '5.00', inventoryPolicy: 'CONTINUE' },
      { id: 882, title: 'Whitespace invalid', sku: ' \t ', price: '5.00', inventoryPolicy: 'CONTINUE' },
      { id: 883, title: 'Meaningful spaces', sku: '  PART A  ', price: '5.00', inventoryPolicy: 'DENY' },
    ],
  }
  const result = mapShopifyProducts([raw], USD)
  assert.deepEqual(result.products.map(p => p.id), ['881', '883'])
  assert.equal('sku' in result.products[0], false, 'explicitly empty SKU remains optional')
  assert.equal(result.products[1].sku, '  PART A  ', 'merchant SKU bytes are preserved')
  assert.deepEqual(result.skipped.map(s => s.variantId), ['882'])
  assert.match(result.skipped[0].reason, /sku is whitespace-only/)
})

test('REST image fallback skips unsafe earlier images without overriding a valid variant-specific image', () => {
  const raw = {
    ...fixtures.restMultiVariant,
    images: [
      { id: 1, src: 'http://cdn.shopify.com/unsafe-http.jpg' },
      { id: 2, src: 'https://operator:secret@cdn.shopify.com/unsafe-credentials.jpg' },
      { id: 4, src: 'https://cdn.shopify.com/safe-fallback.jpg' },
      { id: 3, src: 'https://cdn.shopify.com/safe-variant.jpg' },
    ],
  }
  const result = mapShopifyProducts([raw], USD)
  assert.equal(result.skipped.length, 0)
  assert.equal(result.products.length, 3)
  assert.equal(byId(result, '41000000000001').image, 'https://cdn.shopify.com/safe-variant.jpg',
    'a variant-specific valid image must take precedence over the product fallback')
  assert.equal(byId(result, '41000000000002').image, 'https://cdn.shopify.com/safe-fallback.jpg',
    'a safe later REST image must be used when the first images are unsafe')
  assert.equal(byId(result, '41000000000003').image, 'https://cdn.shopify.com/safe-fallback.jpg')

  const unsafeOnly = mapShopifyProducts([{ ...raw, images: raw.images.slice(0, 2) }], USD)
  assert.equal(unsafeOnly.products.length, 3)
  assert.ok(unsafeOnly.products.every(p => p.image === ''),
    'unsafe-only REST images must not be exposed as trusted URLs')
})
