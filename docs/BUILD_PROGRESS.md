# VibeCart Build Progress

Last updated: 2026-10-17

This file is the durable checkpoint for the autonomous build-to-revenue mission. Read it before starting a new work session and update it with verified repository/CI/runtime evidence.

## Mission order

1. #99 Payment durability
2. #93 AI salesperson
3. #94 Shopify integration
4. #97 Merchant subscriptions
5. #92 Merchant dashboard
6. #95 Consented checkout recovery
7. #96 ShipStation fulfillment
8. #98 MCP/UCP multi-merchant distribution

Do not reorder without a dependency reason.

## Current milestone — #99 Payment durability

Status: **IN PROGRESS on PR #91**

Existing PR:
- #91 `fix/webhook-require-durable-order-persistence`
- Before the #99 extension, PR #91 changed the webhook to depend on Cloud delivery. That protected against silent loss but incorrectly made optional Cloud a prerequisite for Core.

Verified baseline from GitHub Actions on PR #91 head `135620178dfb985edb8b6df018d0a83df0b59820`:
- Build: PASS
- Typecheck: PASS
- Lint: PASS
- Unit suite: 142 pass / 5 fail
- The five failures are pre-existing expectation/copy mismatches also identified before this milestone: homepage copy x2, generic MCP multi-item checkout expectation, public discovery metadata, and quickstart paths.
- UCP Cart Conformance stopped at the same unit-test failures, before schema validation.

Current #99 implementation being added to PR #91:
- Core persists verified paid Stripe events directly to existing Neon durable orders.
- Core persistence is independent of optional Cloud.
- Order + line items + payment event + merchant-scoped cart conversion + optional Cloud outbox are committed in one Neon transaction.
- New migration 007 adds replayable Cloud outbox state with leases, attempt counters, backoff, and dead-letter state.
- Immediate Cloud delivery happens only after the Core transaction commits.
- Cloud failures no longer cause Stripe to replay a Core-persisted payment.
- A guarded cron route can retry pending Cloud deliveries; it is disabled by default.
- Hosted merchant identity mismatch fails closed before persistence.
- Cart conversion is scoped by both cart ID and merchant ID.
- Tests are being updated to prove the new acknowledgement contract and tenant behavior.

## Required verification before #99 can merge

- GitHub CI build/typecheck/lint/unit tests must run on the new commit.
- Fix the five baseline unit-test failures if they remain and block CI.
- Apply migrations 005 and 007 to a non-production Neon branch and run SQL smoke checks.
- Run Stripe test-mode duplicate-delivery acceptance: one paid Checkout Session -> exactly one durable Core order.
- Verify Core creates the order with Cloud absent.
- Verify Cloud outage leaves a retryable outbox row without changing Stripe acknowledgement after Core persistence.
- Do not change live Stripe credentials, enable real-money billing, or merge unverified payment changes.

## Next executable task

After the #99 code commit reaches PR #91:
1. inspect GitHub Actions;
2. fix any regression caused by #99;
3. address the five known baseline unit-test failures if still blocking;
4. run the non-production Neon migration/smoke test;
5. update issue #99 and PR #91 with exact results.

Only then advance to #93.
