// Shopify Admin GraphQL shaped pages. All values are fictional.

export function gqlProduct(num, title, variants, extra = {}) {
  return {
    id: 'gid://shopify/Product/' + num,
    title,
    description: title + ' description',
    status: 'ACTIVE',
    publishedAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
    featuredImage: { url: 'https://cdn.shopify.com/s/files/1/0003/p' + num + '.jpg' },
    variantsCount: { count: variants.length, precision: 'EXACT' },
    variants: {
      pageInfo: { hasNextPage: false },
      nodes: variants.map(([variantNum, variantTitle, sku, price]) => ({
        id: 'gid://shopify/ProductVariant/' + variantNum,
        title: variantTitle,
        sku,
        price,
        inventoryPolicy: 'CONTINUE',
        inventoryQuantity: 5,
      })),
    },
    ...extra,
  }
}

export const page1 = {
  products: [
    gqlProduct(1, 'Alpha', [[11, 'Small', 'A-S', '10.00'], [12, 'Large', 'A-L', '20.50']]),
    gqlProduct(2, 'Beta', [[21, 'Default Title', 'B-1', '5.00']]),
  ],
  pageInfo: { hasNextPage: true, endCursor: 'c1' },
}

export const page2 = {
  products: [
    gqlProduct(3, 'Gamma', [[31, 'One', 'G-1', '7.25']]),
    gqlProduct(4, 'Delta', [[41, 'One', 'D-1', '9.00']], { publishedAt: null }),
  ],
  pageInfo: { hasNextPage: false, endCursor: null },
}
