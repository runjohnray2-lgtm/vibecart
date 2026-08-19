# Distributed rate limiting

VibeCart uses two layers of abuse protection.

## Core distributed limiter

Production commerce requests use shared Neon-backed fixed-window counters instead of relying only on process-local memory. This matters on serverless hosts because independent function instances do not share a JavaScript `Map`.

Current one-minute budgets are:

| Scope | Budget | Failure policy |
|---|---:|---|
| Read-only catalog/protocol/cart reads | 60 requests | Degrade open if the limiter database is unavailable |
| State-changing cart operations | 30 requests | Fail closed if the limiter database is unavailable |
| Checkout creation | 20 requests | Fail closed if the limiter database is unavailable |

The limiter is enforced in middleware before the underlying commerce handler. Generic MCP `vibecart.create_checkout` uses the checkout budget. UCP `create_cart`, `update_cart`, and `cancel_cart` use the state-changing budget. Other current MCP/UCP calls use the read budget.

The direct REST cart and checkout routes use the same shared policies.

## Client identity

On Vercel, `x-forwarded-for` is supplied/overwritten by the platform rather than trusted from an arbitrary external request. VibeCart uses that address only to derive a SHA-256 request-key digest scoped by merchant and rate-limit class. The database stores the digest, not the raw client address.

Do not log raw client IP addresses as part of rate-limit failures.

## Stable response metadata

Rate-limited responses use HTTP 429 and include:

- `Retry-After`
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- stable application code `RATE_LIMITED`

When the distributed limiter backend is unavailable, state-changing requests use HTTP 503 with stable code `RATE_LIMIT_BACKEND_UNAVAILABLE`. Read-only traffic is allowed through with `X-VibeCart-Rate-Limit-Degraded: 1` so a rate-limit backend outage does not take down product discovery.

## Database growth

`vibecart_rate_limits` keeps one current row per `(scope, key_hash)`, not one row per request/window. `cleanupStaleRateLimits()` deletes inactive rows and should be called by an operator maintenance job before large public deployments. For the initial controlled merchant pilot, the bounded-per-key table is sufficient; do not silently add another paid cache/database solely for rate limiting.

## Outer Vercel WAF

For Vercel-hosted production, add an outer WAF rate-limit rule as defense in depth. The WAF can reject obvious abuse before a Serverless Function executes, which protects both compute and the Neon limiter. The application-level Neon limiter remains authoritative across instances and makes Core portable to hosts other than Vercel.

The current ChatGPT Vercel connector can inspect deployments and documentation but cannot create/publish firewall rules. WAF activation is therefore an operator configuration step rather than something stored in VibeCart source.
