# Radiantz Shopify read-only catalog evidence — 2026-10-26

**Scope:** One independent, non-mutating merchant pilot validation for Issues #58, #94, #105 and #108. Source was the connected **Radiantz LED Lighting** Shopify Admin account (radiantz.com; USD), not a fixture or a different merchant. Only read-only GraphQL schema introspection and queries were performed. No credentials, customer records, raw SKUs, product IDs, prices or catalog exports are recorded here.

## Fresh observed counts

- Unfiltered `productsCount(limit: null)`: **44, precision EXACT**.
- One `products(first: 50, sortKey: ID)` page returned all 44, `hasNextPage: false`; all 44 `variantsCount` precisions were EXACT.
- **39 ACTIVE products / 921 reported variants**; all 39 had `publishedAt` populated.
- **5 DRAFT products / 49 reported variants**; all 5 had `publishedAt: null`.
- **970 reported variants total** across both statuses. These are live observations, not immutable expectations or proof of a fully hydrated/merchant-ready catalog.
- A follow-up read-only `VibeCartImageCoverage` GraphQL operation checked `featuredMedia.preview.image.url` and up to 10 `media` nodes for **all 44 products**. All 44 were returned on one terminal product page, and **none of the 44 media connections reported `hasNextPage: true`**. Exactly **3 of 39 ACTIVE product families have no featured preview image and zero media nodes**. This establishes three actual missing-image product families in the connected shop at inspection time, rather than a first-five-media sampling ambiguity. It does **not** establish image quality, publication in every sales channel, or variant-specific image coverage.

## Actual Admin GraphQL compatibility and >100-variant traversal

Inspected the connected shop's current Admin schema for `QueryRoot`, `Product`, `ProductVariant`, `Media`, `MediaPreviewImage`, `ProductVariantConnection`, and `Count`. The fields used by the existing read-only product/variant operations were present, including `featuredMedia.preview.image.url`, `media.preview.image.url`, `variantsCount { count precision }`, `updatedAt`, `inventoryPolicy`, and `inventoryQuantity`. The connector's codeblock validation returned **"validation skipped"**; do not count that as a passed static validation. Instead, the actual `VibeCartProducts` GraphQL operation was executed read-only against Radiantz: the first five products returned valid product and variant connections, EXACT variant counts, string prices, policies, and update timestamps. The connector did not expose its exact Admin API version, so this is **not proof of compatibility with the standalone audit's pinned 2026-10 endpoint**.

Executed the existing `VibeCartProductVariants` operation against all four live product families above 100 variants, following every variant cursor to termination:

| Reported variants | Pages fetched | Unique variant IDs seen | Policy in observed rows | Result |
| ---: | ---: | ---: | --- | --- |
| 150 | 2 | 150 | 150 DENY | PASS |
| 225 | 3 | 225 | 225 DENY | PASS |
| 189 | 2 | 189 | 189 DENY | PASS |
| 174 | 2 | 174 | 174 CONTINUE | PASS |
| **738** | **9** | **738** | **564 DENY / 174 CONTINUE** | **PASS** |

For each family, the count stayed EXACT and unchanged on every page, `updatedAt` stayed unchanged across its page walk, no duplicate variant IDs were observed, and all observed prices were strings. These checks establish **successful live read-only pagination for those four families**, not a transactional snapshot, not full-catalog mapping, and not checkout eligibility. In particular, `DENY` does not authorize a zero-stock sale; `CONTINUE` does not by itself prove fresh checkout sellability.

## Current independent CI evidence

On worker draft PR #119 at `b42dff503360ce4fe9529ef772d485dc7d8e0045`, [GitHub Actions run 40287293722](https://github.com/runjohnray2-lgtm/vibecart/actions/runs/40287293722) completed with **build, typecheck, lint PASS** and **273 native Node tests: 268 PASS / 5 FAIL / 0 SKIP**. Failures #49/#50/#54/#90/#102 are the established main baseline assertions addressed separately in unmerged PR #120. Downstream smoke/MCP/UCP validation steps were skipped because unit tests failed. **Full CI is not green.**

## Remaining gates and coordination

- No full 44-product hydrated Admin audit or independently verified final VibeCart feed was run. Exact IDs, SKU mapping, prices, fitment and fresh checkout sellability still require end-to-end verification. Image presence was checked across all reported product media pages, but image quality and per-variant mapping remain unverified.
- No external agent read, MCP/UCP product fetch, cart, Stripe TEST transaction, Neon order, staging deployment, database write, or merchant mutation occurred.
- #108's distinct zero-incremental-cost staging database, Preview-only Stripe TEST credentials, and tenant isolation/security proof remain unverified. Do not run write-capable staging tests until all gates pass.
- Keep #119 draft and stacked on #104 -> #103; #106 closed unmerged and #107 is based on #104. Work-owned #121 must selectively reconcile the Shopify-owned changes and rerun integrated CI. No automatic merges or deployments.

**Evidence limitations:** Shopify read-only connector execution and aggregate observations only. No secret-bearing output or raw Admin data has been committed.
