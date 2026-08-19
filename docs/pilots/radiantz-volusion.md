# Radiantz Volusion pilot

This pilot is the first real-merchant evidence step for VibeCart. It must not change the live Radiantz storefront, product database, accounting flow, or checkout configuration.

## Source path

Use the existing read-only first-generation Volusion `Generic\\Products` endpoint as the preferred pilot source. The endpoint credential must stay outside GitHub and logs. The adapter in `scripts/volusion-export-to-vibecart.mjs` can now either convert a saved XML export or fetch the live XML through the `VOLUSION_PRODUCTS_URL` environment variable.

Do not commit a live Volusion API URL, administrator email, encrypted password, bearer token, or customer/order data to this repository.

The live source must use HTTPS. The adapter refuses redirects, times out after 15 seconds, caps the response at 10 MB, and fails closed on HTTP errors.

## Minimum product fields

Required:

- `ProductCode`
- `ProductName`
- `ProductPrice`

Recommended when available:

- `SalePrice`
- `ProductDescriptionShort` or `ProductDescription`
- an HTTPS product image URL

The adapter uses a positive `SalePrice` when present; otherwise it uses `ProductPrice`. It converts dollars to integer cents and fails closed on malformed or missing prices.

## Saved-export conversion

```bash
node scripts/volusion-export-to-vibecart.mjs radiantz-products.xml radiantz-catalog.json
```

## Live read-only conversion

Store the complete authenticated `Generic\\Products` URL in a secret environment variable, using the HTTPS Radiantz endpoint. Do not put the value in shell history, source files, tickets, or logs.

```bash
VOLUSION_PRODUCTS_URL='https://…' \
  node scripts/volusion-export-to-vibecart.mjs --live radiantz-catalog.json
```

The generated JSON can then be served from a controlled HTTPS endpoint and configured as `VIBECART_CATALOG_URL` for the dedicated pilot deployment.

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

A real Radiantz product payload from the authenticated read-only endpoint must be successfully converted before claiming compatibility with Radiantz's exact Volusion data shape. The endpoint itself is now known; the remaining gate is runtime access to that secret-backed source and validation of the returned XML. Until that passes, do not replace the live merchant catalog or move to pricing/business-model validation.
