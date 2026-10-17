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

## What this does not prove

It does not prove the live store syncs, that an AI agent can buy anything, or that any assistant will surface these products. Live OAuth, per-merchant storage, a served feed, the cart-to-order flow, and checkout behavior for `DENY` items remain gated on #56 and Codex's #91/#93, and on owner approval.
