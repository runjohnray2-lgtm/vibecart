# VibeCart Build Progress

Last updated: 2026-10-17

This file is the durable checkpoint for the autonomous build-to-revenue mission. Read it before each work session, verify repository/runtime state, and update it with facts rather than plans.

## Mission order

1. #99 Payment durability
2. #93 AI salesperson
3. #94 Shopify integration
4. #97 Merchant subscriptions
5. #92 Merchant dashboard
6. #95 Consented checkout recovery
7. #96 ShipStation fulfillment
8. #98 MCP/UCP multi-merchant distribution

Do not reorder unless a dependency requires it.

## #99 Payment durability

Status: **IMPLEMENTED AND VERIFIED ON PR #91; NOT MERGED / NOT DEPLOYED**

PR: #91 `fix/webhook-require-durable-order-persistence`

Verified implementation:
- Stripe signature verification remains before all order work.
- Payment-ready Stripe events persist directly to VibeCart Core's existing Neon order store.
- Core does not require a VibeCart Cloud subscription or Cloud availability.
- Order header, line items, payment event, merchant-scoped cart conversion, and optional Cloud outbox are committed through one Neon transaction.
- Checkout Session identity and Stripe event identity preserve idempotency.
- Hosted merchant identity mismatch fails closed.
- Cart conversion is scoped by cart ID + merchant ID.
- Optional Cloud delivery happens only after the Core transaction commits.
- Cloud outage after Core persistence does not ask Stripe to replay an already-durable order.
- Migration 007 adds replayable Cloud outbox state with lease, attempt count, backoff, delivery state, and dead-letter state.
- Cloud retry endpoint is disabled by default and requires `CRON_SECRET` when enabled.
- Quickstart includes a merchant-facing payment-durability flow.

Latest fully verified code before the final Quickstart/checkpoint-only commit: `efb69d3cd5859c9f8ad053479c842c9ff031f004`.

GitHub Actions run #538:
- Build: PASS
- Typecheck: PASS
- Lint: PASS
- Unit tests: PASS (all)
- Production server start: PASS
- MCP commerce smoke: PASS
- UCP discovery/profile generation: PASS
- Official UCP validator 1.4.1: PASS
- MCP production transport / official Inspector: PASS
- Disposable PostgreSQL payment-durability job: PASS
  - migrations 001, 004, 005, 007 applied
  - duplicate Checkout Session -> exactly one durable order
  - payment-event idempotency checked
  - Cloud outbox uniqueness checked
  - merchant-scoped cart conversion checked
  - outbox lease/index schema checked

UCP Cart Conformance run #122: PASS.

Vercel preview status for `efb69d3...`: PASS.

No production database migration, production environment change, real payment, or production deployment was performed.

### Production gate

Do **not** merge PR #91 yet. Merging main is expected to trigger a production deployment and this mission requires explicit owner approval for risky production payment changes.

A future controlled production rollout must separately confirm migration availability and use Stripe test-mode / controlled pilot evidence before live commerce is accepted.

## Current independent work

Next milestone: **#93 AI salesperson**.

Work on #93 should be stacked on the verified #99 branch until #91 receives owner approval and lands in main. Preserve:
- trusted server-side catalog truth,
- no invented compatibility/availability/pricing,
- tenant isolation,
- cart/checkout idempotency,
- auditable AI attribution.

## Next executable task

1. Let the final #99 Quickstart/checkpoint commit pass CI.
2. Create a stacked #93 branch from PR #91 head.
3. Inventory existing MCP/UCP catalog/cart/checkout primitives and implement verified conversational discovery + compatibility-question behavior without adding an ungrounded LLM decision path.
4. Add AI-sales attribution metadata into carts/orders.
5. Keep PR #91 unmerged until explicit production-deployment approval.


## 2026-10-18 payment retry review — PR #109

- Found and fixed stale-worker writes after a Cloud outbox lease is reclaimed. Claims now carry random ownership tokens; completion and failure updates require ownership.
- Added migration 008, CI migration wiring, behavioral overlap regressions for stale success/failure, and PostgreSQL ownership assertions.
- Local verification: build PASS; typecheck PASS; lint PASS with one pre-existing img warning; all 155 unit tests PASS; MCP production-server smoke PASS; live UCP catalog/discovery capture and order mapper generation PASS.
- Migrations 001/004/005/007/008 and payment durability SQL assertions PASS in local PGlite PostgreSQL. This is not Neon runtime evidence.
- Official UCP validator and service PostgreSQL checks: GitHub CI pending when checkpoint written.
- PR #109 is stacked on #91. Neither PR merged or production deployed. No production credentials, live payment activation, or paid services changed.
- Remaining gates: non-production Neon + signed Stripe test checkout/replay/outage evidence; #56 managed merchant user sessions, credential provisioning and shared-runtime isolation; #58 authorized real merchant catalog and pilot. Then Shopify #94, merchant billing #97, and grounded AI sales #93 as dependencies permit.

## 2026-10-18 issue #108 staging safety follow-up

- Owner approved dedicated Vercel Preview and isolated staging Neon, test-mode Stripe only after isolation/merchant/cost checks; no production or extra spending.
- Read-only Vercel metadata reverified: DATABASE_URL still targets production + preview; Stripe secrets production-only. No secrets read and no environment values changed.
- PR #106 is closed and unmerged; #107 remains based on agent/ai-readiness. No blind merge or stack modification.
- Added Preview runtime gate before rate limiting/routes: isolation attestation, approved database hostname/fallback checks, test credential and merchant auth requirements, Cloud disablement, non-pilot API denial, noindex/no-store, and live webhook rejection.
- Local build/typecheck/lint PASS (existing img warning); 169 unit tests PASS, including 14 staging regressions. Infrastructure isolation is NOT established by these tests.
- #109 CI fully PASS, including service PostgreSQL and official UCP validation.
- Blockers: dedicated empty/schema-only staging database and zero incremental cost not verified; shared Preview DATABASE_URL unresolved; staging Stripe test credentials absent. No migration, database write, checkout, deployment or paid resource created in this follow-up.
- Next: establish and verify secure branch-specific staging env with zero extra cost, then execute authorized Radiantz test-only checkout/replay/outage/cross-tenant acceptance under #108. Keep production unchanged.

## 2026-10-18 #56/#99 hosted checkout tenant binding

- Read full #105/#108 and latest comments; coordinated file claims with VibeCart Hourly Build and posted claim to #105. Shopify/pagination/readiness stack untouched.
- Confirmed #91/#109/#110 green; #100 fails build (missing required availability on inline checkout product), separately from Shopify baseline failures. #106 closed/unmerged, #107 remains stacked on its head branch.
- Fixed generic cart sessions stamped default instead of configured merchant. All sessions/PaymentIntents now carry merchant identity; hosted webhook rejects absent/conflicting identity before Stripe reads.
- Generic cart checkout validates tenant, active state and exact items/quantities, including duplicate-line substitution. Handler auth protects internal calls; MCP/cart adapters preserve caller auth.
- Added actual-code offline PostgreSQL + Stripe-signature integration acceptance for auth/cart/checkout/payment transaction, replay and rollback/recovery. Removed raw Stripe signature error payload logging. Added configuration-only staging health signals.
- Local build, typecheck, lint (one existing img warning) and 178 tests PASS. Tests are synthetic/offline and do not prove live Neon/Stripe/Radiantz acceptance. CI pending at checkpoint.
- No production or merchant data changes, real checkout, environment mutation, database provisioning, paid services or metered AI calls.
- Next: fix #100 compile/test integration and verify grounded external-agent flow; staging runtime tests remain blocked by unverified isolated DB, zero-incremental-cost allowance and Preview-only test Stripe credentials.

## 2026-10-18 combined merchant AI checkout acceptance

- #111 tenant/payment fix CI run 39171519703 PASS; #112 repairs existing #100 compile and full test execution on a separate stack.
- Integrated existing #100/#112 sales code with #111 on an isolated review branch; no upstream branch rewritten or production merge performed.
- Actual-code offline MCP protocol requests now discover trusted synthetic products, create/replay a server-priced attributed cart, hand off with cart capability, verify a real Stripe signature, persist one PostgreSQL order and retain source/session/channel attribution through replay.
- Checkout revalidates known out-of-stock state and sales compatibility against current catalog data; post-cart stock/fitment changes are rejected before Stripe session creation.
- Combined local build/typecheck/lint and all 199 tests PASS, no failures/skips. CI pending. PGlite and fake Stripe/Neon network adapters are offline integration, not actual Radiantz/Stripe/Neon acceptance.
- Fresh read-only metadata still shows shared production+preview DATABASE_URL and production-only Stripe secrets; Neon lists no dedicated commerce staging branch. No zero-incremental-cost allowance proof is available through the connected metadata surface. No infrastructure changed or unsafe staging write attempted.
- Next owner/operator-dependent assignment: establish cost-verified isolated schema-only Neon staging and secure branch-specific Preview DB/test Stripe configuration under #108. Next engineering assignment: run the existing offline acceptance in CI, then port the same assertions to protected staging only after all #108 gates are independently verified. Hourly worker retains real Shopify source/sellability/pagination work.

Follow-up in the combined branch: reproduced three fitment/discovery regressions before fixing them (all three failed first): unverified extra shopper attributes, conflicting case-variant keys hiding a mismatch, and out-of-stock products appearing in recommendations. Added strict unknown-attribute handling, duplicate-key rejection, and out-of-stock candidate-only visibility. All 202 tests pass with zero skips; no third-party patch claimed as committed by the worker. #112 CI run 39171646612 PASS. #113 remains a draft integration candidate, not deployed or approved for production.

## 2026-10-18 real Radiantz subset and pilot preflight

- Read full #105/#108 and current #91/#109–#113; existing stack remains unmerged. #113 CI run 39172052953 passed, including PostgreSQL, UCP and MCP checks.
- Authenticated Neon billing inspection established Launch usage-based compute, not a free compute allowance. Included branches do not establish zero incremental cost. No database resources created or activated; Business Brain test database untouched. Dedicated staging remains blocked by the no-extra-spending requirement.
- Removed Preview from the existing DATABASE_URL environment variable targets through a metadata-only Vercel edit; re-read confirms production-only scope. No credential value read or changed. Old immutable Previews still retain old snapshots: a fresh build and effective-target verification are mandatory before writes.
- Retrieved an authorized read-only Radiantz subset: 10 published active products / 15 variants. Verified decimal USD prices and real variant IDs. Thirteen DENY/zero-inventory variants are blocked; two CONTINUE/zero-inventory variants are made-to-order. Offline actual sales code discovers the latter and rejects unsupported motorcycle fitment. Private source data is outside the public repository; this is limited-subset evidence, not complete catalog coverage or a completed purchase.
- Fixed the evidence runner to forbid production overrides, require approved Preview host and independent isolation/cost/write attestation, validate configuration-only health before cart calls, require merchant auth and explicit verified variant IDs, skip unavailable variants, record priceCents and enforce TEST checkout response. Raw response bodies are excluded from failure messages.
- Local verification: all 211 tests PASS, zero failures/skips; typecheck PASS; lint PASS with one existing img warning; production build PASS. Nine new behavioral preflight tests use fake network responses; they do not prove infrastructure readiness.
- No actual cart/Stripe payment/Neon order, replay or database outage test was run. Staging is NOT ready. Stripe connector authentication loops prevented account inspection; test secret/webhook configuration must be supplied directly through staging-only Vercel variables. Protected webhook delivery also needs verification before a test payment.
- Next: identify an existing zero-cost dedicated Neon Free-plan environment or verifiable database credit coverage, then configure secure branch-specific staging, rebuild and verify the effective target before executing the authorized purchase/replay/recovery acceptance. Hourly worker retains Shopify integration/pagination ownership.

## 2026-10-18 protected Preview diagnosis and AI pilot runner

- Re-read #105/#108 and #114. Inspected all projects available through the working Neon connection: VibeCart, Two Takes and NAICSdirect, all in the same Launch organization. Branch metadata provides no dedicated zero-cost commerce staging. Second connection cannot resolve its tools. No database queries, provisioning or paid compute activation performed.
- Official Neon documentation supports separate Free organizations, but the authenticated account menu currently exposes only the Launch organization and no Create organization control. No verified zero-cost target; existing projects/plan/Business Brain unchanged.
- Diagnosed two separate Vercel failures: connector project authorization (team visible, project list empty, API 403/404), and normal protected Preview browser sign-in/2FA. Owner completed 2FA. Actual #114 Preview configuration-only health reports no DB/Stripe and reference catalog; /mcp returns STAGING_SAFETY_GATE/isolation_unverified. This verifies the new deployment is blocked, not ready for commerce. Protection preserved.
- Pilot runner now actually uses AI find_products/create_sales_cart/checkout_sales_cart, checks independent exact USD prices, expected merchant, attribution and cart quantity/price, records TEST session ID and rejects HTTP-200 MCP tool errors. Added same-origin short-lived OIDC authentication with redirects forbidden; credentials/capabilities excluded from evidence. Main production alias is also forbidden.
- Offline actual-route acceptance runs this runner through MCP/cart/checkout modules, real Stripe signature verification and PGlite PostgreSQL, then verifies replay yields one attributed order. Synthetic catalog and Stripe network transports; this is not a real Radiantz/Neon/Stripe transaction.
- Local all 217 tests PASS, zero failures/skips; typecheck/build PASS; lint PASS with one existing img warning. CI pending at checkpoint.
- Added blank staging-only environment template and exact operator runbook, including protected CLI TEST webhook delivery without disabling protection or adding a paid relay. CLI and permanent webhook operations remain unverified; no delivery, payment or staging DB writes executed.
- Existing private 15-variant Radiantz capture unchanged. CONTINUE permits continued selling; normalized made_to_order does not establish lead time or motorcycle fitment. Revalidate freshness before real purchase.
- Next: owner resolves a dedicated Free-plan environment/allowance and secure Preview TEST credentials; connector project authorization can be repaired independently. Verify effective target/role, rebuild, then execute purchase/order/replay/outage/tenant acceptance. Hourly worker's Shopify files untouched; coordination sent.

## 2026-10-18 temporary Neon staging and quoted-price checkout safety

- Re-read #105/#108 and current PR stack through #115; worker Shopify/pagination heads unchanged. Coordinated checkout-only file claims. No merge or production modification.
- Found official anonymous Claimable Neon, avoiding the paid account: 72h, 100MB storage/1GB transfer, no account/payment details. Provisioned independent project royal-mountain-93927396 / root br-damp-scene-b4ewajhs; expires Oct 21 at 16:43 Pacific. No claim into paid Launch, upgrade, or recurring subscription. This is temporary staging, not a permanent merchant backend.
- Independently matched project/branch/endpoint metadata and different org, then verified effective database/role and an empty target before writes. Applied migrations 001/002/004/005/007/008. Existing PostgreSQL payment/tenant/outbox assertions passed with explicit rollback. Dedicated runtime role lacks superuser/create DB/create role/create schema. Credentials/import bundle outside Git under ACLs limited to owner and Codex runtime.
- Actual VibeCart modules + preserved 15 real Radiantz variants + real Neon HTTP passed signed synthetic payment persistence, runtime INSERT-permission outage (503 and rollback), access recovery/retry/replay (one 6599-cent order and event), cross-merchant cart/capability rejection and unknown fitment rejection. Stripe transport/payment was simulated; no actual Stripe TEST payment or deployed Preview commerce transaction. Evidence: docs/pilots/evidence/2026-10-18-neon-staging.json. Permission outage is not a network/compute outage.
- Reproduced stale cart quote defect (200 instead of 409 on changed catalog price), then fixed checkout to require exact unit/line/subtotal/currency consistency before Stripe. Kept existing per-cart Stripe idempotency key and added safe 409 retry-parameter conflict handling; unchanged retries reuse the session in the Stripe-behavior fixture. Local all 219 tests PASS, no failures/skips; build/typecheck PASS; lint PASS with existing img warning. CI pending.
- Vercel browser metadata confirms production-only DB/Stripe variables. Connector identity probe also fails /v2/user 404, beyond project 403/404; exact identity/scope cause remains unresolved. Protection untouched. Verified Add Variable defaults to Production, and choosing a Preview branch retains Production unless explicitly deselected; operator runbook must call this out.
- Remaining owner actions: securely import prepared staging-only bundle into the pilot branch, supply TEST Stripe key and matching protected-delivery signing secret, and optionally reconnect narrowly scoped Vercel automation. Effective Preview target, private real feed delivery, protected webhook, actual TEST payment and network outage acceptance remain unverified. Do not set isolation attestation just to pass. Do not claim temporary DB into paid org.
- Next engineering: safely serve the limited approved feed in protected staging, rebuild after secret configuration and verify effective target/role, then execute actual Stripe TEST checkout/order/replay/recovery proof before second-merchant onboarding. No metered AI calls or merchant/customer changes.

## 2026-10-18 private protected Radiantz feed

- #116 full CI run 39178211461 PASS at c2f9bf2fcc86b1709d4fe43d80c0c18823cb21fa, including PostgreSQL, MCP Inspector and official UCP checks.
- Added a Preview-only private snapshot endpoint to remove the need for public export hosting/new services. It requires the existing staging gate, merchant auth, matching merchant ID, a bounded 1–20 product document and a capture no older than 24h. Production returns 404. Existing catalog parser validates all fields; stock and unknown fitment preserved.
- Generic catalog client authenticates only its exact same-deployment pilot endpoint with runtime OIDC/merchant headers; external catalogs never receive those secrets. HTTPS/DNS/private-IP, no redirect following, size/timeout and product validation remain intact. Shopify mapper/sync/pagination/readiness source untouched; worker coordination sent.
- Prepared private Preview import bundle with the restricted Neon runtime credential, new merchant/cart secrets and preserved 15-variant snapshot; dotenv round-trip verified. No secrets/export committed. Isolation attestation stays false until effective deployed configuration is verified. Actual feed/Stripe/webhook runtime is not yet configured or tested.
- Local all 230 tests PASS, no failures/skips; build/typecheck PASS; lint PASS with existing img warning. CI pending. Capture requires source revalidation after Oct 19 15:49 Pacific; temporary Neon expires Oct 21 16:43 Pacific. No paid-account claim/upgrade or production changes.
- Remaining owner work is secure branch-only variable import and TEST Stripe credentials; then verify fresh Preview target/role/OIDC/private feed, establish protected webhook delivery, and execute the actual TEST payment/order/replay/network-outage acceptance. Existing real-Neon proof used an offline Stripe simulation and permission outage only.
