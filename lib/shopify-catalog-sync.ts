import type { VibeProduct } from '@/lib/products'
import { mapShopifyProducts, normalizeCurrency, shopifyId, type ShopifyCatalogProduct, type ShopifyMapSkip } from '@/lib/shopify-catalog-mapper'

/**
 * Offline Shopify catalog sync (Issue #94). Standalone, wired to nothing.
 *
 * - No network, no credentials, no database. The caller injects fetchPage, so every
 *   behavior here is testable without Shopify.
 * - VIBECART_SHOPIFY_SYNC_ENABLED is a reserved flag. isShopifySyncEnabled reads it from
 *   an env object the caller passes in, but nothing in the app calls it or this module yet.
 * - Output for the catalog feed contains only fields lib/catalog-source.ts accepts.
 *   That parser strips sku and shopify ids, so order write-back must use
 *   buildVariantIndex, a server-side lookup keyed by catalog id.
 * - Publication must be positively verified: a product whose publishedAt is not returned at
 *   all is not exposed (reason: publication status unknown).
 * - Inventory quantity never removes a product or variant. Made-to-order products report
 *   zero on hand. The Shopify inventory policy is kept on each snapshot entry
 *   (shopify.inventoryPolicy) and is not interpreted here.
 * - Live use is gated on merchant auth and tenant isolation (#56) and on real
 *   credentials. Do not expose a tenant-unscoped endpoint built on this.
 *
 * Use the Admin GraphQL API for every page so ids are consistently global ids.
 */

export const SHOPIFY_SYNC_FLAG = 'VIBECART_SHOPIFY_SYNC_ENABLED'

export const MAX_FEED_PRODUCTS = 10_000

/** Reference queries for the future connector. Schema fields reflect the read-only Radiantz Admin check; not executed by this module. */
export const SHOPIFY_SHOP_CURRENCY_QUERY = 'query { shop { currencyCode } }'

// Shopify rejects single Admin GraphQL queries above 1,000 requested cost points.
// Nesting 100 variants beneath 100 products can exceed that limit before any
// data is returned. Keep the first product page small; hydrate all remaining
// variants and products with the existing cursor-based pagination. The exact
// requested cost must still be checked against the live shop's API response.
export const SHOPIFY_PRODUCTS_QUERY = `query VibeCartProducts($cursor: String, $query: String) {
  products(first: 5, after: $cursor, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      description
      status
      publishedAt
      updatedAt
      featuredMedia { preview { image { url } } }
      media(first: 5) { nodes { id preview { image { url } } } }
      variantsCount { count precision }
      variants(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { id title sku price inventoryPolicy inventoryQuantity }
      }
    }
  }
}`

export type ShopifyCatalogSnapshot = {
  currencyCode: string
  /** Keyed by the numeric product id so gid and numeric ids refer to the same product. */
  products: ReadonlyMap<string, ShopifyCatalogProduct[]>
}

export type ShopifyVariantRef = { productId: string; variantId: string; sku?: string; inventoryPolicy: 'DENY' | 'CONTINUE' }

export type ShopifyApplyResult = {
  snapshot: ShopifyCatalogSnapshot
  upserted: number
  removed: number
  skipped: ShopifyMapSkip[]
  warnings: string[]
}

export type ShopifyProductsPage = {
  products: unknown[]
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}

export type ShopifySyncOptions = {
  /** shop.currencyCode as reported by Shopify. Required. */
  shopCurrencyCode: string
  /** Currency this merchant catalog is sold in. Must equal the shop currency. */
  expectedCurrencyCode: string
  fetchPage: (cursor: string | null) => Promise<ShopifyProductsPage>
  /** Existing snapshot to reconcile. Omit to build a new snapshot. */
  base?: ShopifyCatalogSnapshot
  /** Reserved unsafe legacy option. Destructive pruning is disabled pending independent traversal proof. */
  fullRefresh?: boolean
  maxPages?: number
  includeUnpublished?: boolean
}

export type ShopifySyncResult = ShopifyApplyResult & { pages: number }

export function isShopifySyncEnabled(env: Record<string, string | undefined>): boolean {
  return env[SHOPIFY_SYNC_FLAG]?.trim().toLowerCase() === 'true'
}

/** Digits at the end of a gid or numeric id, or undefined when there are none. */
export function shopifyNumericId(id: string): string | undefined {
  const tail = (id.split('?')[0] ?? '').split('/').pop() ?? ''
  return /^\d+$/.test(tail) ? tail : undefined
}

function rawProductId(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const entry = raw as Record<string, unknown>
  const id = shopifyId(entry.admin_graphql_api_id) ?? shopifyId(entry.id)
  // Never treat a ProductVariant, Collection, or malformed GID as a Product
  // merely because it ends with the same digits as an existing product.
  return id && /^(?:[1-9]\d*|gid:\/\/shopify\/Product\/[1-9]\d*)$/.test(id) ? id : undefined
}

function productKey(raw: unknown): string | undefined {
  const id = rawProductId(raw)
  return id ? (shopifyNumericId(id) ?? id) : undefined
}

/** Trusted sync must positively verify status; missing is not ACTIVE. */
function statusUnknown(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const status = (raw as Record<string, unknown>).status
  return typeof status !== 'string' || status.trim().length === 0
}

/** Null means explicitly unpublished; other publication values require a valid ISO timestamp. */
function publicationUnknown(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const entry = raw as Record<string, unknown>
  const publishedAt = entry.publishedAt !== undefined ? entry.publishedAt : entry.published_at
  if (publishedAt === null) return false
  if (typeof publishedAt !== 'string') return true
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(publishedAt)
  if (!match || !Number.isFinite(Date.parse(publishedAt))) return true
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return true
  const lastDay = new Date(0)
  lastDay.setUTCFullYear(year, month, 0)
  return day > lastDay.getUTCDate()
}

export function createSnapshot(currencyCode: string): ShopifyCatalogSnapshot {
  return { currencyCode: normalizeCurrency(currencyCode), products: new Map() }
}

/**
 * Upserts products into a copy of the snapshot. A product that no longer maps to any
 * variant (archived, unpublished, publication unknown, invalid price) is removed, so the
 * feed fails safe instead of offering something Shopify does not positively say is
 * sellable. Inventory quantity is never a reason to remove anything.
 */
export function applyProducts(
  snapshot: ShopifyCatalogSnapshot,
  rawProducts: unknown[],
  options: { includeUnpublished?: boolean } = {},
): ShopifyApplyResult {
  // A public snapshot must never be populated with unpublished Shopify items,
  // even when a caller accidentally forwards a diagnostic-only mapper option.
  if (options.includeUnpublished) {
    throw new Error('includeUnpublished is not permitted for public catalog snapshots')
  }
  const next = new Map(snapshot.products)
  const skipped: ShopifyMapSkip[] = []
  const warnings: string[] = []
  let upserted = 0
  let removed = 0

  for (const raw of rawProducts) {
    if (!options.includeUnpublished && publicationUnknown(raw)) {
      const id = rawProductId(raw)
      skipped.push({
        ...(id ? { productId: id } : {}),
        reason: 'publication status unknown: publishedAt was not returned, so the product is not exposed',
      })
      const unknownKey = productKey(raw)
      if (unknownKey && next.delete(unknownKey)) removed += 1
      continue
    }
    if (statusUnknown(raw)) {
      const id = rawProductId(raw)
      skipped.push({
        ...(id ? { productId: id } : {}),
        reason: 'product status unknown: status was not returned, so the product is not exposed',
      })
      const unknownKey = productKey(raw)
      if (unknownKey && next.delete(unknownKey)) removed += 1
      continue
    }
    const mapped = mapShopifyProducts([raw], {
      currencyCode: snapshot.currencyCode,
      includeUnpublished: options.includeUnpublished,
    })
    skipped.push(...mapped.skipped)
    warnings.push(...mapped.warnings)
    const key = productKey(raw)
    if (!key) continue
    // A partial variant family can misrepresent Shopify's purchasable choices.
    // Keep individual diagnostics, but do not publish valid siblings when any
    // variant in the same product was rejected by the mapper.
    if (mapped.products.length > 0 && mapped.skipped.length > 0) {
      const id = rawProductId(raw)
      skipped.push({
        ...(id ? { productId: id } : {}),
        reason: 'product variants incomplete: ' + mapped.skipped.length + ' rejected variant(s); entire family omitted',
      })
      if (next.delete(key)) removed += 1
      continue
    }
    // Direct sync callers can also bypass the GraphQL variant-page identity guard.
    // Only REST numeric variant ids or exact ProductVariant GIDs can enter the
    // trusted feed. A Product/Collection GID with the same numeric suffix must
    // never be treated as a purchasable Shopify variant.
    const invalidVariant = mapped.products.find(product =>
      !/^(?:[1-9]\d*|gid:\/\/shopify\/ProductVariant\/[1-9]\d*)$/.test(product.shopify.variantId),
    )
    if (invalidVariant) {
      skipped.push({
        ...(rawProductId(raw) ? { productId: rawProductId(raw) } : {}),
        variantId: invalidVariant.shopify.variantId,
        reason: 'invalid Shopify ProductVariant id; entire family omitted',
      })
      if (next.delete(key)) removed += 1
      continue
    }
    // Direct sync callers can bypass the GraphQL adapter. Require an actual
    // Shopify DENY/CONTINUE policy for every variant before publishing a family.
    // Zero quantity remains allowed for either policy; checkout authorization is separate.
    if (mapped.products.length > 0 && mapped.products.some(
      product => product.shopify.inventoryPolicy !== 'DENY' && product.shopify.inventoryPolicy !== 'CONTINUE',
    )) {
      skipped.push({
        ...(rawProductId(raw) ? { productId: rawProductId(raw) } : {}),
        reason: 'inventory policy missing or invalid; entire family omitted',
      })
      if (next.delete(key)) removed += 1
      continue
    }
    if (mapped.products.length > 0) {
      next.set(key, mapped.products)
      upserted += 1
    } else if (next.delete(key)) {
      removed += 1
    }
  }

  return { snapshot: { currencyCode: snapshot.currencyCode, products: next }, upserted, removed, skipped, warnings }
}

/** Handles products/delete payloads. Accepts numeric ids or global ids. */
export function applyProductDeleted(
  snapshot: ShopifyCatalogSnapshot,
  ids: unknown[],
): { snapshot: ShopifyCatalogSnapshot; removed: number } {
  const next = new Map(snapshot.products)
  let removed = 0
  for (const id of ids) {
    // A products/delete event must identify a Product, not an arbitrary Shopify
    // resource with the same numeric suffix (e.g. ProductVariant/123).
    // Keep legacy REST numeric ids, but reject malformed/cross-resource GIDs.
    const raw = shopifyId(id)
    const key = raw && (/^[1-9]\d*$/.test(raw)
      ? raw
      : /^gid:\/\/shopify\/Product\/([1-9]\d*)$/.exec(raw)?.[1])
    if (key && next.delete(key)) removed += 1
  }
  return { snapshot: { currencyCode: snapshot.currencyCode, products: next }, removed }
}

/** A REST numeric id and its Admin ProductVariant GID are the same Shopify identity. */
function canonicalVariantKey(id: string): string {
  const match = /^(?:([1-9]\\d*)|gid:\/\/shopify\/ProductVariant\/([1-9]\\d*))$/.exec(id)
  if (!match) throw new Error('invalid Shopify variant id in snapshot: ' + id)
  return match[1] ?? match[2]!
}

/** Deterministic feed for VIBECART_CATALOG_URL: only fields the catalog parser accepts, sorted by id. */
export function toCatalogFeed(snapshot: ShopifyCatalogSnapshot, limit = MAX_FEED_PRODUCTS): { products: VibeProduct[] } {
  const seen = new Set<string>()
  const seenVariantKeys = new Set<string>()
  const products: VibeProduct[] = []
  for (const variants of snapshot.products.values()) {
    for (const p of variants) {
      if (seen.has(p.id)) throw new Error('duplicate catalog id in snapshot: ' + p.id)
      seen.add(p.id)
      const key = canonicalVariantKey(p.shopify.variantId)
      if (seenVariantKeys.has(key)) throw new Error('duplicate Shopify variant id in snapshot: ' + key)
      seenVariantKeys.add(key)
      products.push({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        image: p.image,
        ...(p.variant !== undefined ? { variant: p.variant } : {}),
      })
    }
  }
  if (products.length > limit) throw new Error('catalog would exceed ' + limit + ' products')
  products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { products }
}

/** Server-only lookup keyed by Shopify variant id. Retains identity, SKU and policy lost in the public feed.\n * A cached policy is NOT checkout authorization: Codex must independently recheck live sellability. */
export function buildVariantIndex(snapshot: ShopifyCatalogSnapshot): Map<string, ShopifyVariantRef> {
  const index = new Map<string, ShopifyVariantRef>()
  const seenVariantKeys = new Set<string>()
  for (const variants of snapshot.products.values()) {
    for (const p of variants) {
      if (index.has(p.id)) throw new Error('duplicate Shopify variant id in snapshot: ' + p.id)
      const key = canonicalVariantKey(p.shopify.variantId)
      if (seenVariantKeys.has(key)) throw new Error('duplicate Shopify variant id in snapshot: ' + key)
      seenVariantKeys.add(key)
      if (p.shopify.inventoryPolicy !== 'DENY' && p.shopify.inventoryPolicy !== 'CONTINUE') {
        throw new Error('Shopify variant index missing or invalid inventoryPolicy for ' + p.id)
      }
      index.set(p.id, {
        productId: p.shopify.productId,
        variantId: p.shopify.variantId,
        ...(p.sku ? { sku: p.sku } : {}),
        inventoryPolicy: p.shopify.inventoryPolicy,
      })
    }
  }
  return index
}

/**
 * Pages through products and returns a new snapshot. Atomic: if any page fails or a
 * guard trips, it throws and the base snapshot is untouched, so callers keep serving
 * the last known-good snapshot and should track its age.
 */
export async function syncShopifyCatalog(options: ShopifySyncOptions): Promise<ShopifySyncResult> {
  const shopCurrency = normalizeCurrency(options.shopCurrencyCode)
  const expectedCurrency = normalizeCurrency(options.expectedCurrencyCode)
  if (shopCurrency !== expectedCurrency) {
    throw new Error('shop currency ' + shopCurrency + ' does not match the merchant catalog currency ' + expectedCurrency)
  }
  if (options.base && options.base.currencyCode !== shopCurrency) {
    throw new Error('base snapshot currency ' + options.base.currencyCode + ' does not match ' + shopCurrency)
  }

  // Public sync must fail closed on unpublished-product overrides before any
  // caller-supplied Shopify transport can be invoked.
  if (options.includeUnpublished) {
    throw new Error('includeUnpublished is not permitted for public Shopify catalog sync')
  }

  // fetchPage is injected and may apply an unknown Shopify query/filter. Without
  // independent unfiltered traversal proof, absence is NOT evidence of deletion.
  if (options.fullRefresh) {
    throw new Error('fullRefresh requires independently verified unfiltered traversal; use explicit products/delete events instead')
  }

  const maxPages = options.maxPages ?? 200
  // Overrides may tighten the default but cannot bypass the product-page request cap.
  // Validate before invoking the caller's potentially metered Shopify transport.
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 200) {
    throw new Error('invalid Shopify product pagination limits')
  }
  let snapshot = options.base ?? createSnapshot(shopCurrency)
  const seenCursors = new Set<string>()
  const seenProductKeys = new Set<string>()
  const skipped: ShopifyMapSkip[] = []
  const warnings: string[] = []
  let upserted = 0
  let removed = 0
  let pages = 0
  let cursor: string | null = null

  for (;;) {
    pages += 1
    if (pages > maxPages) throw new Error('exceeded maxPages (' + maxPages + ') while paging products')
    const page = await options.fetchPage(cursor)
    if (!page || !Array.isArray(page.products) || !page.pageInfo || typeof page.pageInfo.hasNextPage !== 'boolean') {
      throw new Error('fetchPage returned an invalid page')
    }
    // Product pages must never repeat an identity: later pages could overwrite a variant family.
    for (const raw of page.products) {
      const key = productKey(raw)
      if (!key) {
        // An unidentified product cannot be reconciled safely in either a full
        // or incremental batch. Abort atomically rather than silently skipping it.
        throw new Error('Shopify sync contains a product with an invalid id')
      }
      if (seenProductKeys.has(key)) throw new Error('duplicate Shopify product id across sync pages: ' + key)
      seenProductKeys.add(key)
    }
    const applied = applyProducts(snapshot, page.products, { includeUnpublished: options.includeUnpublished })
    snapshot = applied.snapshot
    upserted += applied.upserted
    removed += applied.removed
    skipped.push(...applied.skipped)
    warnings.push(...applied.warnings)
    if (!page.pageInfo.hasNextPage) break
    const nextCursor = page.pageInfo.endCursor
    if (typeof nextCursor !== 'string' || !nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('pagination cursor did not advance')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  // Reject ambiguous variant ownership before a caller can publish or index the snapshot.
  buildVariantIndex(snapshot)
  return { snapshot, pages, upserted, removed, skipped, warnings }
}
