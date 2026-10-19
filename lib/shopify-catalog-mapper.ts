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
 *   quantity itself is not copied.
 */

export type ShopifyCatalogProduct = VibeProduct & {
  sku?: string
  shopify: { productId: string; variantId: string; inventoryPolicy?: 'DENY' | 'CONTINUE' }
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
  if (NON_TWO_DECIMAL_CURRENCIES.has(normalized)) {
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
    return url.protocol === 'https:' ? url.toString() : undefined
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
  const raw = variant.price ?? variant.priceV2
  if (isObject(raw)) {
    const currency = text(raw.currencyCode)
    if (currency && currency.toUpperCase() !== expectedCurrency) {
      throw new Error('price currency ' + currency + ' does not match expected ' + expectedCurrency)
    }
    return priceToCents(raw.amount)
  }
  return priceToCents(raw)
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
    if (isObject(connection) && isObject(connection.pageInfo) && connection.pageInfo.hasNextPage === true) {
      skip(productId, undefined, 'variant list is truncated (pageInfo.hasNextPage); fetch every variant before exposing this product')
      continue
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
    const fallbackImage = mediaPreviewImage ?? imageUrl(entry.featuredImage) ?? imageUrl(entry.image) ?? imageUrl(images[0])

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
      const rawSku = text(variant.sku)
      const sku = rawSku && rawSku.length <= LIMITS.sku ? rawSku : undefined
      if (rawSku && !sku) result.warnings.push('variant ' + variantId + ' sku is longer than ' + LIMITS.sku + ' and was dropped')

      const rawPolicy = text(variant.inventoryPolicy ?? variant.inventory_policy)
      const policyUpper = rawPolicy ? rawPolicy.toUpperCase() : undefined
      const inventoryPolicy = policyUpper === 'DENY' || policyUpper === 'CONTINUE' ? policyUpper : undefined
      if (rawPolicy && !inventoryPolicy) {
        result.warnings.push('variant ' + variantId + ' has unrecognized inventory policy ' + rawPolicy + ' and it was not carried through')
      }

      seen.add(variantId)
      result.products.push({
        id: variantId,
        name,
        description,
        priceCents,
        image: variantImage(variant, images) ?? fallbackImage ?? '',
        ...(variantTitle ? { variant: variantTitle } : {}),
        ...(sku ? { sku } : {}),
        shopify: { productId, variantId, ...(inventoryPolicy ? { inventoryPolicy } : {}) },
      })
    }
  }

  return result
}
