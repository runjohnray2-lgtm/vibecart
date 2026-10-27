import { SHOPIFY_PRODUCTS_QUERY, SHOPIFY_SHOP_CURRENCY_QUERY, type ShopifyProductsPage } from '@/lib/shopify-catalog-sync'
import { normalizeCurrency } from '@/lib/shopify-catalog-mapper'
import { SHOPIFY_VARIANTS_QUERY, withHydratedShopifyVariants, type ShopifyVariantPage } from '@/lib/shopify-variant-pages'

/**
 * Read-only Shopify Admin GraphQL response adapter for the offline catalog sync.
 * The caller supplies an authenticated transport; this module never fetches,
 * stores credentials, mutates Shopify, or makes an HTTP request itself.
 * GraphQL can return HTTP 200 with errors AND partial data: fail closed.
 */
/** An unfiltered count is required to catch missing whole product pages. */
export const SHOPIFY_PRODUCTS_COUNT_QUERY = 'query VibeCartProductsCount { productsCount(limit: null) { count precision } }'
/** Only read additional media when the first page has no usable image. */
export const SHOPIFY_PRODUCT_MEDIA_QUERY = 'query VibeCartProductMedia($productId: ID!, $cursor: String) { product(id: $productId) { id updatedAt media(first: 20, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id preview { image { url } } } } } }'

export type ShopifyGraphqlTransport = (document: string, variables: Record<string, unknown>) => Promise<unknown>
export type ShopifyAdminSourceOptions = {
  maxVariantPages?: number
  maxVariantsPerProduct?: number
  maxMediaPages?: number
}

type Json = Record<string, unknown>
function record(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function dataOf(response: unknown, operation: string): Json {
  if (!record(response)) throw new Error('invalid Shopify GraphQL ' + operation + ' response')
  if (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length > 0)) {
    // Do not echo Shopify error payloads: transport/provider errors may contain private details.
    throw new Error('Shopify GraphQL ' + operation + ' returned errors; partial data rejected')
  }
  if (!record(response.data)) throw new Error('Shopify GraphQL ' + operation + ' returned no data')
  return response.data
}
function connectionOf(value: unknown, operation: string): { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } {
  if (!record(value) || !Array.isArray(value.nodes) || !record(value.pageInfo) ||
      typeof value.pageInfo.hasNextPage !== 'boolean') {
    throw new Error('invalid Shopify ' + operation + ' connection')
  }
  const pageInfo = value.pageInfo
  const hasNextPage = pageInfo.hasNextPage === true
  const endCursor = typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null
  if (hasNextPage && (!endCursor || !endCursor.trim())) {
    throw new Error('Shopify ' + operation + ' continuation cursor missing')
  }
  return { nodes: value.nodes, pageInfo: { hasNextPage, endCursor } }
}

/**
 * Converts the actual Admin GraphQL data envelope into the sync contract and
 * hydrates ALL variant pages before exposing any product page.
 */
export function createShopifyAdminCatalogSource(
  execute: ShopifyGraphqlTransport,
  options: ShopifyAdminSourceOptions = {},
): {
  fetchShopCurrency: () => Promise<string>
  fetchPage: (cursor: string | null) => Promise<ShopifyProductsPage>
} {
  const fetchShopCurrency = async () => {
    const data = dataOf(await execute(SHOPIFY_SHOP_CURRENCY_QUERY, {}), 'shop currency')
    if (!record(data.shop)) throw new Error('Shopify shop currency missing')
    return normalizeCurrency(data.shop.currencyCode)
  }
  const fetchExactProductCount = async (): Promise<number> => {
    const data = dataOf(await execute(SHOPIFY_PRODUCTS_COUNT_QUERY, {}), 'product count')
    const count = data.productsCount
    if (!record(count) || count.precision !== 'EXACT' || typeof count.count !== 'number' ||
        !Number.isSafeInteger(count.count) || count.count < 0) {
      throw new Error('Shopify exact productsCount missing or approximate; refusing incomplete catalog')
    }
    return count.count
  }
  const fetchProducts = async (cursor: string | null): Promise<ShopifyProductsPage> => {
    const data = dataOf(await execute(SHOPIFY_PRODUCTS_QUERY, { cursor, query: null }), 'products')
    const connection = connectionOf(data.products, 'products')
    return { products: connection.nodes, pageInfo: connection.pageInfo }
  }
  const fetchVariantPage = async (productId: string, cursor: string): Promise<ShopifyVariantPage> => {
    const data = dataOf(await execute(SHOPIFY_VARIANTS_QUERY, { productId, cursor }), 'variants')
    if (!record(data.product) || data.product.id !== productId) {
      throw new Error('Shopify variant page product id mismatch')
    }
    const count = data.product.variantsCount
    if (!record(count) || count.precision !== 'EXACT' || typeof count.count !== 'number' ||
        !Number.isSafeInteger(count.count) || count.count < 0) {
      throw new Error('Shopify continuation exact variantsCount missing or approximate')
    }
    return { productId, variants: connectionOf(data.product.variants, 'variants'),
      variantsCount: { count: count.count, precision: 'EXACT' },
      productUpdatedAt: typeof data.product.updatedAt === 'string' ? data.product.updatedAt : null }
  }
  const fetchHydratedPage = withHydratedShopifyVariants(fetchProducts, {
    fetchVariantPage, ...options, requireVersionForContinuation: true,
  })
  const maxMediaPages = options.maxMediaPages ?? 20
  if (!Number.isSafeInteger(maxMediaPages) || maxMediaPages < 1 || maxMediaPages > 20) {
    throw new Error('invalid Shopify media pagination limit')
  }
  const hasUsablePreview = (node: unknown): boolean => {
    if (!record(node) || !record(node.preview) || !record(node.preview.image)) return false
    const url = node.preview.image.url
    if (typeof url !== 'string' || url.length > 2000) return false
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password
    } catch { return false }
  }
  // A structurally valid connection can still contain null or malformed media
  // nodes. Treat those as unknown coverage, not evidence of an imageless product.
  // Video/external-media previews may legitimately be null.
  const validateMediaNodes = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!record(node) || typeof node.id !== 'string' || !node.id.trim()) {
        throw new Error('Shopify media page contains invalid node identity')
      }
    }
  }
  const hydrateMedia = async (raw: unknown): Promise<unknown> => {
    if (!record(raw) || !('media' in raw)) return raw
    // Validate even terminal media pages: a malformed/missing nodes array
    // must not be mistaken for verified absence of a product image.
    // Older offline fixtures without a media field remain supported.
    const first = connectionOf(raw.media, 'media')
    validateMediaNodes(first.nodes)
    if (first.nodes.length > 5 || (first.pageInfo.hasNextPage && first.nodes.length === 0)) {
      throw new Error('Shopify initial media page size invalid')
    }
    if (!first.pageInfo.hasNextPage) return raw
    // An image in featuredMedia or the first media page is sufficient for
    // image availability. Otherwise inspect every remaining page before
    // claiming that a product has no usable image.
    if (hasUsablePreview(raw.featuredMedia) || first.nodes.some(hasUsablePreview)) return raw
    if (typeof raw.id !== 'string' || !/^gid:\/\/shopify\/Product\/[1-9]\d*$/.test(raw.id)) {
      throw new Error('Shopify media pagination requires Product gid')
    }
    const productId = raw.id
    const originalUpdatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
      ? raw.updatedAt : null
    // Without the initial version marker, continuation pages can silently mix
    // images from different product revisions. Admin GraphQL selects updatedAt;
    // a missing value must fail closed before requesting further media.
    if (originalUpdatedAt === null) {
      throw new Error('Shopify media pagination requires product updatedAt')
    }
    const cursors = new Set<string>()
    const nodes = [...first.nodes]
    let page = first
    let pages = 1
    while (page.pageInfo.hasNextPage) {
      if (pages >= maxMediaPages) throw new Error('Shopify media page limit exceeded')
      const cursor = page.pageInfo.endCursor
      if (!cursor || cursors.has(cursor)) throw new Error('Shopify media cursor did not advance')
      cursors.add(cursor)
      const data = dataOf(await execute(SHOPIFY_PRODUCT_MEDIA_QUERY, { productId, cursor }), 'media')
      if (!record(data.product) || data.product.id !== productId) {
        throw new Error('Shopify media page product id mismatch')
      }
      if (originalUpdatedAt !== null && data.product.updatedAt !== originalUpdatedAt) {
        throw new Error('Shopify product updated during media pagination')
      }
      page = connectionOf(data.product.media, 'media')
      validateMediaNodes(page.nodes)
      if (page.nodes.length === 0 || page.nodes.length > 20) {
        throw new Error('Shopify continuation media page size invalid')
      }
      nodes.push(...page.nodes)
      pages++
      // Image discovery is the only reason to continue media pagination.
      // A usable preview on this page is enough; do not exhaust a merchant's
      // remaining videos or fail at the page cap after finding an image.
      // Preserve hasNextPage truthfully: this is not a full media export.
      if (page.nodes.some(hasUsablePreview)) {
        return { ...raw, media: { nodes, pageInfo: page.pageInfo } }
      }
    }
    return { ...raw, media: { nodes, pageInfo: { hasNextPage: false, endCursor: page.pageInfo.endCursor } } }
  }

  // A cursor-only walk can report a terminal page while silently omitting
  // entire products. Verify every unfiltered traversal against Shopify's
  // independent EXACT total; never infer the total from returned pages.
  let traversal: { expected: number; ids: Set<string>; cursors: Set<string>; next: string | null } | null = null
  let fetching = false
  return {
    fetchShopCurrency,
    fetchPage: async (cursor: string | null): Promise<ShopifyProductsPage> => {
      if (fetching) throw new Error('concurrent Shopify product traversal is not supported')
      fetching = true
      try {
        if (cursor === null) {
          traversal = null
          const expected = await fetchExactProductCount()
          traversal = { expected, ids: new Set<string>(), cursors: new Set<string>(), next: null }
        } else if (!traversal || traversal.next !== cursor) {
          throw new Error('Shopify product continuation cursor is not the expected cursor')
        }
        const variantPage = await fetchHydratedPage(cursor)
        const products: unknown[] = []
        for (const product of variantPage.products) products.push(await hydrateMedia(product))
        const page = { ...variantPage, products }
        // Pagination flags alone cannot prove completeness if an upstream
        // adapter silently drops a variant page. Require Shopify's independently
        // reported exact count for every hydrated product.
        for (const product of page.products) {
          if (!record(product) || !record(product.variantsCount) ||
              product.variantsCount.precision !== 'EXACT' ||
              typeof product.variantsCount.count !== 'number' ||
              !Number.isSafeInteger(product.variantsCount.count) ||
              product.variantsCount.count < 0 ||
              !record(product.variants) || !Array.isArray(product.variants.nodes) ||
              product.variants.nodes.length !== product.variantsCount.count) {
            throw new Error('Shopify exact variantsCount missing, approximate or mismatched; refusing incomplete product page')
          }
        }
        if (!traversal) throw new Error('Shopify product traversal missing independent count')
        for (const product of page.products) {
          const id = (product as { id: string }).id
          if (traversal.ids.has(id)) throw new Error('duplicate Shopify product id across pages')
          traversal.ids.add(id)
          if (traversal.ids.size > traversal.expected) {
            throw new Error('Shopify product traversal exceeds independent exact count')
          }
        }
        if (page.pageInfo.hasNextPage) {
          const next = page.pageInfo.endCursor
          if (!next || traversal.cursors.has(next) || traversal.ids.size >= traversal.expected) {
            throw new Error('Shopify product pagination inconsistent with independent exact count')
          }
          traversal.cursors.add(next)
          traversal.next = next
        } else {
          if (traversal.ids.size !== traversal.expected) {
            throw new Error('Shopify product pagination incomplete: independent exact count mismatch')
          }
          // A merchant may add or delete products while a multi-page audit is
          // running. The opening count alone cannot detect that drift. Recheck
          // the independent unfiltered count before certifying a complete walk.
          // This is not a transactional snapshot: same-count replacements still
          // require a later sync/freshness check.
          const finalCount = await fetchExactProductCount()
          if (finalCount !== traversal.expected) {
            throw new Error('Shopify product count changed during traversal; restart catalog audit')
          }
          traversal = null
        }
        return page
      } catch (error) {
        traversal = null
        throw error
      } finally {
        fetching = false
      }
    },
  }
}
