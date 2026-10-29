import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModules } from './helpers/shopify-test-utils.mjs'

const modules = await loadTsModules(['lib/shopify-catalog-mapper.ts'])
const { normalizeCurrency, mapShopifyProducts } = modules['shopify-catalog-mapper']

// These ISO 4217 currencies have zero fractional minor units in Node ICU,
// but were absent from the mapper's original hand-maintained exclusion list.
// Treating their whole-unit prices as cents would misprice a merchant feed.
test('Shopify mapper rejects valid currencies whose ICU minor-unit scale is not two', () => {
  const zeroUnitCodes = [
    'AFN', 'ALL', 'IRR', 'ISK', 'KPW', 'LAK', 'LBP',
    'MMK', 'RSD', 'SLL', 'SOS', 'SYP', 'YER',
  ]
  let checked = 0
  for (const code of zeroUnitCodes) {
    if (!Intl.supportedValuesOf('currency').includes(code)) continue
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits
    // ICU/CLDR revisions can disagree on the minor-unit scale for some
    // currencies (for example RSD differs between Node 20 CI and Node 22).
    // Test only currencies this runtime identifies as non-two-decimal;
    // do not assert that every candidate has the same scale on every Node.
    if (digits === 2) continue
    assert.throws(() => normalizeCurrency(code), /two minor-unit digits/, code)
    checked++
  }
  assert.ok(checked >= 4, 'the runtime must expose enough non-two-decimal currency examples')
  for (const code of ['USD', 'EUR', 'CAD', 'GBP', 'AUD']) {
    assert.equal(normalizeCurrency(code), code)
  }
  for (const code of ['JPY', 'KWD']) {
    assert.throws(() => normalizeCurrency(code), /two minor-unit digits/)
  }
})

test('unsupported minor-unit scale cannot enter a Shopify variant catalog', () => {
  const product = {
    id: 100, title: 'Synthetic currency fixture',
    variants: [{ id: 101, title: 'Default Title', price: '12.00' }],
  }
  assert.throws(() => mapShopifyProducts([product], { currencyCode: 'AFN' }),
    /two minor-unit digits/)
  assert.equal(mapShopifyProducts([product], { currencyCode: 'USD' }).products[0].priceCents, 1200)
})
