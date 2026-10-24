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

export type ShopifyGraphqlTransport = (document: string, variables: Record<string, unknown>) => Promise<unknown>
export type ShopifyAdminSourceOptions = {
  maxVariantPages?: number
  maxVariantsPerProduct?: number
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
    return { productId, variants: connectionOf(data.product.variants, 'variants') }
  }
  const fetchHydratedPage = withHydratedShopifyVariants(fetchProducts, { fetchVariantPage, ...options })
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
        const page = await fetchHydratedPage(cursor)
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
