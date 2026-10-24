/**
 * Operator-only, read-only Shopify Admin -> VibeCart catalog acceptance audit.
 * Runs locally with an authorized Admin READ token; never serves a feed, writes
 * merchant data, creates carts/orders, or prints raw Shopify catalog records.
 *
 * SHOPIFY_AUDIT_SHOP=example.myshopify.com
 * SHOPIFY_AUDIT_READ_TOKEN=<private token>
 * SHOPIFY_AUDIT_CURRENCY=USD
 * node scripts/audit-shopify-catalog-readonly.mjs
 *
 * The TypeScript loader is a development dependency, so this is NOT a deployed
 * runtime endpoint. Keep credentials in the private shell/secret manager.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTsModules } from '../tests/helpers/shopify-test-utils.mjs'

const MODULE_PATHS = [
  'lib/shopify-catalog-mapper.ts',
  'lib/shopify-catalog-sync.ts',
  'lib/shopify-variant-pages.ts',
  'lib/shopify-admin-graphql.ts',
]

export function createReadOnlyShopifyTransport({
  shopDomain, token, apiVersion = '2026-10', allowedDocuments,
  fetchImpl = fetch, maxRequests = 120,
}) {
  if (typeof shopDomain !== 'string' ||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
    throw new Error('Shopify audit requires an exact *.myshopify.com shop domain')
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Shopify audit requires a private read-only Admin token')
  }
  if (typeof apiVersion !== 'string' || !/^\d{4}-(01|04|07|10)$/.test(apiVersion)) {
    throw new Error('Shopify audit requires a pinned quarterly Admin API version')
  }
  if (!(allowedDocuments instanceof Set) || allowedDocuments.size !== 4 ||
      [...allowedDocuments].some(doc => typeof doc !== 'string' || !doc.trim().startsWith('query '))) {
    throw new Error('Shopify audit requires four approved read-only GraphQL documents')
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 120) {
    throw new Error('Shopify audit request limit must be between 1 and 120')
  }
  const endpoint = 'https://' + shopDomain + '/admin/api/' + apiVersion + '/graphql.json'
  let requests = 0
  return async (document, variables) => {
    if (!allowedDocuments.has(document)) {
      throw new Error('Shopify audit refused an unapproved GraphQL operation')
    }
    if (++requests > maxRequests) throw new Error('Shopify audit request limit reached')
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-shopify-access-token': token,
      },
      body: JSON.stringify({ query: document, variables }),
    })
    if (!response || !response.ok) {
      throw new Error('Shopify audit HTTP ' + (response?.status ?? 'unavailable'))
    }
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      throw new Error('Shopify audit expected JSON')
    }
    const body = await response.text()
    if (body.length > 1024 * 1024) throw new Error('Shopify audit response too large')
    try {
      return JSON.parse(body)
    } catch {
      throw new Error('Shopify audit received malformed JSON')
    }
  }
}

export async function auditShopifyCatalogReadOnly({ execute, expectedCurrencyCode, modules } = {}) {
  if (typeof execute !== 'function') throw new Error('Shopify audit needs a read-only transport')
  if (typeof expectedCurrencyCode !== 'string' || !expectedCurrencyCode.trim()) {
    throw new Error('Shopify audit requires the merchant expected currency')
  }
  const loaded = modules ?? await loadTsModules(MODULE_PATHS)
  const { createShopifyAdminCatalogSource } = loaded['shopify-admin-graphql']
  const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex } = loaded['shopify-catalog-sync']
  const source = createShopifyAdminCatalogSource(execute)
  const currency = await source.fetchShopCurrency()
  const result = await syncShopifyCatalog({
    shopCurrencyCode: currency, expectedCurrencyCode,
    fetchPage: source.fetchPage,
  })
  const feed = toCatalogFeed(result.snapshot)
  const index = buildVariantIndex(result.snapshot)
  if (index.size !== feed.products.length) {
    throw new Error('Shopify audit variant index and catalog disagree')
  }
  // A successful Shopify traversal proves transport and exact pagination, NOT
  // that every record mapped into a usable VibeCart catalog. In particular,
  // unpublished, invalid or partially rejected product families are skipped.
  // Never label such an audit as fully verified without exposing the omissions.
  // The mapper intentionally permits an empty image for products with no
  // valid Shopify media. That is safe for parsing but not a verified merchant
  // beta catalog: report missing images instead of silently certifying them.
  const missingImages = feed.products.filter(product => !product.image).length
  // A valid empty Shopify traversal is not evidence of a usable merchant pilot.
  // Require at least one published family and mapped variant before certifying readiness.
  const hasUsableCatalog = result.snapshot.products.size > 0 && feed.products.length > 0
  // A real merchant normally has drafts/archived items. Excluding those from
  // a public feed is correct, not a mapping defect. Count them explicitly,
  // while refusing to certify unknown publication/status, invalid prices,
  // incomplete variants or any other unexpected omission.
  const isIntentionalExclusion = ({ reason }) =>
    reason === 'product is not published' || /^product status is (DRAFT|ARCHIVED)$/i.test(reason)
  const excludedUnpublished = result.skipped.filter(isIntentionalExclusion).length
  const invalidSkippedRecords = result.skipped.length - excludedUnpublished
  const catalogReady = hasUsableCatalog && invalidSkippedRecords === 0 &&
    result.warnings.length === 0 && missingImages === 0
  // Aggregate-only output: no product IDs, SKUs, names, prices or credentials.
  return {
    verified: catalogReady,
    traversalVerified: true,
    catalogReady,
    readOnly: true,
    currency,
    productPages: result.pages,
    publishedProductFamilies: result.snapshot.products.size,
    catalogVariants: feed.products.length,
    missingImages,
    skippedRecords: result.skipped.length,
    excludedUnpublished,
    invalidSkippedRecords,
    warnings: result.warnings.length,
    note: catalogReady
      ? 'Shopify Admin exact traversal and published VibeCart catalog contract verified; draft/archived/unpublished exclusions counted separately. MCP/UCP, freshness after audit and checkout NOT verified.'
      : 'Shopify Admin exact traversal completed, but no usable products, unexpected omissions, warnings or missing images prevent complete VibeCart catalog verification. MCP/UCP and checkout NOT verified.',
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const loaded = await loadTsModules(MODULE_PATHS)
    const sync = loaded['shopify-catalog-sync']
    const variant = loaded['shopify-variant-pages']
    const admin = loaded['shopify-admin-graphql']
    const allowedDocuments = new Set([
      sync.SHOPIFY_SHOP_CURRENCY_QUERY,
      sync.SHOPIFY_PRODUCTS_QUERY,
      variant.SHOPIFY_VARIANTS_QUERY,
      admin.SHOPIFY_PRODUCTS_COUNT_QUERY,
    ])
    const execute = createReadOnlyShopifyTransport({
      shopDomain: process.env.SHOPIFY_AUDIT_SHOP,
      token: process.env.SHOPIFY_AUDIT_READ_TOKEN,
      apiVersion: process.env.SHOPIFY_AUDIT_API_VERSION ?? '2026-10',
      allowedDocuments,
    })
    const result = await auditShopifyCatalogReadOnly({
      execute,
      expectedCurrencyCode: process.env.SHOPIFY_AUDIT_CURRENCY,
      modules: loaded,
    })
    console.log(JSON.stringify(result))
  } catch {
    // Do not print private token, Shopify response body, or raw catalog details.
    console.error('Shopify read-only catalog audit failed; verify private credentials, schema, exact counts and pagination.')
    process.exitCode = 1
  }
}
