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

- A subsequent full 44-product/970-variant read-only connector traversal is recorded below. It does not execute the repository's standalone operator audit or certify a final VibeCart feed. Fitment, image quality, sales-channel publication and fresh checkout sellability remain unverified.
- No external agent read, MCP/UCP product fetch, cart, Stripe TEST transaction, Neon order, staging deployment, database write, or merchant mutation occurred.
- #108's distinct zero-incremental-cost staging database, Preview-only Stripe TEST credentials, and tenant isolation/security proof remain unverified. Do not run write-capable staging tests until all gates pass.
- Keep #119 draft and stacked on #104 -> #103; #106 closed unmerged and #107 is based on #104. Work-owned #121 must selectively reconcile the Shopify-owned changes and rerun integrated CI. No automatic merges or deployments.

**Evidence limitations:** Shopify read-only connector execution and aggregate observations only. No secret-bearing output or raw Admin data has been committed.

## Full 44-product, 970-variant read-only traversal — 2026-10-26 21:23 PDT

**New evidence, same connected Radiantz shop (USD):** Executed the repository's schema-correct `VibeCartProducts`, `VibeCartProductVariants` and unfiltered `VibeCartProductsCount` operations through the connected Shopify Admin **read-only** query tool. Schema was inspected before constructing operations. The Shopify validation helper returned **"validation skipped"**; the actual queries executed successfully, but this does not prove compatibility with the standalone script's pinned Admin API version.

- **44 products**, independently EXACT before and after the traversal; **9 product pages** (5 per page) with unique product IDs and terminal cursor. **39 ACTIVE / 921 variants**, **5 DRAFT / 49 variants**; **970 total variants** hydrated with **970 unique variant IDs**. All 44 product-family counts were EXACT and matched hydrated rows.
- Four families above 100 variants (**150, 225, 189, 174**) required **5 continuation variant requests** beyond the first 100 per family. On each continuation, independent EXACT variant counts and `updatedAt` remained unchanged; no duplicate variant IDs or missing rows. **16 read-only requests** for the count/product/variant traversal (2 counts + 9 product pages + 5 variant continuations).
- Across all 970 observed variants: **769 DENY** and **201 CONTINUE** inventory policies, **0 invalid policies**, **0 invalid decimal prices**, **0 null/empty/nonstring/oversized SKUs** (whitespace-only values were not separately checked), **0 duplicate IDs**, and **0 invalid display fields** under the offline mapper's basic length/type checks. These are data-quality observations, **not live checkout price or availability verification**.
- **756 DENY variants** and **127 CONTINUE variants** reported zero on-hand inventory. A DENY/zero variant must **never** be treated as checkout-authorized; CONTINUE/zero may be made to order but requires Codex's fresh sellability checks. Counts include both ACTIVE and DRAFT products and must not be used as a public sellable-variant count.
- A separate independent **one-page, 44-product read-only image-coverage query** found **36 of 39 ACTIVE families with an image**, **3 ACTIVE families missing images**, and **0 nonterminal media connections**. Four DRAFT families also lacked images. No image content, private identifiers or raw catalog rows were retained in this evidence.
- All ACTIVE products had non-null `publishedAt`; this does not independently verify every publication/sales channel. Exact prices, SKU identities and product IDs were checked transiently for integrity but intentionally **not written to public GitHub**.

**Acceptance boundary:** This is stronger **live Shopify read-only catalog data-quality/pagination evidence**, not a deployed Shopify→VibeCart feed, verified fitment, MCP/UCP agent fetch, server-priced cart, isolated Neon order, Stripe TEST payment, replay test, or second-merchant onboarding. No Shopify mutations, database writes, checkout, payments, deployments or spending. Issue #108's staging isolation/credentials/cost gates still block write-capable acceptance.

## Fresh live Radiantz read-only recheck — 2026-10-27 08:23 PDT

**Connected shop verified:** Radiantz LED Lighting, radiantz.com, USD. Inspected the connected Admin GraphQL schema before constructing read-only operations; Shopify's codeblock validator reported **"validation skipped"**, so validation evidence here is **successful actual read-only execution**, not a passed static validator. No customer/order records, secrets, raw product IDs, SKUs, prices or catalog export are committed.

- Unfiltered `productsCount(limit: null)` returned **44, precision EXACT**. A terminal `products(first: 50)` page returned **44 unique products**: **39 ACTIVE / 921 reported variants**, **5 DRAFT**, **970 reported variants across all statuses**. All 44 product-family counts returned EXACT precision. **39** products had a non-null `publishedAt` (not proof of publication on every sales channel).
- Requeried the four **>100-variant** families with `product(id: ...).variants(first: 100, after: ...)` until terminal cursors: **225 in 3 pages; 189 in 2; 174 in 2; 150 in 2**. All **738/738** expected variant IDs were observed uniquely. Counts stayed EXACT and unchanged; `updatedAt` stayed unchanged within each family; all observed prices were two-decimal strings; **0** malformed/blank SKUs, duplicate variant IDs, unknown inventory policies, or malformed inventory quantities in these four families. This was not a transactionally consistent snapshot, and the remaining 232 variants were **not rehydrated on this date**.
- **Newly observed inventory evidence in the four large families:** the 225- and 189-variant families each had **all variants DENY with zero on hand**; the 150-variant family had **149 DENY/zero and 1 DENY/negative**; the 174-variant family had **124 CONTINUE/zero**, with 50 reporting positive stock. Aggregate for these four: **563 DENY/zero, 1 DENY/negative, 124 CONTINUE/zero**. This confirms why the operator audit's newly added negative-stock diagnostic is useful on real merchant data. **DENY with zero or negative stock is not checkout authorization. CONTINUE with zero may be made to order, but sellability remains unverified.**

**Scope limit:** Live connected-Admin schema and aggregate pagination/data checks only. This did not execute the repository's full standalone operator audit, reverify image/fitment completeness, verify a published MCP/UCP catalog, prove a server-priced cart, or test Stripe/Neon staging. No Shopify writes, database writes, payments, deployment, merge or spending occurred. Issue #108's isolation, TEST-only credentials and zero-cost gates remain closed. The prior 2026-10-26 full 970-variant traversal remains separate historical evidence; today's 44-product count and four-family recheck do not imply every variant was rechecked today.
