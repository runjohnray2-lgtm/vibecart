import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { syntheticPages, syntheticShop } from './fixtures/radiantz-synthetic.mjs'
import { assertCatalogContract, loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts', 'lib/ai-readiness.ts'])
const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex } = modules['shopify-catalog-sync']
const { evaluateCatalogReadiness, REQUIRED_CAPABILITIES } = modules['ai-readiness']

const REAL_PATH = 'tests/fixtures/radiantz/shop-products.json'
const realData = fs.existsSync(REAL_PATH) ? JSON.parse(fs.readFileSync(REAL_PATH, 'utf8')) : null

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const PRICE_FORMAT = /^\d+(\.\d{1,2})?$/

function independentCents(price) {
  const [whole, fraction = ''] = price.split('.')
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}

function variantNodes(product) {
  const variants = product.variants ?? {}
  return variants.nodes ?? (variants.edges ?? []).map(edge => edge.node)
}

function analyze(pages) {
  const eligible = []
  const ineligibleProductIds = []
  const badPriceVariantIds = []
  for (const page of pages) {
    for (const p of page.products) {
      const truncated = Boolean(p.variants && p.variants.pageInfo && p.variants.pageInfo.hasNextPage)
      const live = p.status === 'ACTIVE' && typeof p.publishedAt === 'string' && !truncated
      if (!live) {
        ineligibleProductIds.push(p.id)
        continue
      }
      for (const v of variantNodes(p)) {
        if (typeof v.price !== 'string' || !PRICE_FORMAT.test(v.price)) {
          badPriceVariantIds.push(v.id)
          continue
        }
        const policy = String(v.inventoryPolicy).toUpperCase()
        eligible.push({
          id: v.id,
          productId: p.id,
          sku: typeof v.sku === 'string' && v.sku.trim() ? v.sku.trim() : undefined,
          cents: independentCents(v.price),
          policy: policy === 'DENY' || policy === 'CONTINUE' ? policy : undefined,
          quantity: v.inventoryQuantity,
        })
      }
    }
  }
  return { eligible, ineligibleProductIds, badPriceVariantIds }
}

function pager(pages) {
  let call = 0
  return async () => {
    const page = pages[call]
    call += 1
    if (!page) throw new Error('unexpected extra page request')
    return page
  }
}

function registerSuite(label, data, { requireZeroQuantity }) {
  const skip = data ? false : 'fixture not provided: add ' + REAL_PATH + ' (see docs/radiantz-pilot.md)'
  const pages = data ? data.pages : []
  const shop = data ? data.shop : syntheticShop
  const analysis = analyze(pages)
  let cache
  const synced = () => {
    cache = cache ?? syncShopifyCatalog({ shopCurrencyCode: shop.currencyCode, expectedCurrencyCode: 'USD', fetchPage: pager(pages) })
    return cache
  }
  const entries = result => [...result.snapshot.products.values()].flat()

  test(label + ': shop currency is USD and every page is read', { skip }, async () => {
    assert.equal(shop.currencyCode, 'USD')
    const result = await synced()
    assert.equal(result.pages, pages.length)
  })

  test(label + ': every published ACTIVE variant is in the feed; quantity and policy never exclude anything', { skip }, async () => {
    const result = await synced()
    const feedIds = toCatalogFeed(result.snapshot).products.map(p => p.id).sort()
    const expectedIds = analysis.eligible.map(v => v.id).sort()
    assert.ok(expectedIds.length > 0, 'fixture has no eligible variants')
    assert.deepEqual(feedIds, expectedIds)
    if (requireZeroQuantity) {
      const zero = analysis.eligible.filter(v => v.quantity === 0)
      assert.ok(zero.some(v => v.policy === 'CONTINUE'), 'fixture must include a zero-quantity CONTINUE variant')
      assert.ok(zero.some(v => v.policy === 'DENY'), 'fixture must include a zero-quantity DENY variant')
      for (const v of zero) assert.ok(feedIds.includes(v.id), 'zero-quantity variant was excluded: ' + v.id)
    }
  })

  test(label + ': Shopify product ids, variant ids and SKUs are preserved without inventing any', { skip }, async () => {
    const result = await synced()
    const all = entries(result)
    const index = buildVariantIndex(result.snapshot)
    for (const expected of analysis.eligible) {
      const entry = all.find(p => p.id === expected.id)
      assert.ok(entry, 'missing ' + expected.id)
      assert.equal(entry.shopify.productId, expected.productId)
      assert.equal(entry.shopify.variantId, expected.id)
      if (expected.sku) assert.equal(entry.sku, expected.sku)
      else assert.equal('sku' in entry, false, 'SKU must not be invented for ' + expected.id)
      const ref = index.get(expected.id)
      assert.equal(ref.productId, expected.productId)
      assert.equal(ref.variantId, expected.id)
      assert.equal(ref.sku, expected.sku)
    }
  })

  test(label + ': prices equal an independent decimal parse', { skip }, async () => {
    const result = await synced()
    const feed = toCatalogFeed(result.snapshot).products
    for (const expected of analysis.eligible) {
      assert.equal(feed.find(p => p.id === expected.id).priceCents, expected.cents, expected.id)
    }
  })

  test(label + ': Shopify inventory policy is preserved and quantity is never copied', { skip }, async () => {
    const result = await synced()
    const all = entries(result)
    for (const expected of analysis.eligible) {
      const entry = all.find(p => p.id === expected.id)
      assert.equal(entry.shopify.inventoryPolicy, expected.policy, expected.id)
    }
    for (const entry of all) {
      assert.equal('inventoryQuantity' in entry, false)
      assert.equal('inventoryQuantity' in entry.shopify, false)
    }
    for (const product of toCatalogFeed(result.snapshot).products) {
      assert.equal('inventoryQuantity' in product, false)
      assert.equal('inventoryPolicy' in product, false, 'the public feed must not carry inventory data')
    }
  })

  test(label + ': products that cannot be exposed are skipped with a visible reason', { skip }, async () => {
    const result = await synced()
    for (const id of analysis.ineligibleProductIds) {
      const found = result.skipped.find(item => item.productId === id)
      assert.ok(found, 'no skip reason reported for ' + id)
      assert.match(found.reason, /status is|not published|publication status unknown|truncated|no variants/)
    }
    for (const id of analysis.badPriceVariantIds) {
      assert.ok(result.skipped.some(item => item.variantId === id), 'no skip reason reported for variant ' + id)
    }
  })

  test(label + ': the feed satisfies the catalog contract', { skip }, async () => {
    const result = await synced()
    assertCatalogContract(toCatalogFeed(result.snapshot).products)
  })

  test(label + ': readiness has no data blockers; only unverified endpoints block until a server probe exists', { skip }, async () => {
    const result = await synced()
    const feed = toCatalogFeed(result.snapshot).products
    const base = { currencyCode: 'USD', lastSyncedAt: NOW, now: NOW }

    const withoutProbes = evaluateCatalogReadiness({ ...base, products: feed })
    assert.ok(withoutProbes.blockers.length > 0)
    assert.ok(withoutProbes.blockers.every(b => b.code.startsWith('endpoint_')), JSON.stringify(withoutProbes.blockers))
    assert.notEqual(withoutProbes.level, 'ready_for_agent_testing')

    const probes = ['mcp', 'ucp'].map(kind => ({
      kind,
      url: 'https://example.com/' + kind,
      origin: 'server_probe',
      checkedAt: NOW - HOUR,
      ok: true,
      capabilities: REQUIRED_CAPABILITIES[kind],
    }))
    const verified = evaluateCatalogReadiness({ ...base, products: feed, probes })
    assert.equal(verified.blockers.length, 0, JSON.stringify(verified.blockers))
    assert.equal(verified.totals.exposable, feed.length)

    const withIds = evaluateCatalogReadiness({ ...base, products: entries(result), probes })
    assert.equal(withIds.blockers.length, 0, JSON.stringify(withIds.blockers))
    assert.ok(!withIds.products.some(p => p.issues.some(i => i.code.startsWith('source_ids_') && i.severity !== 'info')))
    if (requireZeroQuantity) assert.equal(verified.level, 'ready_for_agent_testing')
  })
}

registerSuite('synthetic fixture', { shop: syntheticShop, pages: syntheticPages }, { requireZeroQuantity: true })
registerSuite('real Radiantz export', realData, { requireZeroQuantity: false })

test('the built-in fixture is clearly synthetic, never presented as Radiantz data', () => {
  for (const page of syntheticPages) {
    for (const p of page.products) assert.match(p.title, /^SYNTHETIC /)
  }
  const source = fs.readFileSync('tests/fixtures/radiantz-synthetic.mjs', 'utf8')
  assert.match(source, /NOT Radiantz data/)
})

test('a shop currency that is not the catalog currency is rejected, never converted', async () => {
  await assert.rejects(
    () => syncShopifyCatalog({ shopCurrencyCode: 'EUR', expectedCurrencyCode: 'USD', fetchPage: pager(syntheticPages) }),
    /does not match/,
  )
})

test('the real-export fixture, when present, has the expected shape and no credentials', () => {
  if (!realData) return
  assert.equal(realData.shop.currencyCode, 'USD')
  assert.ok(Array.isArray(realData.pages) && realData.pages.length > 0)
  const raw = fs.readFileSync(REAL_PATH, 'utf8')
  assert.doesNotMatch(raw, /shpat_|shpss_|shpca_|access[_-]?token|api[_-]?key|client[_-]?secret/i)
})
