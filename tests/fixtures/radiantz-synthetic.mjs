// SYNTHETIC FIXTURE. This is NOT Radiantz data. Names, ids, SKUs and prices are invented.
// It mimics traits reported for the Radiantz pilot: ACTIVE products, GraphQL global ids,
// decimal USD prices, and zero on-hand for made-to-order items under both CONTINUE and DENY.
// Real data belongs in tests/fixtures/radiantz/shop-products.json (see docs/radiantz-pilot.md).

function variant(num, title, sku, price, policy, quantity) {
  return { id: 'gid://shopify/ProductVariant/' + num, title, sku, price, inventoryPolicy: policy, inventoryQuantity: quantity }
}

function product(num, title, variants, extra = {}) {
  return {
    id: 'gid://shopify/Product/' + num,
    title,
    description: title + ' (synthetic description)',
    status: 'ACTIVE',
    publishedAt: '2026-10-01T00:00:00Z',
    featuredImage: { url: 'https://cdn.example.com/synthetic/' + num + '.jpg' },
    variants: { pageInfo: { hasNextPage: false }, nodes: variants },
    ...extra,
  }
}

export const syntheticShop = { currencyCode: 'USD' }

export const syntheticPages = [
  {
    products: [
      product(9000000000001, 'SYNTHETIC Flex strip', [
        variant(9100000000001, 'Warm White / 12 in', 'SYN-FX-WW-12', '24.95', 'CONTINUE', 0),
        variant(9100000000002, 'Cool White / 12 in', 'SYN-FX-CW-12', '24.95', 'CONTINUE', 0),
        variant(9100000000003, 'Red / 24 in', 'SYN-FX-R-24', '39.50', 'DENY', 0),
      ]),
      product(9000000000002, 'SYNTHETIC Plate frame', [
        variant(9100000000004, 'Default Title', 'SYN-PF-1', '89', 'CONTINUE', 0),
      ]),
    ],
    pageInfo: { hasNextPage: true, endCursor: 'syn-1' },
  },
  {
    products: [
      product(9000000000003, 'SYNTHETIC Harness', [
        variant(9100000000005, 'Default Title', '', '12.10', 'DENY', 0),
      ]),
      product(9000000000004, 'SYNTHETIC Draft item', [
        variant(9100000000006, 'Default Title', 'SYN-DR-1', '5.00', 'CONTINUE', 0),
      ], { publishedAt: null }),
      product(9000000000005, 'SYNTHETIC Retired item', [
        variant(9100000000007, 'Default Title', 'SYN-RT-1', '7.00', 'CONTINUE', 0),
      ], { status: 'ARCHIVED' }),
      product(9000000000006, 'SYNTHETIC Huge variant set', [], {
        variants: {
          pageInfo: { hasNextPage: true },
          nodes: [variant(9100000000008, 'Size 1', 'SYN-HV-1', '3.00', 'CONTINUE', 0)],
        },
      }),
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
]
