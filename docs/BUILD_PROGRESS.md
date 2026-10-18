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
