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
