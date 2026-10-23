# Radiantz pilot catalog tests (Issues #58, #105)

Status: **contract tests only. Nothing connects to Shopify, nothing is served, no orders or payments are involved.**

## What runs

`tests/radiantz-pilot.test.mjs` runs the real mapper, sync and readiness code over Shopify Admin GraphQL product pages.

| Suite | Data | Status |
|---|---|---|
| `synthetic fixture` | `tests/fixtures/radiantz-synthetic.mjs`. **Invented** names, ids, SKUs and prices modeled on reported traits (ACTIVE, global ids, USD decimals, zero on-hand under both `CONTINUE` and `DENY`) | Always runs |
| `real Radiantz export` | `tests/fixtures/radiantz/shop-products.json` | **Skipped until that file exists.** A skipped test is not a pass |

## What the tests assert (on either data set)

- Every published `ACTIVE` variant with a valid price is in the feed. **Quantity and inventory policy never exclude anything**, so made-to-order items with zero on hand and either `CONTINUE` or `DENY` stay.
- Product ids, variant ids and SKUs equal Shopify's. An empty SKU stays absent.
- Prices equal an independent decimal-string parse (not `parseFloat`).
- Shopify's inventory policy is kept unchanged on the server-side snapshot entry. The quantity is never copied, and the public feed carries no inventory data.
- Draft, archived, unpublished, publication-unknown and truncated-variant products are skipped with a visible reason.
- The feed passes the catalog contract, and readiness shows no data blockers. Only unverified endpoints block, until a trusted server-side probe exists.
- A shop currency other than the catalog currency is rejected.

## Adding the real export

Create `tests/fixtures/radiantz/shop-products.json` in a reviewed PR:

```json
{ "shop": { "currencyCode": "USD" }, "pages": [ { "products": [ /* nodes */ ], "pageInfo": { "hasNextPage": true, "endCursor": "..." } } ] }
```

- Use the reference query `SHOPIFY_PRODUCTS_QUERY` in `lib/shopify-catalog-sync.ts` against the **whole** catalog, one JSON page per request. The first look at the shop was a sample capped at 50 products, so it is not a complete export.
- Include only product data. No tokens, keys, customer data or admin URLs. A test fails if the file looks like it contains credentials.
- Keep the `publishedAt`, `status`, `inventoryPolicy` and `variants.pageInfo` fields exactly as Shopify returned them. Do not edit prices or ids.
- The **offline private-feed converter** `scripts/prepare-radiantz-pilot-feed.mjs` requires a separately queried, unfiltered root `productsCount(limit: null) { count precision }` result at export top level as `"productsCount": { "count": N, "precision": "EXACT" }`. Use the **same unfiltered product population** for the products pages and count. The converter compares this count against every exported product (including draft/archived) and fails closed on missing, approximate, or mismatched counts. This guards against a final product page falsely marked complete. Shopify Admin schema availability was checked on the connected **SeekPwr** shop, not yet on Radiantz; verify the Radiantz Admin schema and source before treating its export as complete.\n- The converter also requires an **independently queried** `variantsCount: { "count": N, "precision": "EXACT" }` on every published ACTIVE product. Compare that count to the fully hydrated `variants.nodes` array; do **not** manufacture the count from the exported nodes. If the connected Shopify Admin schema cannot supply an exact count, treat completeness as **unverified** and do not generate the feed. This prevents a 100-variant first page from being mislabeled as complete when Shopify has 150–225 variants.
- Keep the private full export **outside the public repository**. The optional local converter emits a sanitized file outside the repo; it does not publish a feed, verify its freshness, or authorize checkout. A future reviewed test fixture must be synthetic/redacted, not a full private Admin export.

## What this does not prove

It does not prove the live store syncs, that an AI agent can buy anything, or that any assistant will surface these products. Live OAuth, per-merchant storage, a served feed, the cart-to-order flow, and checkout behavior for `DENY` items remain gated on #56 and Codex's #91/#93, and on owner approval.
