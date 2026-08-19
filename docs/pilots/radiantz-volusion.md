# Radiantz Volusion pilot

This pilot is the first real-merchant evidence step for VibeCart. It must not change the live Radiantz storefront, product database, accounting flow, or checkout configuration.

## Source path

Use the existing read-only first-generation Volusion `Generic\\Products` endpoint as the preferred pilot source. The endpoint credential must stay outside GitHub and logs. The adapter in `scripts/volusion-export-to-vibecart.mjs` can either convert a saved XML export or fetch live XML through the `VOLUSION_PRODUCTS_URL` environment variable.

Do not commit a live Volusion API URL, administrator email, encrypted password, bearer token, or customer/order data to this repository.

The live source must use HTTPS. The adapter refuses redirects, times out after 15 seconds, caps the response at 10 MB, and fails closed on HTTP errors.

## Real Radiantz payload finding

A real Radiantz `Generic\\Products` payload was inspected on August 19, 2026. It uses repeated `<Products>` records, contains exactly 100 source rows, and includes `HideProduct`, `ProductCode`, `ProductID`, `ProductName`, `ProductPrice`, and occasional `StockStatus` fields. Of those 100 rows, 63 are marked `HideProduct=Y` and must never be exposed as purchasable catalog items. The remaining 37 rows are suitable as a controlled first-page pilot subset after price validation.

Volusion Generic exports are capped at 100 records per generated export. Therefore an exactly-100-row response must not be treated as proof of a complete merchant catalog. Before production catalog replacement, obtain/aggregate every required product page or move to a source that can prove full-catalog completeness. During the pilot, clearly treat the validated visible rows as a subset rather than claiming they represent every Radiantz product.

## Minimum product fields

Required:

- `ProductCode`
- `ProductName`
- `ProductPrice`

Recommended when available:

- `HideProduct`
- `SalePrice`
- `ProductDescriptionShort` or `ProductDescription`
- an HTTPS product image URL

The adapter excludes `HideProduct=Y`, uses a positive `SalePrice` when present, otherwise uses `ProductPrice`, converts dollars to integer cents, and fails closed on malformed or missing prices.

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

The live CLI deliberately refuses an exactly-100-row response as a complete catalog until pagination/completeness has been resolved. A saved 100-row export can still be converted for controlled subset validation.

The generated JSON can then be served from a controlled HTTPS endpoint and configured as `VIBECART_CATALOG_URL` for a dedicated pilot deployment.

## Evidence checklist

Record these facts before making any case-study claim:

1. Exact setup time and manual steps.
2. Product count converted and any hidden/rejected rows.
3. At least one external MCP/agent catalog session using real Radiantz SKUs and prices.
4. Controlled cart create/read/update/cancel behavior.
5. Controlled checkout and resulting order correlation, without placing an unintended live customer order.
6. Success/failure counts for agent operations; never store prompts, payment details, raw client IPs, or Volusion credentials as pilot telemetry.
7. Any storefront/accounting impact. The required result is none.

## Pilot safety gate

The real Radiantz data shape is now validated enough to continue with a controlled visible-product subset. The remaining production-catalog gate is completeness across Volusion's 100-record export boundary. Do not replace the entire live merchant catalog or claim full-catalog coverage until every required page is aggregated and verified. Pricing/business-model validation still waits on measured external-agent pilot evidence.
