# Merchant catalog integration

VibeCart Core treats `lib/products.ts` as fictional reference/demo data only. Real merchants should keep product ownership in their existing system and expose a small HTTPS JSON feed for VibeCart.

## Environment

```bash
VIBECART_CATALOG_URL=https://merchant.example/vibecart/catalog.json
VIBECART_MERCHANT_NAME="Example Merchant"
# Optional for private feeds
VIBECART_CATALOG_BEARER_TOKEN=server-side-secret
```

Do not expose the bearer token in client code, MCP configuration, prompts, or public fixtures.

## Response

Either a root array or `{ "products": [...] }` is accepted.

```json
{
  "products": [
    {
      "id": "sku-123",
      "name": "Example product",
      "description": "Merchant-controlled product data",
      "priceCents": 4900,
      "image": "https://merchant.example/products/sku-123.jpg",
      "variant": "Optional variant"
    }
  ]
}
```

Required fields:

- `id`: non-empty stable identifier, max 200 characters
- `name`: non-empty display name, max 500 characters
- `priceCents`: non-negative safe integer in USD cents

Optional fields:

- `description`: string, truncated to 5,000 characters
- `image`: absolute HTTPS URL
- `variant`: non-empty string, max 500 characters

Product IDs must be unique within one feed.

## Runtime behavior

The same trusted catalog provider is used by:

- generic MCP product listing and lookup
- generic MCP checkout validation
- UCP catalog search/lookup
- durable cart create/update repricing
- direct Stripe Checkout creation

A healthy remote feed is cached for 30 seconds. Normal SKU and price changes therefore propagate without editing VibeCart source or redeploying the application.

The remote fetch is fail-closed:

- HTTPS only
- no URL credentials
- no redirects
- no localhost/private-network targets
- DNS results are rejected if any resolved address is private
- 4 second timeout
- 5 MiB maximum response
- 10,000 maximum products
- response schema validation before prices become trusted

If `VIBECART_CATALOG_URL` is configured and the feed is unavailable or invalid, VibeCart returns a catalog/service-unavailable error. It does not fall back to the fictional demo catalog.

## First merchant pilot

The first production pilot should map an existing real merchant catalog into this contract without changing that merchant's storefront, payment settlement, shipping, or accounting system. Measure setup time, manual steps, catalog freshness, agent lookup success, cart/checkout success, and failure handling before broadening the connector surface.
