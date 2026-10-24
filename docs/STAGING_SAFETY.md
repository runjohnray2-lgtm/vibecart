# Dedicated staging safety gate (#108)

Vercel Preview is approved only for isolated, test-mode merchant checkout. No production values, migrations, resources or transactions were changed by this code.

## Current infrastructure blocker (2026-10-18)

Read-only Vercel metadata still shows DATABASE_URL assigned to both production and preview. Stripe credentials remain production-only. No dedicated staging database or zero-incremental-cost compute has been verified. Do not invoke write-capable Preview endpoints, migrations or checkout yet. Do not reuse the Radiantz Business Brain test branch.

## Configure only after independent verification

1. Confirm a dedicated empty/schema-only non-production Neon database without copying customer/payment rows. Confirm zero incremental cost before provisioning/using compute.
2. Securely assign DATABASE_URL to that database for the dedicated Preview branch. Ensure the shared production database variable cannot be inherited there. Remove or isolate any POSTGRES_URL fallback. Do not change production values.
3. Independently verify the actual target (endpoint, branch, database and role) without publishing the connection string. Use a staging-only least-privilege role with no access to production.
4. Securely provision a Stripe test credential and its matching test endpoint signing secret in Preview only. A whsec_ prefix alone cannot establish test-mode ownership; verify the Stripe account/endpoint outside this gate.
5. Configure an explicit staging merchant, merchant API key and cart signing secret. Verify unauthorized/cross-tenant requests fail. Keep Vercel deployment protection enabled.
6. Keep Cloud delivery unset, cron disabled, email/notifications/fulfillment/writeback disabled. Other app, auth proxy, admin, billing and probe APIs are blocked in Preview by this gate.
7. Only once the checks above and included allowance are verified, set these Preview-only non-secret markers:

```text
VIBECART_STAGING_ISOLATION_VERIFIED=true
VIBECART_STAGING_DATABASE_HOST=<independently verified isolated endpoint hostname>
```

The gate compares the runtime database hostname with the approved hostname, refuses a different fallback URL, requires sk_test_/rk_test_ credentials, matching merchant auth configuration, and no Cloud delivery. These are runtime backstops, not independent proof: a mistaken hostname/attestation can still point at production. Never set the markers merely to make a deployment pass.

Unconfigured Preview returns 503 before the rate limiter or route handler. Health and static assets remain available without database access. Preview responses carry noindex/nofollow/noarchive and no-store. Live or unclassified Stripe webhook events are rejected even after signature verification. Production/local behavior is unchanged.

## Acceptance evidence still required

Record exact SHA/Preview URL, env-scope evidence without secret values, isolated Neon branch/database/role and migration versions, Stripe test endpoint/account verification, cost proof, real read-only Radiantz catalog IDs, external-client cart/checkout flow, one recorded test order, replay idempotency, DB-failure retry and cross-tenant denial. No email, fulfillment or customer messages.

Rollback: remove the Preview-only verification marker to block pilot requests immediately. Do not merge into production or enable live charges under this authorization.
