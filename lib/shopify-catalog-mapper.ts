import type { VibeProduct } from '@/lib/products'

/**
 * Shopify -> VibeCart trusted catalog mapper (Issue #94).
 *
 * Pure function: no network, no credentials, no database, no payment code.
 * Accepts Shopify Admin REST product JSON or Admin/Storefront GraphQL product
 * JSON and returns entries in the shape lib/catalog-source.ts validates.
 *
 * Rules:
 * - One catalog entry per Shopify variant. Entry id = the real Shopify variant id
 *   (the global id when Shopify supplies admin_graphql_api_id, else the id as given).
 * - Real product id, variant id and SKU are kept in the extra sku and shopify
 *   fields. lib/catalog-source.ts strips those fields when it parses a feed, so
 *   server-side code must keep its own lookup (see lib/shopify-catalog-sync.ts).
 * - currencyCode is REQUIRED (the shop currency). There is no default. Embedded
 *   price currencies must match it. Currencies that do not use two minor-unit
 *   digits are rejected because priceCents assumes two.
 * - Prices must be decimal strings and become integer minor units using integer
 *   arithmetic only. Floats, more than two decimals and negatives are rejected,
 *   never rounded or converted.
 * - Nothing is invented: no fitment, SKU, price or availability defaults.
 *   Unpublished products and truncated variant lists are skipped with a reason.
 * - Inventory quantity NEVER excludes a variant. Made-to-order products legitimately
 *   report zero on hand. The actual Shopify inventory policy (DENY or CONTINUE) is
 *   carried through unchanged in shopify.inventoryPolicy for server-side use. The
 *   quantity is retained only in server-side Shopify metadata as a diagnostic;
 *   it is not checkout authorization or a public catalog field.
 */

export type ShopifyCatalogProduct = VibeProduct & {
  sku?: string
  shopify: { productId: string; variantId: string; inventoryPolicy?: 'DENY' | 'CONTINUE'; inventoryQuantity?: number | null; inventoryTracked?: boolean | null; availableForSale?: boolean }
}

export type ShopifyMapSkip = { productId?: string; variantId?: string; reason: string }

export type ShopifyMapResult = {
  products: ShopifyCatalogProduct[]
  skipped: ShopifyMapSkip[]
  warnings: string[]
}

export type ShopifyMapOptions = {
  /** Shop currency from Shopify (shop.currencyCode). Required, no default. */
  currencyCode: string
  /** Keep products whose publishedAt / published_at is explicitly null. Default false. */
  includeUnpublished?: boolean
}

type Json = Record<string, unknown>

const LIMITS = { id: 200, name: 500, variant: 500, description: 5000, image: 2000, sku: 200 }

const NON_TWO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
])

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** Validates an ISO 4217 code and rejects currencies priceCents cannot represent. Throws on any problem. */
export function normalizeCurrency(code: unknown): string {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('currencyCode is required (ISO 4217 such as USD)')
  // A three-letter shape alone does not establish an actual currency. Reject
  // synthetic/unknown codes before they can label real merchant prices.
  // Node 22's ICU currency registry is used for validation, not conversion.
  if (!Intl.supportedValuesOf('currency').includes(normalized)) {
    throw new Error('currency ' + normalized + ' is not a supported ISO 4217 currency')
  }
  // A hand-maintained exception list misses some valid zero-minor-unit codes
  // (for example AFN, ALL, ISK and MMK). Using them with priceCents would
  // mislabel whole-unit prices as cents. Check Node ICU's actual ISO 4217
  // minor-unit metadata as well as the conservative legacy exclusions.
  const minorUnits = new Intl.NumberFormat('en', {
    style: 'currency', currency: normalized,
  }).resolvedOptions().maximumFractionDigits
  if (minorUnits !== 2 || NON_TWO_DECIMAL_CURRENCIES.has(normalized)) {
    throw new Error('currency ' + normalized + ' does not use two minor-unit digits and is not supported')
  }
  return normalized
}

/** Returns the identifier exactly as Shopify gave it (numeric id, numeric string or gid). */
export function shopifyId(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined
  return text(value)
}

function idOf(entry: Json): string | undefined {
  return shopifyId(entry.admin_graphql_api_id) ?? shopifyId(entry.id)
}

/** Converts a non-negative decimal string such as 19.99 to integer cents. Throws on anything inexact. */
export function priceToCents(amount: unknown): number {
  if (amount === undefined || amount === null) throw new Error('price is missing')
  if (typeof amount !== 'string') throw new Error('price must be a decimal string, not a number')
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) throw new Error('price is not a non-negative decimal string: ' + JSON.stringify(amount))
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  if (fraction.length > 2) throw new Error('price has more than two decimal places: ' + amount.trim())
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('price is too large')
  return cents
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isObject(value)) {
    if (Array.isArray(value.nodes)) return value.nodes
    if (Array.isArray(value.edges)) return value.edges.map(edge => (isObject(edge) ? edge.node : undefined))
  }
  return []
}

function httpsUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw || raw.length > LIMITS.image) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function imageUrl(value: unknown): string | undefined {
  if (isObject(value)) return httpsUrl(value.url ?? value.src ?? value.originalSrc)
  return httpsUrl(value)
}

function variantImage(variant: Json, images: unknown[]): string | undefined {
  const direct = imageUrl(variant.image)
  if (direct) return direct
  const imageId = shopifyId(variant.image_id)
  if (!imageId) return undefined
  for (const image of images) {
    if (isObject(image) && shopifyId(image.id) === imageId) return imageUrl(image)
  }
  return undefined
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function describe(product: Json): string {
  const plain = text(product.description)
  const result = plain ?? plainText(text(product.body_html) ?? text(product.descriptionHtml) ?? '')
  return result.slice(0, LIMITS.description)
}

function variantPriceCents(variant: Json, expectedCurrency: string): number {
  const parse = (raw: unknown): number => {
    if (isObject(raw)) {
      const currency = text(raw.currencyCode)
      // MoneyV2 prices must carry their own currency. Assuming the shop currency
      // for an unlabelled Money object can silently misprice a merchant catalog.
      if (!currency) throw new Error('price currencyCode is missing')
      if (currency.toUpperCase() !== expectedCurrency) {
        throw new Error('price currency ' + currency + ' does not match expected ' + expectedCurrency)
      }
      return priceToCents(raw.amount)
    }
    return priceToCents(raw)
  }
  // Mixed REST/GraphQL snapshots can carry both representations. Never silently
  // prefer one if the other disagrees: the chosen cents could be the wrong price.
  if (variant.price != null && variant.priceV2 != null) {
    const cents = parse(variant.price)
    if (cents !== parse(variant.priceV2)) {
      throw new Error('conflicting Shopify price and priceV2 amounts')
    }
    return cents
  }
  return parse(variant.price ?? variant.priceV2)
}

function productList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (isObject(input)) return asList(input.products)
  return []
}

export function mapShopifyProducts(input: unknown, options: ShopifyMapOptions): ShopifyMapResult {
  const expectedCurrency = normalizeCurrency(options?.currencyCode)
  const includeUnpublished = options?.includeUnpublished === true
  const result: ShopifyMapResult = { products: [], skipped: [], warnings: [] }
  const seen = new Set<string>()

  const skip = (productId: string | undefined, variantId: string | undefined, reason: string) => {
    result.skipped.push({
      ...(productId ? { productId } : {}),
      ...(variantId ? { variantId } : {}),
      reason,
    })
  }

  for (const entry of productList(input)) {
    if (!isObject(entry)) {
      skip(undefined, undefined, 'product entry is not an object')
      continue
    }
    const productId = idOf(entry)
    if (!productId) {
      skip(undefined, undefined, 'product id is missing')
      continue
    }
    const name = text(entry.title)
    if (!name || name.length > LIMITS.name) {
      skip(productId, undefined, 'product title is missing or longer than ' + LIMITS.name)
      continue
    }
    const status = text(entry.status)
    if (status && status.toLowerCase() !== 'active') {
      skip(productId, undefined, 'product status is ' + status)
      continue
    }
    if (!includeUnpublished && (entry.publishedAt === null || entry.published_at === null)) {
      skip(productId, undefined, 'product is not published')
      continue
    }
    const connection = entry.variants
    if (isObject(connection)) {
      // A GraphQL connection must prove its variant list is complete.
      // Legacy REST arrays are not connections and remain supported.
      if (!isObject(connection.pageInfo) || typeof connection.pageInfo.hasNextPage !== 'boolean') {
        skip(productId, undefined, 'variant pagination status unknown: pageInfo.hasNextPage missing or invalid')
        continue
      }
      if (connection.pageInfo.hasNextPage) {
        skip(productId, undefined, 'variant list is truncated (pageInfo.hasNextPage); fetch every variant before exposing this product')
        continue
      }
    }
    const variants = asList(entry.variants)
    if (variants.length === 0) {
      skip(productId, undefined, 'product has no variants')
      continue
    }

    const images = asList(entry.images)
    const description = describe(entry)
    const featuredMedia = isObject(entry.featuredMedia) ? entry.featuredMedia : undefined
    const preview = featuredMedia && isObject(featuredMedia.preview) ? featuredMedia.preview : undefined
    const mediaPreviewImage = preview ? imageUrl(preview.image) : undefined
    const mediaFallback = asList(entry.media)
      .map(item => isObject(item) && isObject(item.preview) ? imageUrl(item.preview.image) : undefined)
      .find(url => url !== undefined)
    const restImageFallback = images.map(imageUrl).find(url => url !== undefined)
    const fallbackImage = mediaPreviewImage ?? mediaFallback ?? imageUrl(entry.featuredImage) ?? imageUrl(entry.image) ?? restImageFallback
    // The first Admin media page can contain only video/external-media items
    // while an image exists on a later page. Without a usable image and with
    // more media pages outstanding, do not claim the product is imageless or
    // certify a complete merchant catalog from a partial media inspection.
    // This is a whole-family rejection; a future media paginator can resolve it.
    // A malformed or missing GraphQL media pageInfo cannot establish that
    // an imageless product was fully inspected. Do not report a definitive
    // missing-image result from an unknown or nonterminal media connection.
    // REST-style media arrays and products with a verified safe image remain
    // compatible without requiring GraphQL pagination metadata.
    const mediaConnection = isObject(entry.media) ? entry.media : undefined
    const mediaPageInfo = mediaConnection?.pageInfo
    if (!fallbackImage && mediaConnection &&
        (!isObject(mediaPageInfo) || typeof mediaPageInfo.hasNextPage !== 'boolean' ||
         mediaPageInfo.hasNextPage)) {
      skip(productId, undefined, 'image coverage unverified: Shopify media pagination missing, invalid or incomplete')
      continue
    }

    for (const variant of variants) {
      if (!isObject(variant)) {
        skip(productId, undefined, 'variant entry is not an object')
        continue
      }
      const variantId = idOf(variant)
      if (!variantId || variantId.length > LIMITS.id) {
        skip(productId, undefined, 'variant id is missing or longer than ' + LIMITS.id)
        continue
      }
      if (seen.has(variantId)) {
        skip(productId, variantId, 'duplicate variant id')
        continue
      }
      let priceCents: number
      try {
        priceCents = variantPriceCents(variant, expectedCurrency)
      } catch (error) {
        skip(productId, variantId, error instanceof Error ? error.message : 'invalid price')
        continue
      }
      const title = text(variant.title)
      const variantTitle = title && title.toLowerCase() !== 'default title' ? title : undefined
      if (variantTitle && variantTitle.length > LIMITS.variant) {
        skip(productId, variantId, 'variant title is longer than ' + LIMITS.variant)
        continue
      }
      // A SKU is a merchant identity, not display copy. Preserve its exact
      // bytes (including meaningful spaces) or reject the variant; silently
      // trimming/dropping an unsupported SKU breaks downstream order mapping.
      const rawSku = variant.sku
      if (rawSku !== undefined && rawSku !== null && typeof rawSku !== 'string') {
        skip(productId, variantId, 'variant sku is not a string')
        continue
      }
      // An explicitly empty Shopify SKU is optional, but a nonempty
      // whitespace-only value is corrupted merchant identity. Do not silently
      // turn it into an absent SKU while publishing a variant.
      if (typeof rawSku === 'string' && rawSku.length > 0 && !rawSku.trim()) {
        skip(productId, variantId, 'variant sku is whitespace-only')
        continue
      }
      const sku = typeof rawSku === 'string' && rawSku.length > 0 ? rawSku : undefined
      if (sku && sku.length > LIMITS.sku) {
        skip(productId, variantId, 'variant sku is longer than ' + LIMITS.sku)
        continue
      }

      // Mixed REST/GraphQL snapshots can carry both policy spellings. Reject
      // contradictory values instead of trusting the preferred field: DENY
      // versus CONTINUE changes whether Shopify permits overselling.
      const graphPolicyPresent = Object.prototype.hasOwnProperty.call(variant, 'inventoryPolicy')
      const restPolicyPresent = Object.prototype.hasOwnProperty.call(variant, 'inventory_policy')
      const graphPolicy = text(variant.inventoryPolicy)?.toUpperCase()
      const restPolicy = text(variant.inventory_policy)?.toUpperCase()
      if (graphPolicyPresent && restPolicyPresent &&
          (!graphPolicy || !restPolicy || graphPolicy !== restPolicy)) {
        skip(productId, variantId, 'conflicting Shopify inventory policies')
        continue
      }
      const rawPolicy = text(variant.inventoryPolicy ?? variant.inventory_policy)
      const policyUpper = rawPolicy ? rawPolicy.toUpperCase() : undefined
      const inventoryPolicy = policyUpper === 'DENY' || policyUpper === 'CONTINUE' ? policyUpper : undefined
      if (rawPolicy && !inventoryPolicy) {
        result.warnings.push('variant ' + variantId + ' has unrecognized inventory policy ' + rawPolicy + ' and it was not carried through')
      }

      // Admin GraphQL and REST both expose quantity, but it is a snapshot,
      // not proof of sellability (tracking may be disabled and values can age).
      // Preserve negative oversold values and explicit null/unknown; reject
      // malformed or contradictory quantities rather than silently losing them.
      const graphQuantityPresent = Object.prototype.hasOwnProperty.call(variant, 'inventoryQuantity')
      const restQuantityPresent = Object.prototype.hasOwnProperty.call(variant, 'inventory_quantity')
      if (graphQuantityPresent && restQuantityPresent && variant.inventoryQuantity !== variant.inventory_quantity) {
        skip(productId, variantId, 'conflicting Shopify inventory quantities')
        continue
      }
      const rawQuantity = graphQuantityPresent ? variant.inventoryQuantity : variant.inventory_quantity
      if (rawQuantity !== undefined && rawQuantity !== null &&
          (typeof rawQuantity !== 'number' || !Number.isSafeInteger(rawQuantity))) {
        skip(productId, variantId, 'inventory quantity must be a safe integer or null')
        continue
      }
      const inventoryQuantity = rawQuantity === null ? null : rawQuantity as number | undefined

      // Shopify can offer a zero-quantity DENY variant when inventory tracking
      // is disabled. Preserve tracking and availableForSale separately; neither
      // cached observation authorizes an order without a fresh merchant check.
      const availabilityPresent = Object.prototype.hasOwnProperty.call(variant, 'availableForSale')
      if (availabilityPresent && typeof variant.availableForSale !== 'boolean') {
        skip(productId, variantId, 'availableForSale must be a boolean when supplied')
        continue
      }
      const availableForSale = availabilityPresent ? variant.availableForSale as boolean : undefined
      const inventoryItemPresent = Object.prototype.hasOwnProperty.call(variant, 'inventoryItem')
      const inventoryItem = variant.inventoryItem
      if (inventoryItemPresent && inventoryItem !== null &&
          (!isObject(inventoryItem) || typeof inventoryItem.tracked !== 'boolean')) {
        skip(productId, variantId, 'inventoryItem.tracked must be a boolean or inventoryItem null')
        continue
      }
      const inventoryTracked = !inventoryItemPresent ? undefined
        : inventoryItem === null ? null : (inventoryItem as Json).tracked as boolean

      seen.add(variantId)
      result.products.push({
        id: variantId,
        name,
        description,
        priceCents,
        // Cached Shopify observations cannot certify sellability; fail closed.
        availability: 'unknown',
        image: variantImage(variant, images) ?? fallbackImage ?? '',
        ...(variantTitle ? { variant: variantTitle } : {}),
        ...(sku ? { sku } : {}),
        shopify: { productId, variantId, ...(inventoryPolicy ? { inventoryPolicy } : {}),
          ...(inventoryQuantity !== undefined ? { inventoryQuantity } : {}),
          ...(inventoryTracked !== undefined ? { inventoryTracked } : {}),
          ...(availableForSale !== undefined ? { availableForSale } : {}) },
      })
    }
  }

  return result
}
