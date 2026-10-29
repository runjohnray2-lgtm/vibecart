# Radiantz staging configuration and access

This is an operator configuration contract, not readiness evidence. Follow #108.
The pilot remains blocked until each independent safety gate passes. Do not
change production credentials, downgrade the existing Neon organization, or
copy production data into staging.

## Verified access diagnosis (October 18, 2026)

- #114 deployment `dpl_9pV3qv2dqu2Gw3EZLEtTcGfHNxxx`, commit
  `3ebd49cbf19fdeaaed1affbcd6bbdbbe63563483`, is Ready and Preview in the dashboard.
- The connector sees the Promptmeter team but returns an empty project list,
  project/deployment 404s and a protected-fetch API 403. This is a connector
  project authorization problem; disabling Preview protection will not fix it.
- A later identity probe also returns `GET /v2/user` 404. Exact connector identity
  or scope failure is unresolved; reconnect the intended account and authorize only
  Promptmeter/vibecart. Browser sign-in works independently; do not weaken protection.
- The actual Preview redirects to normal Vercel sign-in/2FA. After owner sign-in,
  `/api/health` is reachable and reports `stagingSafetyConfigured=false`,
  `durableOrderStoreConfigured=false`, `stripeMode=none`, and reference catalog.
  `/mcp` returns `STAGING_SAFETY_GATE` / `isolation_unverified`. No cart writes,
  migrations or payment calls were made. Protection and the application gate
  are both enforced on this deployment; a configured target is not yet verified.
- Production DATABASE_URL is production-only. Old immutable deployments from
  before the scope correction must not be used for writes.

## Zero-cost database decision

The accessible Neon connection lists one Launch organization and three projects:
`aged-fog-58501989` (VibeCart), `odd-truth-21546196` (Two Takes), and
`snowy-base-35036596` (NAICSdirect). Branch metadata shows production/default,
Business Brain and archived prior tests, with no dedicated commerce staging.
The second configured Neon connection fails tool resolution. No database queries
were issued to wake compute. Included branches do not include Launch compute.

The paid account remains unchanged. A separate zero-cost temporary target is now
available through **Claimable Neon**, without linking a human account or payment
details. Official limits: 72 hours, 100 MB storage, 1 GB transfer; do not claim into
the paid organization or extend/upgrade without a separate cost decision.

On October 18, provisioned project `royal-mountain-93927396`, independent root
`br-damp-scene-b4ewajhs`, endpoint `ep-blue-hill-b46430js`. Verified its owning org
differs from the paid organization, its credentials map to that endpoint, and the
effective database/role and empty target match before migration. Expires
**October 21, 2026 at 4:43 PM Pacific**. This is temporary pilot infrastructure,
not a permanent merchant backend. Do not import production/customer records.

Migrations 001/002/004/005/007/008 applied; PostgreSQL durability assertions passed
with explicit rollback. A dedicated runtime role has commerce/rate-limit DML only,
with no superuser/create-database/create-role/create-schema privileges. Credentials
and a sensitive Preview import bundle are outside Git under restrictive local ACLs
for the owner and Codex runtime; no secrets appear in the evidence.

Actual VibeCart modules using the preserved real Radiantz subset and real Neon HTTP
passed a **Stripe network simulation**: signed synthetic payment event, induced
INSERT-permission outage returning 503 and rolling back the order, access recovery,
retry/replay yielding one 6599-cent order/event, and cross-merchant cart rejection.
This does not prove a real Stripe TEST payment or a network/compute outage. The
simulated session/event IDs are explicitly labeled in the evidence. Preserve that
distinction when verifying the eventual real transaction; correlate by session ID.

Supabase Free was also investigated, but the current Neon HTTP transport is not a
drop-in client for its PostgreSQL endpoint. No alternate service was provisioned.

Sources: [organization management](https://neon.com/docs/manage/orgs-manage),
[current pricing](https://neon.com/pricing),
[Claimable Neon](https://neon.com/claimable-neon),
[Claimable API and expiry](https://neon.com/docs/reference/claimable-neon).

## Vercel Preview variables

Use sensitive server variables for credentials, Preview only, restricted to the
reviewed pilot branch (`agent/private-pilot-feed` for this PR). Never select
Production or Development. `.env.staging.example` is a blank template only.

Verified UI detail: **Add Environment Variable defaults to Production**. Selecting
a Preview branch adds that branch and leaves Production selected. In Environments,
open Environments and deselect Production/Development, then Preview Branches and
select only the pilot branch. Verify the collapsed selector contains only the
branch before importing the private `.env` bundle or saving. Keep Type **Secret**.
Never edit the existing production DATABASE_URL or Stripe rows.

| Variable | Required staging value / independent verification |
| --- | --- |
| `DATABASE_URL` | Dedicated empty staging database and isolated role; securely supplied. Verify Neon project, branch, endpoint hostname, database and role before migration. |
| `POSTGRES_URL` | Absent/empty, or exactly the same staging connection; no production fallback. |
| `VIBECART_STAGING_DATABASE_HOST` | Exact hostname of the approved staging URL. Check pooled hostname resolves to the approved endpoint too. |
| `VIBECART_STAGING_ISOLATION_VERIFIED` | `false` until plan/allowance, target ownership and role separation are independently verified; only then `true`. |
| `STRIPE_SECRET_KEY` | Server key from the intended existing Stripe TEST account/sandbox; `sk_test_` or appropriately permissioned `rk_test_`. |
| `STRIPE_WEBHOOK_SECRET` | Matching TEST delivery signing secret. CLI listener and Dashboard endpoint secrets are different; use the secret for the chosen delivery path. |
| `VIBECART_HOSTED_MODE` | `true` |
| `VIBECART_MERCHANT_ID` | `radiantz-staging`, never `default` |
| `VIBECART_MERCHANT_API_KEY` | New staging-only random secret, at least 24 characters; do not reuse production. |
| `VIBECART_CART_ACCESS_SECRET` | New staging-only random secret, at least 32 characters. |
| `VIBECART_CATALOG_URL` | Approved HTTPS limited feed, preserving real variant IDs and exact USD cents; no credentials embedded in the URL. |
| `VIBECART_PILOT_CATALOG_ENABLED` | `true` only for the controlled private snapshot in Preview; computes its own immutable deployment HTTPS feed URL. Leave explicit catalog URL empty for this path. |
| `VIBECART_PILOT_CATALOG_JSON` | Sensitive JSON `{ merchantId, capturedAt, products }`, 1–20 verified variants, at most 48 KB, no customer/credential data. Captured timestamp must be within 24h (at most 30s future clock skew). Refresh via the authorized read-only source when stale. |
| `VIBECART_MERCHANT_NAME` | `Radiantz LED Lighting (TEST pilot)` |
| `VIBECART_AI_SALESPERSON_ENABLED` | `true`; existing deterministic grounded tools, no metered LLM call required. |
| `VIBECART_CLOUD_INGEST_URL`, `VIBECART_CLOUD_INGEST_KEY` | Empty; remove inherited outbound configuration in this branch. |
| `VIBECART_CLOUD_OUTBOX_CRON_ENABLED` | `false` |
| `VIBECART_ORDER_PERMALINK_TEMPLATE` | Empty; no production dashboard links. |
| `VIBECART_AUTOMATIC_TAX_ENABLED`, `HSN_CHECKOUT_ENABLED` | `false`; no extra tax services or unrelated merchant checkout. |

Keep Deployment Protection enabled, noindex/no-store, and the Preview route
allowlist. Do not configure production fulfillment, notifications, writeback,
email, cron or paid AI services. Rebuild after variables change. Before the first
migration, securely verify the effective fresh deployment connection's resource
IDs and role grants against the approved staging resource. Health is configuration
only and cannot prove target identity or grants. Do not probe production with
staging credentials merely to claim a negative test.

The private snapshot endpoint `/api/pilot/catalog` requires Preview, the isolation
gate, merchant authentication and fresh validated JSON. Production returns 404.
The catalog client sends same-project short-lived OIDC and merchant headers only
to this exact deployment/path, never to external URLs. Existing HTTPS/DNS/private-IP,
size, timeout, redirect and product validation remain in force. No export is
committed or publicly hosted; this is a controlled snapshot, not Shopify sync.
Actual protected runtime feed access remains to be verified after secure import.
The current capture expires for feed use October 19 at 3:49 PM Pacific; revalidate
the source rather than editing the timestamp. Database lifetime is separate.

## Authenticated client and protected test webhook delivery

For same-project Preview HTTP access, prefer `vercel curl` with the exact full
Preview URL. For this Node pilot runner, inject the linked project's short-lived
development `VERCEL_OIDC_TOKEN` through its normal credential mechanism. The
runner sends it only to the approved Preview origin in
`x-vercel-trusted-oidc-idp-token`, refuses redirects, and excludes it from evidence.
Never put tokens in query strings, committed files, chat or logs. A browser login
cookie does not authenticate the Node runner or Stripe's servers.

For the controlled pilot, Stripe CLI can receive TEST events and forward them
with the Vercel header while protection remains on. This avoids a public bypass
or another paid relay. Verify CLI identity/sandbox and same-project OIDC access
before use. CLI/API credentials are not currently available in this environment.

1. In a private operator terminal, authenticate official Stripe CLI to the intended
   existing TEST account/sandbox. Never use `--live`, `--skip-verify`, full payload
   debug logging, or an API key argument containing a literal secret.
2. Supply the short-lived same-project Vercel development OIDC token securely.
   Forward only `checkout.session.completed,checkout.session.async_payment_succeeded`
   to `https://FINAL-VERIFIED-PREVIEW/api/webhook/stripe` using `stripe listen`
   with `--events`, `--forward-to` and `--headers`. The header name is
   `x-vercel-trusted-oidc-idp-token`. Do not echo the expanded command or capture
   the listener's secret banner in CI/public logs.
3. Copy the listener's signing secret directly into the branch's sensitive
   `STRIPE_WEBHOOK_SECRET`, then rebuild and verify the effective target again.
   A Dashboard endpoint is not required for CLI forwarding. Do not configure
   an unauthenticated Dashboard destination against protected Preview.
4. Validate a signed non-payment TEST event reaches the receiver, that expired or
   missing Vercel authorization remains blocked, and a bad Stripe signature is
   rejected. This validation must wait for the database/cost gates even if the
   event is expected to be ignored. Refresh the token if it expires.
5. Only then complete the actual authorized TEST checkout. CLI delivery proves
   the controlled pilot path; unattended production webhook operations still need
   a separately reviewed permanent delivery design. Record CLI downtime and failed
   deliveries explicitly. Do not claim Stripe automatic retry evidence from CLI
   forwarding; replay/recovery acceptance requires explicit event correlation.

Sources: [Vercel protected access](https://vercel.com/docs/cli/curl),
[Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources),
[Stripe listen flags](https://docs.stripe.com/cli/listen).

## Pilot execution inputs and acceptance evidence

In addition to the #114 write/isolation/host gates, the runner requires
`VIBECART_PILOT_MERCHANT_ID`, explicit variant IDs, and
`VIBECART_PILOT_EXPECTED_PRICES` as a JSON object mapping every ID to independently
verified integer USD cents. An optional `VIBECART_PILOT_QUERY` can select the
approved shopper query. Default is the first eligible catalog product name.
It requires AI tools, discovers a verified purchasable match, creates an attributed
sales cart, verifies merchant/variant/quantity/price/attribution through reads and
updates, then optionally calls AI checkout. It records the TEST session ID for
order correlation, never cart capability or checkout URL.

The private captured subset remains unchanged: 15 variants, 13 zero-stock DENY
blocked. Two zero-stock CONTINUE variants allow continued selling under the
merchant's policy and are represented as `made_to_order`; this is not evidence of
manufacturing lead time or verified motorcycle fitment. Revalidate freshness
before actual checkout. The runner does not pay or prove Neon persistence.

Remaining acceptance: complete payment; compare expected order amount and merchant;
prove exactly one order/event correlation; replay; inject a staging-only persistence
failure then retry and prove rollback/recovery; reject a second tenant; recheck
stock/fitment. Record deployment SHA, verified target IDs, migration versions and
TEST session/event IDs. Do not publish credentials, customer data or raw exports.
