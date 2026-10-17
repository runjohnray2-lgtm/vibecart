# Shopify catalog integration (Issue #94): offline slice

Status: **library code and tests only. Not connected to Shopify, not wired into any route, no caller. Nothing here syncs anything yet.**

## What exists

| File | Purpose |
|---|---|
| `lib/shopify-catalog-mapper.ts` | Pure mapper from Shopify REST or GraphQL product JSON to catalog entries |
| `lib/shopify-catalog-sync.ts` | Offline sync: pagination, incremental upsert, delete webhooks, feed builder, variant index |
| `tests/shopify-*.test.mjs`, `tests/fixtures/shopify-*.mjs`, `tests/helpers/shopify-test-utils.mjs` | Fixture-based tests (run by `npm test`) |

## Data rules

- **One catalog entry per Shopify variant.** Catalog `id` = the Shopify variant id. Shopify global ids (`gid://shopify/ProductVariant/...`) are used when supplied (`admin_graphql_api_id`). Use the Admin GraphQL API for every page so ids stay consistent.
- **Prices** are decimal strings converted to integer cents with integer math. Floats, more than two decimals and negatives are rejected, never rounded.
- **Currency is never assumed.** The caller must pass the shop currency (`shop.currencyCode`). Embedded price currencies must match. The sync additionally requires it to equal the merchant catalog currency. Currencies without two minor-unit digits (for example JPY, KWD) are rejected.
- **Nothing invented.** No inventory counts, fitment, SKUs or default prices are created.
- **Publication is positively verified in the sync.** A product whose `publishedAt` is not returned at all is skipped (`publication status unknown`) and removed from the snapshot. An explicit `null` is skipped as `not published`. `includeUnpublished` is the only bypass. The mapper alone (used with REST data) treats only an explicit `null` as unpublished.
- **Inventory quantity never excludes anything.** Made-to-order products (such as the Radiantz pilot) legitimately report zero on hand, so a variant is never skipped because its quantity is zero or negative, whatever its policy. Shopify's actual inventory policy (`DENY` or `CONTINUE`) is carried through unchanged in `shopify.inventoryPolicy` on the server-side snapshot entry. The quantity is not copied anywhere. An unrecognized policy value is dropped with a warning, not guessed. What to do with a `DENY` policy at checkout is a later, owner-approved decision.
- **Skipped with a reason:** archived or draft products, unpublished products, publication unknown, products with a truncated variant list, missing ids, missing or invalid prices, duplicate variant ids. Every skip is returned to the caller so it can be shown to the merchant.
- **Fail safe on update:** if a product no longer maps to any variant, it is removed from the snapshot and feed.
- **Last known good:** a failed or guarded sync throws and leaves the base snapshot untouched. The caller keeps serving it and must track its age (the readiness report flags stale data).

## Keeping identifiers for order write-back

`lib/catalog-source.ts` keeps only `id, name, description, priceCents, image, variant` and drops everything else, including `sku` and the Shopify product id. So the feed alone cannot support order or fulfillment mapping. `buildVariantIndex(snapshot)` returns a server-side map from catalog id to `{ productId, variantId, sku? }`. Downstream order code must use that index, keyed by the catalog id on the order line. It must never be exposed publicly. Persisting it per tenant is future work.

## Reserved feature flag

`VIBECART_SHOPIFY_SYNC_ENABLED` is **reserved**. `isShopifySyncEnabled(env)` exists, but nothing calls it, so setting it today does nothing.

## Not done, and what gates it

| Item | Gate |
|---|---|
| Shopify OAuth install, token storage, least-privilege scopes | Needs real app credentials and merchant auth/tenant isolation (#56) |
| Calling Shopify (the reference queries in the sync module are untested against a live shop) | Credentials; pin and verify an API version first |
| Webhook routes (`products/update`, `products/delete`, `app/uninstalled`) and HMAC verification | #56, a public tenant-scoped endpoint, and the webhook secret |
| Per-tenant persistence of snapshot and index | #56 and a database design agreed with Codex |
| Serving the feed to `VIBECART_CATALOG_URL` | Tenant-scoped endpoint; do not publish a tenant-unscoped feed |
| Order write-back and avoiding duplicate orders (Shopify checkout vs VibeCart checkout) | Design doc first, coordinated with Codex (#91/#99). No payment or checkout changes here |
| Acting on `DENY` vs `CONTINUE` at checkout, multi-location inventory, bundles | Product decision and Codex's checkout work |

## Known limits

- `variants(first: 100)`: products with more variants are skipped with a visible reason, not truncated. Paging variants per product is not implemented.
- Images beyond the first 20 per product are ignored; they are only a fallback.
- A product mapped to zero variants is dropped even if the cause is transient bad data. That is deliberate (fail closed).
