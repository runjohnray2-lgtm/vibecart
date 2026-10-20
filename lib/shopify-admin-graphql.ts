import { SHOPIFY_PRODUCTS_QUERY, SHOPIFY_SHOP_CURRENCY_QUERY, type ShopifyProductsPage } from '@/lib/shopify-catalog-sync'
import { normalizeCurrency } from '@/lib/shopify-catalog-mapper'
import { SHOPIFY_VARIANTS_QUERY, withHydratedShopifyVariants, type ShopifyVariantPage } from '@/lib/shopify-variant-pages'

/**
 * Read-only Shopify Admin GraphQL response adapter for the offline catalog sync.
 * The caller supplies an authenticated transport; this module never fetches,
 * stores credentials, mutates Shopify, or makes an HTTP request itself.
 * GraphQL can return HTTP 200 with errors AND partial data: fail closed.
 */
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
  const endCursor = typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null
  if (pageInfo.hasNextPage && (!endCursor || !endCursor.trim())) {
    throw new Error('Shopify ' + operation + ' continuation cursor missing')
  }
  return { nodes: value.nodes, pageInfo: { hasNextPage: pageInfo.hasNextPage, endCursor } }
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
  return {
    fetchShopCurrency,
    fetchPage: withHydratedShopifyVariants(fetchProducts, { fetchVariantPage, ...options }),
  }
}
