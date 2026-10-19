// Fixtures shaped like Shopify Admin REST and GraphQL product responses.
// All values are fictional.

export const restMultiVariant = {
  id: 7234567890123,
  title: 'Trail Jacket',
  body_html: '<p>Warm &amp; light</p><ul><li>Packable</li></ul>',
  status: 'active',
  variants: [
    { id: 41000000000001, product_id: 7234567890123, title: 'Small / Blue', sku: 'TJ-S-BL', price: '129.00', image_id: 3 },
    { id: 41000000000002, product_id: 7234567890123, title: 'Medium / Blue', sku: 'TJ-M-BL', price: '129.50' },
    { id: 41000000000003, product_id: 7234567890123, title: 'Large / Blue', sku: '', price: '0.10' },
  ],
  images: [
    { id: 1, src: 'https://cdn.shopify.com/s/files/1/0001/jacket-front.jpg' },
    { id: 3, src: 'https://cdn.shopify.com/s/files/1/0001/jacket-blue-small.jpg' },
  ],
}

export const defaultTitleOnly = {
  id: '8000000000001',
  title: 'Sticker',
  variants: [{ id: '42000000000001', title: 'Default Title', sku: null, price: '19' }],
}

export const graphqlEdges = {
  id: 'gid://shopify/Product/9100000000001',
  title: 'Enamel Pin',
  description: 'Hard enamel, 1.5 inch.',
  status: 'ACTIVE',
  featuredImage: { url: 'https://cdn.shopify.com/s/files/1/0002/pin.png' },
  variants: {
    edges: [
      {
        node: {
          id: 'gid://shopify/ProductVariant/43000000000001',
          title: 'Gold',
          sku: 'PIN-GOLD',
          price: { amount: '1234.56', currencyCode: 'USD' },
        },
      },
      {
        node: {
          id: 'gid://shopify/ProductVariant/43000000000002',
          title: 'Silver',
          sku: 'PIN-SLV',
          price: { amount: '8.2', currencyCode: 'USD' },
          image: { url: 'https://cdn.shopify.com/s/files/1/0002/pin-silver.png' },
        },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
}

// Prices that break naive parseFloat(price) * 100 math.
export const floatTraps = {
  id: 9200000000001,
  title: 'Float Trap Pack',
  variants: [
    { id: 44000000000001, title: 'A', price: '19.99' },
    { id: 44000000000002, title: 'B', price: '1.15' },
    { id: 44000000000003, title: 'C', price: '0.29' },
    { id: 44000000000004, title: 'D', price: '4.35' },
  ],
}

export const archivedProduct = {
  id: 9300000000001,
  title: 'Old Thing',
  status: 'archived',
  variants: [{ id: 45000000000001, title: 'Default Title', price: '5.00' }],
}

export const noVariants = { id: 9400000000001, title: 'Empty', variants: [] }

export const badVariants = {
  id: 9500000000001,
  title: 'Mixed Quality',
  variants: [
    { id: 46000000000001, title: 'three decimals', price: '12.345' },
    { id: 46000000000002, title: 'no price' },
    { id: 46000000000003, title: 'numeric price', price: 19.99 },
    { id: 46000000000004, title: 'euro', price: { amount: '10.00', currencyCode: 'EUR' } },
    { title: 'no id', price: '3.00' },
    { id: 44000000000001, title: 'duplicate of float trap A', price: '1.00' },
    { id: 46000000000007, title: 'negative', price: '-1.00' },
    { id: 46000000000008, title: 'Valid', sku: 'OK-1', price: '5.00' },
  ],
}
