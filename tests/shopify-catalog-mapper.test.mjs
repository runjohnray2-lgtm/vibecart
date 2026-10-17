import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as fixtures from './fixtures/shopify-products.mjs'

// The repo has no TS test loader on Node 20, so transpile the real source file and import it.
const sourcePath = 'lib/shopify-catalog-mapper.ts'
const source = fs.readFileSync(sourcePath, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const mapper = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const { mapShopifyProducts, priceToCents, shopifyId } = mapper

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

// Mirrors the rules enforced by parseProduct in lib/catalog-source.ts.
function assertCatalogContract(products) {
  const seen = new Set()
  for (const p of products) {
    assert.ok(typeof p.id === 'string' && p.id.length >= 1 && p.id.length <= 200)
    assert.ok(typeof p.name === 'string' && p.name.length >= 1 && p.name.length <= 500)
    assert.ok(Number.isSafeInteger(p.priceCents) && p.priceCents >= 0)
    assert.equal(typeof p.description, 'string')
    assert.ok(p.description.length <= 5000)
    assert.ok(p.image === '' || new URL(p.image).protocol === 'https:')
    assert.ok(p.variant === undefined || (typeof p.variant === 'string' && p.variant.length <= 500))
    assert.ok(!seen.has(p.id), 'duplicate id ' + p.id)
    seen.add(p.id)
  }
}

test('REST multi-variant product keeps real ids, SKUs and exact cents', () => {
  const result = mapShopifyProducts([fixtures.restMultiVariant])
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
  const result = mapShopifyProducts([fixtures.defaultTitleOnly])
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
  const result = mapShopifyProducts({ products: { edges: [{ node: fixtures.graphqlEdges }] } })
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
  assert.equal(mapShopifyProducts([fixtures.floatTraps]).products.map(p => p.priceCents).join(','), '1999,115,29,435')
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
  const result = mapShopifyProducts(ALL)
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
  // the duplicate must not overwrite the first float-trap entry
  assert.equal(byId(result, '44000000000001').priceCents, 1999)
})

test('a different expected currency is honored but never converted', () => {
  const eur = { id: 1, title: 'EU', variants: [{ id: 2, title: 'x', price: { amount: '10.00', currencyCode: 'EUR' } }] }
  assert.equal(mapShopifyProducts([eur]).products.length, 0)
  const mapped = mapShopifyProducts([eur], { currencyCode: 'eur' })
  assert.equal(mapped.products[0].priceCents, 1000)
})

test('accepted input wrappers: array, { products: [] }, { products: { nodes } }', () => {
  const p = fixtures.defaultTitleOnly
  assert.equal(mapShopifyProducts([p]).products.length, 1)
  assert.equal(mapShopifyProducts({ products: [p] }).products.length, 1)
  assert.equal(mapShopifyProducts({ products: { nodes: [p] } }).products.length, 1)
  assert.equal(mapShopifyProducts(null).products.length, 0)
  assert.equal(mapShopifyProducts('nope').products.length, 0)
  assert.equal(mapShopifyProducts([42]).skipped.length, 1)
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
  const result = mapShopifyProducts(ALL)
  assert.ok(result.products.length > 0)
  assertCatalogContract(result.products)
  const allowed = new Set(['id', 'name', 'description', 'priceCents', 'image', 'variant', 'sku', 'shopify'])
  for (const product of result.products) {
    for (const key of Object.keys(product)) assert.ok(allowed.has(key), 'unexpected field ' + key)
  }
  assert.doesNotThrow(() => JSON.stringify({ products: result.products }))
})

test('mapper stays isolated from checkout, payments, database and routes', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /stripe|checkout|cart-store|neon|process\.env|fetch\(/i)
  const imports = source.match(/^import .*$/gm) ?? []
  assert.deepEqual(imports, ["import type { VibeProduct } from '@/lib/products'"])
})
