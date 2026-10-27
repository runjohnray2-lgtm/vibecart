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


const MAX_SHOPIFY_AUDIT_RESPONSE_BYTES = 1024 * 1024

/** Bound actual response bytes before buffering/decoding private Admin data. */
async function readBoundedShopifyJsonBody(response) {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared.trim()) &&
      BigInt(declared.trim()) > BigInt(MAX_SHOPIFY_AUDIT_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {})
    throw new Error('Shopify audit response too large')
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Shopify audit expected a streamable JSON response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let body = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_SHOPIFY_AUDIT_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Shopify audit response too large')
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return body
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Shopify audit invalid UTF-8 JSON response')
    throw error
  } finally {
    reader.releaseLock()
  }
}

export function createReadOnlyShopifyTransport({
  shopDomain, token, apiVersion = '2026-10', allowedDocuments,
  fetchImpl = fetch, maxRequests = 120,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
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
  if (!(allowedDocuments instanceof Set) || allowedDocuments.size !== 5 ||
      [...allowedDocuments].some(doc => typeof doc !== 'string' || !doc.trim().startsWith('query '))) {
    throw new Error('Shopify audit requires five approved read-only GraphQL documents')
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 120) {
    throw new Error('Shopify audit request limit must be between 1 and 120')
  }
  if (typeof sleepImpl !== 'function') throw new Error('Shopify audit requires a bounded retry timer')
  // Keep the approved operations immutable for this transport. A caller may
  // otherwise add a mutation to the original Set after construction and have
  // its Admin token sent with a write-capable GraphQL document.
  const approvedDocuments = new Set(allowedDocuments)
  if ([...approvedDocuments].some(doc => /\b(?:mutation|subscription)\b/i.test(doc))) {
    throw new Error('Shopify audit accepts read-only GraphQL queries only')
  }
  const endpoint = 'https://' + shopDomain + '/admin/api/' + apiVersion + '/graphql.json'
  let requests = 0
  return async (document, variables) => {
    if (!approvedDocuments.has(document)) {
      throw new Error('Shopify audit refused an unapproved GraphQL operation')
    }
    // Shopify may throttle an otherwise valid read-only Admin query with HTTP
    // 429 or a GraphQL THROTTLED error. Retry at most twice, never outside the
    // approved query allowlist, and charge EVERY attempt against maxRequests.
    // A long Retry-After is not shortened: stop rather than hammering Shopify.
    for (let attempt = 0; attempt < 3; attempt++) {
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
      const retry = async () => {
        if (attempt === 2) return false
        const raw = response?.headers?.get('retry-after')
        const seconds = typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim())
          ? Number(raw.trim()) : null
        if (seconds !== null && (!Number.isFinite(seconds) || seconds > 2)) {
          throw new Error('Shopify audit throttled; Retry-After exceeds safe wait limit')
        }
        const waitMs = seconds === null ? 250 * (2 ** attempt) : Math.ceil(seconds * 1000)
        await sleepImpl(waitMs)
        return true
      }
      if (response?.status === 429) {
        if (await retry()) continue
        throw new Error('Shopify audit HTTP 429; bounded retries exhausted')
      }
      if (!response || !response.ok) {
        throw new Error('Shopify audit HTTP ' + (response?.status ?? 'unavailable'))
      }
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        throw new Error('Shopify audit expected JSON')
      }
      const body = await readBoundedShopifyJsonBody(response)
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        throw new Error('Shopify audit received malformed JSON')
      }
      if (Array.isArray(parsed?.errors) && parsed.errors.length > 0 &&
          parsed.errors.every(error => error?.extensions?.code === 'THROTTLED')) {
        if (await retry()) continue
        throw new Error('Shopify audit GraphQL throttled; bounded retries exhausted')
      }
      return parsed
    }
    throw new Error('Shopify audit retries exhausted')
  }
}

async function auditShopifyCatalogReadOnlyInternal({ execute, expectedCurrencyCode, modules } = {}) {
  if (typeof execute !== 'function') throw new Error('Shopify audit needs a read-only transport')
  if (typeof expectedCurrencyCode !== 'string' || !expectedCurrencyCode.trim()) {
    throw new Error('Shopify audit requires the merchant expected currency')
  }
  const loaded = modules ?? await loadTsModules(MODULE_PATHS)
  const { createShopifyAdminCatalogSource } = loaded['shopify-admin-graphql']
  const { syncShopifyCatalog, toCatalogFeed, buildVariantIndex } = loaded['shopify-catalog-sync']
  const source = createShopifyAdminCatalogSource(execute)
  // Inventory observations cover ALL hydrated Shopify variants, including
  // DRAFT/unpublished families excluded from the public VibeCart feed. Do not
  // confuse these read-only counts with live checkout authorization.
  const observedInventory = { variants: 0, denyZero: 0, continueZero: 0, denyNegative: 0, continueNegative: 0, unknown: 0 }
  const fetchPage = async cursor => {
    const page = await source.fetchPage(cursor)
    for (const product of page.products) {
      const nodes = product?.variants?.nodes
      if (!Array.isArray(nodes)) throw new Error('Shopify audit expected hydrated variant nodes')
      for (const variant of nodes) {
        observedInventory.variants++
        const quantity = variant?.inventoryQuantity
        if (!Number.isSafeInteger(quantity)) {
          observedInventory.unknown++
        } else if (quantity === 0 && variant?.inventoryPolicy === 'DENY') {
          observedInventory.denyZero++
        } else if (quantity === 0 && variant?.inventoryPolicy === 'CONTINUE') {
          observedInventory.continueZero++
        } else if (quantity < 0 && variant?.inventoryPolicy === 'DENY') {
          observedInventory.denyNegative++
        } else if (quantity < 0 && variant?.inventoryPolicy === 'CONTINUE') {
          observedInventory.continueNegative++
        }
      }
    }
    return page
  }
  const currency = await source.fetchShopCurrency()
  let result
  try {
    result = await syncShopifyCatalog({
      shopCurrencyCode: currency, expectedCurrencyCode,
      fetchPage,
    })
  } catch (error) {
    // The lower-level Shopify adapter includes raw variant IDs in this
    // validation error. An operator audit must fail closed without returning
    // merchant identities to its caller or logs.
    if (error instanceof Error && /missing or invalid inventoryPolicy/.test(error.message)) {
      throw new Error('Shopify audit rejected a variant with missing or invalid inventory policy')
    }
    throw error
  }
  const feed = toCatalogFeed(result.snapshot)
  // The trusted variant index already rejects unknown inventory policies, but
  // its error includes the real Shopify variant ID. Fail earlier with only an
  // aggregate count so read-only audit errors never expose merchant identities.
  let unknownPolicyVariants = 0
  for (const variants of result.snapshot.products.values()) {
    for (const variant of variants) {
      if (variant.shopify.inventoryPolicy !== 'DENY' &&
          variant.shopify.inventoryPolicy !== 'CONTINUE') unknownPolicyVariants++
    }
  }
  if (unknownPolicyVariants > 0) {
    throw new Error('Shopify audit rejected ' + unknownPolicyVariants +
      (unknownPolicyVariants === 1 ? ' variant' : ' variants') +
      ' with missing or invalid inventory policy')
  }
  const index = buildVariantIndex(result.snapshot)
  if (index.size !== feed.products.length) {
    throw new Error('Shopify audit variant index and catalog disagree')
  }
  // Report the merchant's actual Shopify inventory policies separately from
  // sellability. DENY with zero stock is not purchasable; CONTINUE may be
  // manufactured to order. This audit has no fresh stock/checkout authority.
  let denyPolicyVariants = 0
  let continuePolicyVariants = 0
  for (const ref of index.values()) {
    if (ref.inventoryPolicy === 'DENY') denyPolicyVariants++
    else if (ref.inventoryPolicy === 'CONTINUE') continuePolicyVariants++
  }
  // A successful Shopify traversal proves transport and exact pagination, NOT
  // that every record mapped into a usable VibeCart catalog. In particular,
  // unpublished, invalid or partially rejected product families are skipped.
  // Never label such an audit as fully verified without exposing the omissions.
  // The mapper intentionally permits an empty image for products with no
  // valid Shopify media. That is safe for parsing but not a verified merchant
  // beta catalog: report missing images instead of silently certifying them.
  const missingImages = feed.products.filter(product => !product.image).length
  // Variant counts and product-family counts answer different merchant questions.
  // One imageless product with hundreds of variants must not be reported as
  // hundreds of distinct products needing image remediation.
  const productFamiliesWithMissingImages = [...result.snapshot.products.values()]
    .filter(variants => variants.some(product => !product.image)).length
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
    // All-status Shopify observations, NOT just published/mapped catalog rows.
    observedShopifyVariants: observedInventory.variants,
    inventoryObservationsIncludeUnpublished: true,
    zeroStockDenyVariants: observedInventory.denyZero,
    zeroStockContinueVariants: observedInventory.continueZero,
    // Negative inventory can occur after overselling. It is not positive
    // on-hand stock; preserve the policy distinction for made-to-order goods.
    negativeStockDenyVariants: observedInventory.denyNegative,
    negativeStockContinueVariants: observedInventory.continueNegative,
    nonPositiveStockDenyVariants: observedInventory.denyZero + observedInventory.denyNegative,
    unknownInventoryQuantityVariants: observedInventory.unknown,
    denyPolicyVariants,
    continuePolicyVariants,
    sellabilityVerified: false,
    missingImages,
    productFamiliesWithMissingImages,
    skippedRecords: result.skipped.length,
    excludedUnpublished,
    invalidSkippedRecords,
    warnings: result.warnings.length,
    note: catalogReady
      ? 'Shopify Admin exact traversal and published VibeCart catalog contract verified; draft/archived/unpublished exclusions counted separately. MCP/UCP, freshness after audit and checkout NOT verified.'
      : 'Shopify Admin exact traversal completed, but no usable products, unexpected omissions, warnings or missing images prevent complete VibeCart catalog verification. MCP/UCP and checkout NOT verified.',
  }
}


/**
 * Public operator-audit boundary: lower-level adapters deliberately include
 * real Shopify IDs in diagnostic exceptions. Never let those identifiers,
 * raw transport messages or private shop data escape to callers/loggers.
 * Keep only two explicitly controlled categories useful to the operator.
 */
export async function auditShopifyCatalogReadOnly(options = {}) {
  try {
    return await auditShopifyCatalogReadOnlyInternal(options)
  } catch (error) {
    if (error instanceof Error &&
        /^Shopify audit rejected (?:a variant|\d+ variants?) with missing or invalid inventory policy$/.test(error.message)) {
      throw error
    }
    if (error instanceof Error &&
        /^shop currency [A-Z]{3} does not match the merchant catalog currency [A-Z]{3}$/.test(error.message)) {
      throw error
    }
    throw new Error('Shopify audit incomplete or invalid; private merchant details suppressed')
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
      admin.SHOPIFY_PRODUCT_MEDIA_QUERY,
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
