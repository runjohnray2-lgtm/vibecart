# Radiantz Volusion pilot

This pilot is the first real-merchant evidence step for VibeCart. It must not change the live Radiantz storefront, product database, accounting flow, or checkout configuration.

## Source path

Use a read-only Volusion product export as the source. Volusion supports XML product exports through Generic\\Products and the All Products export. The adapter in `scripts/volusion-export-to-vibecart.mjs` converts a saved XML export into the existing trusted VibeCart JSON catalog contract.

Do not commit a live Volusion API URL, administrator email, encrypted password, bearer token, or customer/order data to this repository.

## Minimum export fields

Required:

- `ProductCode`
- `ProductName`
- `ProductPrice`

Recommended when available:

- `SalePrice`
- `ProductDescriptionShort` or `ProductDescription`
- an HTTPS product image URL

The adapter uses a positive `SalePrice` when present; otherwise it uses `ProductPrice`. It converts dollars to integer cents and fails closed on malformed or missing prices.

## Local conversion

```bash
node scripts/volusion-export-to-vibecart.mjs radiantz-products.xml radiantz-catalog.json
```

The output can then be served from a controlled HTTPS endpoint and configured as `VIBECART_CATALOG_URL` for a dedicated pilot deployment. Do not point production VibeCart at a local file or a private-network endpoint.

## Evidence checklist

Record these facts before making any case-study claim:

1. Exact setup time and manual steps.
2. Product count converted and any rows rejected.
3. At least one external MCP/agent catalog session using real Radiantz SKUs and prices.
4. Controlled cart create/read/update/cancel behavior.
5. Controlled checkout and resulting order correlation, without placing an unintended live customer order.
6. Success/failure counts for agent operations; never store prompts, payment details, raw client IPs, or Volusion credentials as pilot telemetry.
7. Any storefront/accounting impact. The required result is none.

## Pilot safety gate

A saved real product-export sample is required before claiming compatibility with Radiantz's exact Volusion data shape. Until that sample is validated, this branch is pilot tooling only and must not replace the live merchant catalog.
