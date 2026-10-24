import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const libPath = 'lib/ai-readiness.ts'
const libSource = fs.readFileSync(libPath, 'utf8')
const componentSource = fs.readFileSync('components/ai-readiness-dashboard.tsx', 'utf8')
const pageSource = fs.readFileSync('app/ai-readiness/page.tsx', 'utf8')
const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts', libPath])
const { evaluateCatalogReadiness, READINESS_DISCLAIMER, REQUIRED_CAPABILITIES } = modules['ai-readiness']

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const good = (id, extra = {}) => ({ id, name: 'Item ' + id, description: 'A thing', priceCents: 1999, image: 'https://cdn.example.com/' + id + '.jpg', ...extra })
const probe = (kind, extra = {}) => ({
  kind,
  url: 'https://example.com/' + kind,
  origin: 'server_probe',
  checkedAt: NOW - HOUR,
  ok: true,
  capabilities: REQUIRED_CAPABILITIES[kind],
  ...extra,
})
const allProbes = () => [probe('mcp'), probe('ucp')]
const run = (products, extra = {}) =>
  evaluateCatalogReadiness({ products, currencyCode: 'USD', lastSyncedAt: NOW - HOUR, now: NOW, probes: allProbes(), ...extra })
const codes = report => report.products.flatMap(p => p.issues.map(i => i.code))

test('a complete, verified catalog is ready for agent testing, with no ranking claim', () => {
  const report = run({ products: [good('a'), good('b', { variant: 'Blue' })] })
  assert.equal(report.level, 'ready_for_agent_testing')
  assert.equal(report.totals.exposable, 2)
  assert.equal(report.blockers.length, 0)
  assert.match(report.disclaimer, /does not predict or guarantee/)
  assert.equal(report.disclaimer, READINESS_DISCLAIMER)
  assert.ok(report.products.every(p => p.issues.every(i => i.severity === 'info')))
})

test('required fields and price validity are blockers that make a product not exposable', () => {
  const report = run([
    good('ok'),
    { id: 'noname', priceCents: 100 },
    { name: 'noid', priceCents: 100 },
    good('float', { priceCents: 19.99 }),
    good('neg', { priceCents: -1 }),
    good('str', { priceCents: '1999' }),
  ])
  assert.equal(report.totals.exposable, 1)
  assert.equal(report.level, 'needs_work')
  const found = codes(report)
  for (const code of ['name_missing', 'id_missing', 'price_invalid']) assert.ok(found.includes(code), code)
  assert.equal(report.products.filter(p => p.issues.some(i => i.code === 'price_invalid')).length, 3)
})

test('images: missing is a warning, non-https or malformed is a blocker', () => {
  const report = run([
    good('none', { image: '' }),
    good('http', { image: 'http://cdn.example.com/a.jpg' }),
    good('junk', { image: 'not a url' }),
    good('num', { image: 5 }),
  ])
  const byId = Object.fromEntries(report.products.map(p => [p.id, p]))
  assert.equal(byId.none.exposable, true)
  assert.ok(byId.none.issues.some(i => i.code === 'image_missing' && i.severity === 'warning'))
  assert.ok(byId.http.issues.some(i => i.code === 'image_not_https'))
  assert.ok(byId.junk.issues.some(i => i.code === 'image_not_https'))
  assert.ok(byId.num.issues.some(i => i.code === 'image_invalid'))
})

test('duplicate ids block every copy; zero price and empty description warn', () => {
  const report = run([good('dup'), good('dup'), good('free', { priceCents: 0, description: '  ' })])
  assert.equal(report.products.filter(p => p.issues.some(i => i.code === 'id_duplicate')).length, 2)
  const free = report.products.find(p => p.id === 'free')
  assert.equal(free.exposable, true)
  assert.deepEqual(free.issues.filter(i => i.severity === 'warning').map(i => i.code).sort(), ['description_missing', 'price_zero'])
})

test('currency is never assumed: missing and unsupported currencies are blockers', () => {
  const missing = evaluateCatalogReadiness({ products: [good('a')], now: NOW, lastSyncedAt: NOW, probes: allProbes() })
  assert.equal(missing.currency.status, 'missing')
  assert.ok(missing.blockers.some(b => b.code === 'currency_missing'))
  assert.notEqual(missing.level, 'ready_for_agent_testing')

  const blank = run([good('a')], { currencyCode: '' })
  assert.equal(blank.currency.status, 'missing')

  for (const code of ['JPY', 'XX', 'dollars', '   ']) {
    const bad = run([good('a')], { currencyCode: code })
    assert.equal(bad.currency.status, 'invalid', code)
    assert.ok(bad.blockers.some(b => b.code === 'currency_invalid'))
  }
  const eur = run([good('a')], { currencyCode: ' eur ' })
  assert.equal(eur.currency.status, 'verified')
  assert.equal(eur.currency.code, 'EUR')
  assert.match(eur.currency.message, /not one detected/)
})

test('Shopify source ids must match the catalog id', () => {
  const ok = good('gid://shopify/ProductVariant/2', { shopify: { productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/2' } })
  const mismatch = good('gid://shopify/ProductVariant/3', { shopify: { productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/9' } })
  const partial = good('p', { shopify: { variantId: 'p' } })
  const report = run([ok, mismatch, partial, good('plain')])
  const byId = Object.fromEntries(report.products.map(p => [p.id, p]))
  assert.equal(byId[ok.id].exposable, true)
  assert.ok(!byId[ok.id].issues.some(i => i.code.startsWith('source_ids')))
  assert.ok(byId[mismatch.id].issues.some(i => i.code === 'source_ids_mismatch'))
  assert.ok(byId.p.issues.some(i => i.code === 'source_ids_incomplete'))
  assert.ok(byId.plain.issues.some(i => i.code === 'source_ids_unverified' && i.severity === 'info'))
})

test('a Shopify block carrying inventoryPolicy never changes exposure', () => {
  const entry = good('gid://shopify/ProductVariant/5', {
    shopify: { productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/5', inventoryPolicy: 'DENY' },
  })
  const report = run([entry])
  assert.equal(report.products[0].exposable, true)
  assert.equal(report.level, 'ready_for_agent_testing')
})

test('endpoints are not verified without evidence', () => {
  const report = run([good('a')], { probes: [] })
  assert.deepEqual(report.endpoints.map(e => e.status), ['not_verified', 'not_verified'])
  assert.equal(report.level, 'needs_work')
  assert.ok(report.blockers.some(b => b.code === 'endpoint_mcp_not_verified'))
  assert.ok(report.blockers.some(b => b.code === 'endpoint_ucp_not_verified'))
  assert.notEqual(report.level, 'ready_for_agent_testing')
})

test('endpoint states: failed, missing capabilities, stale, and newest probe wins', () => {
  const failed = run([good('a')], { probes: [probe('mcp', { ok: false, detail: 'HTTP 500' }), probe('ucp')] })
  assert.equal(failed.endpoints[0].status, 'failed')
  assert.match(failed.endpoints[0].message, /HTTP 500/)

  const partial = run([good('a')], { probes: [probe('mcp', { capabilities: ['vibecart.list_products'] }), probe('ucp')] })
  assert.equal(partial.endpoints[0].status, 'missing_capabilities')
  assert.deepEqual(partial.endpoints[0].missingCapabilities, ['vibecart.get_product'])

  const stale = run([good('a')], { probes: [probe('mcp', { checkedAt: NOW - 48 * HOUR }), probe('ucp')] })
  assert.equal(stale.endpoints[0].status, 'stale')
  assert.equal(stale.endpoints[1].status, 'verified')

  const newest = run([good('a')], { probes: [probe('mcp', { ok: false, checkedAt: NOW - 5 * HOUR }), probe('mcp', { checkedAt: NOW - HOUR }), probe('ucp')] })
  assert.equal(newest.endpoints[0].status, 'verified')
  assert.equal(newest.level, 'ready_for_agent_testing')
})

test('manual evidence is never trusted, even when it says ok', () => {
  const report = run([good('a')], { probes: [probe('mcp', { origin: 'manual' }), probe('ucp', { origin: 'manual' })] })
  assert.deepEqual(report.endpoints.map(e => e.status), ['unverified_manual', 'unverified_manual'])
  assert.notEqual(report.level, 'ready_for_agent_testing')
  assert.match(report.endpoints[0].message, /not trusted/)
  const missingOrigin = run([good('a')], { probes: [{ ...probe('mcp'), origin: undefined }, probe('ucp')] })
  assert.equal(missingOrigin.endpoints[0].status, 'unverified_manual')
})

test('future-dated evidence is rejected, small clock skew is tolerated', () => {
  const future = run([good('a')], { probes: [probe('mcp', { checkedAt: NOW + 3 * HOUR }), probe('ucp')] })
  assert.equal(future.endpoints[0].status, 'invalid_timestamp')
  assert.ok(future.blockers.some(b => b.code === 'endpoint_mcp_invalid_timestamp'))
  const skew = run([good('a')], { probes: [probe('mcp', { checkedAt: NOW + 60_000 }), probe('ucp')] })
  assert.equal(skew.endpoints[0].status, 'verified')
})

test('an expected endpoint URL is enforced', () => {
  const expectedEndpoints = { mcp: 'https://example.com/mcp', ucp: 'https://example.com/ucp' }
  assert.equal(run([good('a')], { expectedEndpoints }).level, 'ready_for_agent_testing')
  const wrong = run([good('a')], { expectedEndpoints: { ...expectedEndpoints, mcp: 'https://other.example.com/mcp' } })
  assert.equal(wrong.endpoints[0].status, 'wrong_endpoint')
  assert.equal(wrong.endpoints[1].status, 'verified')
  assert.match(wrong.endpoints[0].message, /does not match the expected endpoint/)
})

test('freshness: unknown and stale are warnings, fresh is clean', () => {
  const unknown = evaluateCatalogReadiness({ products: [good('a')], currencyCode: 'USD', now: NOW, probes: allProbes() })
  assert.equal(unknown.freshness.status, 'unknown')
  assert.equal(unknown.level, 'needs_work')
  const stale = run([good('a')], { lastSyncedAt: NOW - 30 * HOUR })
  assert.equal(stale.freshness.status, 'stale')
  assert.ok(stale.warnings.some(w => w.code === 'freshness_stale'))
  assert.equal(run([good('a')]).freshness.status, 'fresh')
})

test('catalog shape problems are blockers and never throw', () => {
  for (const value of [null, undefined, 'x', 42, {}, { products: 'no' }]) {
    const report = run(value)
    assert.equal(report.level, 'not_ready')
    assert.ok(report.blockers.some(b => b.code === 'catalog_shape'))
  }
  assert.ok(run([]).blockers.some(b => b.code === 'catalog_empty'))
  const mixed = run([null, 5, good('a')])
  assert.equal(mixed.totals.products, 3)
  assert.equal(mixed.totals.exposable, 1)
  assert.ok(codes(mixed).includes('entry_not_object'))
})

test('blocker summary groups by code with counts and examples', () => {
  const report = run([good('a', { priceCents: 1.5 }), good('b', { priceCents: -2 }), good('c', { priceCents: 'x' }), good('d', { priceCents: 7.7 })])
  const price = report.blockers.find(b => b.code === 'price_invalid')
  assert.equal(price.count, 4)
  assert.equal(price.examples.length, 3)
  assert.equal(report.blockers[0].code, 'price_invalid')
})

test('the evaluator is pure and does not mutate its input', () => {
  const products = [good('a')]
  const probes = allProbes()
  const before = JSON.stringify({ products, probes })
  run(products, { probes })
  assert.equal(JSON.stringify({ products, probes }), before)
  assert.deepEqual(run(products), run(products))
})

test('the page never assumes a currency and is labeled manual and offline', () => {
  assert.match(componentSource, /const \[currency, setCurrency\] = useState\(""\)/)
  assert.doesNotMatch(componentSource, /useState\(["']USD["']\)/)
  assert.match(componentSource, /Manual, offline diagnostic/)
  assert.match(componentSource, /not connected to your store/)
  assert.match(pageSource, /manual, offline/i)
  assert.doesNotMatch(componentSource, /probes\s*:/, 'the browser page must not supply probe evidence')
})

test('no ranking or recommendation promises and no third-party AI names in shipped text', () => {
  const scanned = (componentSource + pageSource + libSource).split(READINESS_DISCLAIMER).join('')
  assert.doesNotMatch(scanned, /chatgpt|openai|gemini|claude|anthropic|perplexity|copilot/i)
  assert.doesNotMatch(scanned, /will (be )?(recommend|rank|surface|discover|list)/i)
  assert.doesNotMatch(scanned, /guarantee(s|d)? (that |to )?(rank|recommend|sales|traffic)/i)
  assert.match(READINESS_DISCLAIMER, /does not predict or guarantee/)
})

test('evaluator stays isolated from payments, database, env and the network', () => {
  const code = libSource.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /stripe|checkout|cart-store|neon|process\.env|fetch\(/i)
  assert.deepEqual(libSource.match(/from '[^']+'/g), ["from '@/lib/shopify-catalog-mapper'"])
})

test('future-dated Shopify sync cannot falsely certify catalog freshness', () => {
  const future = run([good('a')], { lastSyncedAt: NOW + 3 * HOUR })
  assert.equal(future.freshness.status, 'unknown')
  assert.ok(future.warnings.some(w => w.code === 'freshness_future_timestamp'))
  assert.notEqual(future.level, 'ready_for_agent_testing')

  const skew = run([good('a')], { lastSyncedAt: NOW + 60_000 })
  assert.equal(skew.freshness.status, 'fresh')
  assert.equal(skew.level, 'ready_for_agent_testing')

  const stale = run([good('a')], { lastSyncedAt: NOW - 30 * HOUR })
  assert.equal(stale.freshness.status, 'stale')
})
