/**
 * Offline Shopify Admin GraphQL variant pagination (Issue #94).
 * Fetch callbacks are injected; no credentials, network access or writes here.
 * Rejects incomplete pages instead of silently dropping variants.
 */
export const SHOPIFY_VARIANTS_QUERY =
  'query VibeCartProductVariants($productId: ID!, $cursor: String) { ' +
  'product(id: $productId) { id variantsCount { count precision } variants(first: 100, after: $cursor) { ' +
  'pageInfo { hasNextPage endCursor } nodes { id title sku price inventoryPolicy inventoryQuantity } ' +
  '} } }'

type RecordValue = Record<string, unknown>
export type ShopifyVariantConnection = {
  nodes?: unknown[]
  edges?: Array<{ node: unknown }>
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}
export type ShopifyVariantPage = {
  productId: string
  variants: ShopifyVariantConnection
  /** Fresh exact count returned by Admin on every continuation request. */
  variantsCount?: { count: number; precision: string }
}
export type ShopifyRawProductsPage = {
  products: unknown[]
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}
export type VariantPageOptions = {
  fetchVariantPage: (productId: string, cursor: string) => Promise<ShopifyVariantPage>
  maxVariantPages?: number
  maxVariantsPerProduct?: number
}
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function unpackConnection(value: unknown): { nodes: unknown[]; hasNextPage: boolean; endCursor: string | null } {
  if (!isRecord(value) || !isRecord(value.pageInfo) || typeof value.pageInfo.hasNextPage !== 'boolean') {
    throw new Error('invalid Shopify variant connection or pageInfo')
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes
    : Array.isArray(value.edges) ? value.edges.map(edge => isRecord(edge) ? edge.node : undefined) : null
  if (!nodes) throw new Error('Shopify variant connection is missing nodes/edges')
  return {
    nodes,
    hasNextPage: value.pageInfo.hasNextPage,
    endCursor: typeof value.pageInfo.endCursor === 'string' ? value.pageInfo.endCursor : null,
  }
}
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9]\d*$/
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/

function variantId(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string' || !VARIANT_GID.test(value.id)) {
    throw new Error('Shopify variant page contains a missing or invalid variant id (ProductVariant gid required)')
  }
  return value.id
}
/** Returns a new, fully hydrated product or throws; never mutates the original. */
export async function hydrateShopifyProductVariants(raw: unknown, options: VariantPageOptions): Promise<unknown> {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !PRODUCT_GID.test(raw.id)) {
    throw new Error('Shopify Product gid is required for variant pagination')
  }
  const productId = raw.id
  const initial = unpackConnection(raw.variants)
  const originalCount = isRecord(raw.variantsCount) && raw.variantsCount.precision === 'EXACT' &&
    typeof raw.variantsCount.count === 'number' && Number.isSafeInteger(raw.variantsCount.count)
    ? raw.variantsCount.count : null
  // Admin GraphQL requests at most 100 variants per page. A zero-item
  // nonterminal page or an oversized page cannot prove complete traversal.
  if (initial.nodes.length > 100 || (initial.nodes.length === 0 && initial.hasNextPage)) {
    throw new Error('invalid Shopify initial variant page size for ' + productId)
  }
  const maxPages = options.maxVariantPages ?? 30
  const maxVariants = options.maxVariantsPerProduct ?? 3000
  // Caller overrides may tighten defaults but must not bypass the hard request/memory caps.
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 30 ||
      !Number.isSafeInteger(maxVariants) || maxVariants < 1 || maxVariants > 3000) {
    throw new Error('invalid Shopify variant pagination limits')
  }
  const seen = new Set<string>()
  const all: unknown[] = []
  const append = (nodes: unknown[]) => {
    for (const node of nodes) {
      const id = variantId(node)
      // Admin GraphQL must positively report sellability policy. Never silently
      // publish a variant whose DENY/CONTINUE rule is missing or unrecognized.
      const policy = isRecord(node) ? node.inventoryPolicy : undefined
      if (policy !== 'DENY' && policy !== 'CONTINUE') {
        throw new Error('Shopify variant page contains missing or invalid inventoryPolicy for ' + id)
      }
      if (seen.has(id)) throw new Error('duplicate Shopify variant id across pages: ' + id)
      seen.add(id)
      all.push(node)
      if (all.length > maxVariants) throw new Error('Shopify variant count exceeds limit for ' + productId)
    }
  }
  append(initial.nodes)
  let page = initial
  let pages = 1
  const cursors = new Set<string>()
  while (page.hasNextPage) {
    if (pages >= maxPages) throw new Error('Shopify variant page limit exceeded for ' + productId)
    const cursor = page.endCursor
    if (!cursor || cursors.has(cursor)) throw new Error('Shopify variant cursor did not advance for ' + productId)
    cursors.add(cursor)
    const next = await options.fetchVariantPage(productId, cursor)
    if (!next || next.productId !== productId) throw new Error('Shopify variant page product id mismatch for ' + productId)
    // A product's variants can change while the >100-variant family is being
    // fetched. Comparing only the original count with the accumulated rows
    // can silently accept a stale or mixed catalog. Require fresh EXACT count
    // evidence from each continuation whenever the original count is known.
    if (originalCount !== null) {
      const fresh = next.variantsCount
      if (!fresh || fresh.precision !== 'EXACT' || !Number.isSafeInteger(fresh.count) ||
          fresh.count !== originalCount) {
        throw new Error('Shopify variant count changed or became unverifiable during pagination for ' + productId)
      }
    }
    page = unpackConnection(next.variants)
    if (page.nodes.length > 100) throw new Error('Shopify continuation variant page exceeds first: 100 for ' + productId)
    if (page.nodes.length === 0) throw new Error('empty Shopify continuation variant page for ' + productId)
    append(page.nodes)
    pages++
  }
  return { ...raw, variants: { nodes: all, pageInfo: { hasNextPage: false, endCursor: page.endCursor } } }
}
/** Wraps syncShopifyCatalog's injected product-page fetcher; preserves page atomicity. */
export function withHydratedShopifyVariants(
  fetchProductPage: (cursor: string | null) => Promise<ShopifyRawProductsPage>,
  options: VariantPageOptions,
): (cursor: string | null) => Promise<ShopifyRawProductsPage> {
  return async cursor => {
    const page = await fetchProductPage(cursor)
    if (!page || !Array.isArray(page.products) || !page.pageInfo || typeof page.pageInfo.hasNextPage !== 'boolean') {
      throw new Error('invalid Shopify products page')
    }
    if (page.products.length === 0 && page.pageInfo.hasNextPage) {
      throw new Error('empty Shopify product page with continuation; traversal completeness unknown')
    }
    const products: unknown[] = []
    for (const product of page.products) products.push(await hydrateShopifyProductVariants(product, options))
    return { ...page, products }
  }
}
