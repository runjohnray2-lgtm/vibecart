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
 *   zero on hand. Shopify policy and observed quantity remain server-only
 *   diagnostics, not checkout authorization; Codex must recheck live sellability.
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
// Explicit ID ordering stabilizes cursor traversal independent of Shopify's
// default sort behavior; independent EXACT counts still guard omissions.
// Nesting 100 variants beneath 100 products can exceed that limit before any
// data is returned. Keep the first product page small; hydrate all remaining
// variants and products with the existing cursor-based pagination. The exact
// requested cost must still be checked against the live shop's API response.
export const SHOPIFY_PRODUCTS_QUERY = `query VibeCartProducts($cursor: String, $query: String) {
  products(first: 5, after: $cursor, query: $query, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      description
      status
      publishedAt
      updatedAt
      featuredMedia { preview { image { url } } }
      media(first: 5) { pageInfo { hasNextPage endCursor } nodes { id preview { image { url } } } }
      variantsCount { count precision }
      variants(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { id title sku price inventoryPolicy inventoryQuantity availableForSale inventoryItem { tracked } }
      }
    }
  }
}`

export type ShopifyCatalogSnapshot = {
  currencyCode: string
  /** Keyed by the numeric product id so gid and numeric ids refer to the same product. */
  products: ReadonlyMap<string, ShopifyCatalogProduct[]>
}

export type ShopifyVariantRef = { productId: string; variantId: string; sku?: string; inventoryPolicy: 'DENY' | 'CONTINUE'; inventoryQuantity?: number | null; inventoryTracked?: boolean | null; availableForSale?: boolean }

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

/**
 * Shopify REST ids and Admin GIDs must identify the same resource when both
 * are supplied. Preferring one silently can associate another variant's price
 * or SKU with the wrong identity. GraphQL-only GIDs remain valid.
 */
function assertMatchingIds(raw: Record<string, unknown>, resource: 'Product' | 'ProductVariant'): void {
  if (raw.admin_graphql_api_id === undefined || raw.id === undefined) return
  const preferred = shopifyId(raw.admin_graphql_api_id)
  const other = shopifyId(raw.id)
  const prefix = 'gid://shopify/' + resource + '/'
  const key = (id: string | undefined): string | undefined => {
    if (!id) return undefined
    if (/^[1-9]\d*$/.test(id)) return id
    if (!id.startsWith(prefix)) return undefined
    const tail = id.slice(prefix.length)
    return /^[1-9]\d*$/.test(tail) ? tail : undefined
  }
  const first = key(preferred)
  const second = key(other)
  if (!first || !second || first !== second) {
    throw new Error('conflicting Shopify ' + resource + ' ids')
  }
}

function assertMatchingRecordIds(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const entry = raw as Record<string, unknown>
  assertMatchingIds(entry, 'Product')
  const variants = entry.variants
  const list = Array.isArray(variants) ? variants
    : variants && typeof variants === 'object'
      ? (variants as Record<string, unknown>).nodes ?? (variants as Record<string, unknown>).edges
      : undefined
  if (!Array.isArray(list)) return
  for (const item of list) {
    const variant = item && typeof item === 'object' && !Array.isArray(item) && 'node' in item
      ? (item as Record<string, unknown>).node : item
    if (variant && typeof variant === 'object' && !Array.isArray(variant)) {
      assertMatchingIds(variant as Record<string, unknown>, 'ProductVariant')
    }
  }
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
  const seenProductKeys = new Set<string>()

  for (const raw of rawProducts) {
    // Fail atomically rather than trusting a mismatched REST/GID identity.
    assertMatchingRecordIds(raw)
    // Direct applyProducts callers can bypass syncShopifyCatalog's page-level
    // duplicate guard. REST numeric IDs and Admin GIDs are the same product:
    // accepting both in one batch would silently let the later price win.
    const identity = productKey(raw)
    if (identity) {
      if (seenProductKeys.has(identity)) {
        throw new Error('duplicate Shopify product id in applyProducts batch: ' + identity)
      }
      seenProductKeys.add(identity)
    }
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
    // Direct sync callers may bypass the Admin GraphQL adapter. A GraphQL
    // variant connection MUST carry an independent EXACT variantsCount:
    // hasNextPage: false alone cannot prove the last page wasn't truncated.
    // Keep legacy REST variant arrays without variantsCount supported.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const entry = raw as Record<string, unknown>
      const connection = entry.variants
      const graphqlConnection = connection !== null && typeof connection === 'object' && !Array.isArray(connection)
      if (graphqlConnection || 'variantsCount' in entry) {
        const reported = entry.variantsCount
        const entries = Array.isArray(connection) ? connection
          : connection && typeof connection === 'object' && !Array.isArray(connection)
            ? (connection as Record<string, unknown>).nodes ?? (connection as Record<string, unknown>).edges
            : undefined
        const count = reported && typeof reported === 'object' && !Array.isArray(reported)
          ? reported as Record<string, unknown> : null
        if (!count || count.precision !== 'EXACT' ||
            typeof count.count !== 'number' || !Number.isSafeInteger(count.count) ||
            count.count < 0 || !Array.isArray(entries) || entries.length !== count.count) {
          const id = rawProductId(raw)
          skipped.push({
            ...(id ? { productId: id } : {}),
            reason: 'Shopify exact variantsCount missing, approximate or mismatched; entire family omitted',
          })
          const key = productKey(raw)
          if (key && next.delete(key)) removed += 1
          continue
        }
      }
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
  const match = /^(?:([1-9]\d*)|gid:\/\/shopify\/ProductVariant\/([1-9]\d*))$/.exec(id)
  if (!match) throw new Error('invalid Shopify variant id in snapshot: ' + id)
  return match[1] ?? match[2]!
}

/** A snapshot's family key must identify the same Shopify Product as every variant's owner. */
function assertSnapshotProductOwnership(familyKey: string, product: ShopifyCatalogProduct): void {
  const id = product.shopify.productId
  const match = /^(?:([1-9]\d*)|gid:\/\/shopify\/Product\/([1-9]\d*))$/.exec(id)
  if (!match || (match[1] ?? match[2]) !== familyKey) {
    throw new Error('Shopify snapshot product id mismatch for catalog variant: ' + product.id)
  }
}

/** Rehydrated snapshots bypass the mapper: never publish a malformed image URL. */
function validSnapshotImage(image: unknown): image is string {
  if (typeof image !== 'string' || image.length > 2000) return false
  if (image === '') return true // Missing images are reported by the readiness audit.
  try {
    const url = new URL(image)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/** Restored snapshots bypass createSnapshot(): reject unsupported, malformed or
 * noncanonical currency metadata at both feed and server-only index boundaries.
 * This cannot prove that a valid currency matches the original price source.
 */
function assertSnapshotCurrency(snapshot: ShopifyCatalogSnapshot): void {
  const normalized = normalizeCurrency(snapshot.currencyCode)
  if (normalized !== snapshot.currencyCode) {
    throw new Error('invalid Shopify snapshot currencyCode: expected canonical uppercase currency')
  }
  // VibeCart's current cart and Stripe checkout charge USD unconditionally.
  // A correctly parsed EUR/CAD/GBP amount is still unsafe to publish as USD.
  // Keep non-USD mapping available for diagnostics, but block checkout feeds
  // and server-side variant lookups until currency is end-to-end supported.
  if (normalized !== 'USD') {
    throw new Error('Shopify currency ' + normalized + ' is unsupported by USD-only VibeCart payment currency')
  }
}

/** Restored snapshots bypass the mapper; keep server-only SKU and Shopify policy trustworthy. */
function assertSnapshotVariantMetadata(product: ShopifyCatalogProduct): void {
  // The server-only variant index can be built without generating the public
  // feed. A restored snapshot with corrupted cents must not pass that boundary.
  if (!Number.isSafeInteger(product.priceCents) || product.priceCents < 0) {
    throw new Error('invalid Shopify snapshot priceCents for catalog variant: ' + product.id)
  }
  if (product.shopify.inventoryPolicy !== 'DENY' && product.shopify.inventoryPolicy !== 'CONTINUE') {
    throw new Error('Shopify snapshot missing or invalid inventoryPolicy for catalog variant: ' + product.id)
  }
  const quantity = product.shopify.inventoryQuantity
  if (quantity !== undefined && quantity !== null &&
      (typeof quantity !== 'number' || !Number.isSafeInteger(quantity))) {
    throw new Error('invalid Shopify snapshot inventoryQuantity for catalog variant: ' + product.id)
  }
  // Cached tracking and availableForSale are diagnostics, not a checkout grant.
  // Missing means unknown, and explicit null inventory tracking stays unknown.
  const tracked = product.shopify.inventoryTracked
  if (tracked !== undefined && tracked !== null && typeof tracked !== 'boolean') {
    throw new Error('invalid Shopify snapshot inventoryTracked for catalog variant: ' + product.id)
  }
  const available = product.shopify.availableForSale
  if (available !== undefined && typeof available !== 'boolean') {
    throw new Error('invalid Shopify snapshot availableForSale for catalog variant: ' + product.id)
  }
  // A merchant SKU is an exact identifier, not display text. Preserve meaningful
  // whitespace, but reject corrupted non-string, blank or oversized values.
  const sku = product.sku
  if (sku !== undefined && (typeof sku !== 'string' || !sku.trim() || sku.length > 200)) {
    throw new Error('invalid Shopify snapshot sku for catalog variant: ' + product.id)
  }
}

/** A restored server-side index must never accept variants the public feed would reject. */
function assertSnapshotDisplayFields(p: ShopifyCatalogProduct): void {
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 500) {
    throw new Error('invalid Shopify snapshot name for catalog variant: ' + p.id)
  }
  if (typeof p.description !== 'string' || p.description.length > 5000) {
    throw new Error('invalid Shopify snapshot description for catalog variant: ' + p.id)
  }
  if (p.variant !== undefined &&
      (typeof p.variant !== 'string' || !p.variant.trim() || p.variant.trim().length > 500)) {
    throw new Error('invalid Shopify snapshot variant title for catalog variant: ' + p.id)
  }
  if (!validSnapshotImage(p.image)) {
    throw new Error('invalid Shopify snapshot image for catalog variant: ' + p.id)
  }
}

/** Restored snapshots must not silently omit an entire Shopify product family. */
function assertSnapshotFamilyVariants(variants: unknown): void {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('Shopify snapshot family has no valid variants')
  }
}

/** Deterministic feed for VIBECART_CATALOG_URL: only fields the catalog parser accepts, sorted by id. */
export function toCatalogFeed(snapshot: ShopifyCatalogSnapshot, limit = MAX_FEED_PRODUCTS): { products: VibeProduct[] } {
  assertSnapshotCurrency(snapshot)
  // This is a public feed boundary. An invalid override must not bypass the
  // hard catalog size cap (Infinity/NaN previously disabled the comparison).
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_FEED_PRODUCTS) {
    throw new Error('invalid Shopify catalog feed limit')
  }
  const seen = new Set<string>()
  const seenVariantKeys = new Set<string>()
  const products: VibeProduct[] = []
  for (const [familyKey, variants] of snapshot.products) {
    assertSnapshotFamilyVariants(variants)
    for (const p of variants) {
      assertSnapshotProductOwnership(familyKey, p)
      assertSnapshotVariantMetadata(p)
      if (seen.has(p.id)) throw new Error('duplicate catalog id in snapshot: ' + p.id)
      seen.add(p.id)
      const key = canonicalVariantKey(p.shopify.variantId)
      // A catalog id must identify the SAME real Shopify variant as the
      // server-only lookup. A mismatched persisted snapshot could otherwise
      // display one variant's price while routing an order to another.
      if (canonicalVariantKey(p.id) !== key) {
        throw new Error('Shopify catalog id and variant id mismatch: ' + p.id)
      }
      if (seenVariantKeys.has(key)) throw new Error('duplicate Shopify variant id in snapshot: ' + key)
      seenVariantKeys.add(key)
      assertSnapshotDisplayFields(p)
      products.push({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        image: p.image,
        ...(p.variant !== undefined ? { variant: p.variant } : {}),
      })
      // Stop immediately at the cap, before walking or allocating any further
      // untrusted snapshot entries. The caller retains its prior good feed.
      if (products.length > limit) throw new Error('catalog would exceed ' + limit + ' products')
    }
  }
  products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { products }
}

/** Server-only lookup keyed by Shopify variant id. Retains identity, SKU and policy lost in the public feed.\n * A cached policy is NOT checkout authorization: Codex must independently recheck live sellability. */
export function buildVariantIndex(snapshot: ShopifyCatalogSnapshot): Map<string, ShopifyVariantRef> {
  assertSnapshotCurrency(snapshot)
  const index = new Map<string, ShopifyVariantRef>()
  const seenVariantKeys = new Set<string>()
  for (const [familyKey, variants] of snapshot.products) {
    assertSnapshotFamilyVariants(variants)
    for (const p of variants) {
      // The public catalog feed refuses more than MAX_FEED_PRODUCTS variants.
      // A restored snapshot must not build a larger server-only lookup that
      // cannot correspond to any valid public feed or exhausts memory.
      if (index.size >= MAX_FEED_PRODUCTS) {
        throw new Error('Shopify variant index exceeds ' + MAX_FEED_PRODUCTS + ' products')
      }
      assertSnapshotProductOwnership(familyKey, p)
      assertSnapshotVariantMetadata(p)
      // The server-only lookup must not retain a variant the public feed would
      // reject (malformed title, description, variant label or image URL).
      assertSnapshotDisplayFields(p)
      if (index.has(p.id)) throw new Error('duplicate Shopify variant id in snapshot: ' + p.id)
      const key = canonicalVariantKey(p.shopify.variantId)
      // A catalog id must identify the SAME real Shopify variant as the
      // server-only lookup. A mismatched persisted snapshot could otherwise
      // display one variant's price while routing an order to another.
      if (canonicalVariantKey(p.id) !== key) {
        throw new Error('Shopify catalog id and variant id mismatch: ' + p.id)
      }
      if (seenVariantKeys.has(key)) throw new Error('duplicate Shopify variant id in snapshot: ' + key)
      seenVariantKeys.add(key)
      index.set(p.id, {
        productId: p.shopify.productId,
        variantId: p.shopify.variantId,
        ...(p.sku ? { sku: p.sku } : {}),
        // Required and runtime-validated by assertSnapshotVariantMetadata above.
        inventoryPolicy: p.shopify.inventoryPolicy!,
        ...(p.shopify.inventoryQuantity !== undefined ? { inventoryQuantity: p.shopify.inventoryQuantity } : {}),
        ...(p.shopify.inventoryTracked !== undefined ? { inventoryTracked: p.shopify.inventoryTracked } : {}),
        ...(p.shopify.availableForSale !== undefined ? { availableForSale: p.shopify.availableForSale } : {}),
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
  // Fail before any Admin page fetch: the downstream VibeCart cart/Stripe
  // contract currently hardcodes USD, regardless of Shopify's currency.
  if (shopCurrency !== 'USD') {
    throw new Error('Shopify currency ' + shopCurrency + ' is unsupported by USD-only VibeCart payment currency')
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
  // A restored base can bypass mapper validation. Reject corrupted cached
  // prices, variant identities, inventory policies or missing families BEFORE
  // calling the injected Shopify transport, not after a potentially metered
  // page traversal. Never silently heal a corrupt base with partial updates.
  if (options.base) buildVariantIndex(options.base)
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
    // Direct injected fetchers may bypass the Admin adapter's pagination guards.
    // An empty nonterminal page cannot prove a complete catalog traversal.
    if (page.products.length === 0 && page.pageInfo.hasNextPage) {
      throw new Error('empty Shopify product page with continuation; traversal completeness unknown')
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
