# Payment durability

VibeCart Core is the source of truth for paid orders. VibeCart Cloud is optional.

## Stripe acknowledgement contract

For `checkout.session.completed` and `checkout.session.async_payment_succeeded`:

1. Verify the Stripe signature against the raw request body.
2. Ignore non-payment-ready `checkout.session.completed` events until payment settles.
3. Normalize the Checkout Session and all Stripe line items.
4. Persist the order, line items, payment event, tenant identity, and optional Cloud outbox record to Neon in one database transaction.
5. Return HTTP 200 only after the Core transaction succeeds.
6. If Core persistence fails, return HTTP 503 so Stripe retries the same event.
7. If optional Cloud delivery fails after Core persistence, keep the outbox row and still return HTTP 200 to Stripe. Stripe must not replay an already-durable Core order because an optional downstream service is unavailable.

The Checkout Session ID is the durable order idempotency key. Stripe event IDs are also unique in the order event log. Duplicate webhook deliveries therefore do not create duplicate orders.

## Optional Cloud outbox

Migration `007_core_order_outbox.sql` adds `vibecart_cloud_outbox`. Migration `008_outbox_lease_ownership.sql` adds a fresh random ownership token for each claim. Completion and failure updates require that token, so an expired worker cannot overwrite a replacement worker.

The outbox is created only when either `VIBECART_CLOUD_INGEST_URL` or `VIBECART_CLOUD_INGEST_KEY` indicates that Cloud delivery has been requested. It is inserted in the same transaction as the Core order.

Delivery behavior:

- Immediate delivery is attempted after the Core transaction commits.
- A Cloud failure never changes the Stripe acknowledgement once Core is durable.
- Failed rows return to `pending` with bounded backoff.
- A processing lease allows an interrupted worker to be reclaimed.
- Repeated failures eventually become `dead_letter` rather than retrying forever.
- The worker reconstructs the outbound payload from the authoritative stored Core order. Stripe secrets and webhook signing secrets are never written to the outbox.

## Retry worker

Vercel calls `GET /api/cron/cloud-outbox` every five minutes.

The route is disabled by default. To enable it only after migrations 007 and 008 are applied:

```bash
VIBECART_CLOUD_OUTBOX_CRON_ENABLED=true
CRON_SECRET=<strong random value>
```

When disabled, the cron route is a no-op. When enabled, it requires `Authorization: Bearer <CRON_SECRET>`.

## Required migrations

Apply in order:

- `001_durable_carts.sql`
- `002_distributed_rate_limits.sql`
- `003_app_library_links.sql`
- `004_cart_metadata.sql`
- `005_durable_orders.sql`
- `006_business_brain_foundation.sql` when Business Brain is used
- `007_core_order_outbox.sql`
- `008_outbox_lease_ownership.sql`

Payment durability requires 005. Optional Cloud replay requires 007 and 008. Apply 008 before deploying the updated workers.

## Safe rollout

Do not enable real-money checkout as part of this change.

Before merging/deploying payment changes:

1. Apply 005, 007, and 008 to a non-production Neon branch.
2. Run the unit, build, typecheck, lint, MCP, and UCP checks.
3. In Stripe test mode, create one Checkout Session and deliver the same signed webhook more than once.
4. Verify exactly one `vibecart_orders` row exists for the Checkout Session.
5. Verify all line items are present.
6. Verify a Core order is still created with Cloud configuration absent.
7. With Cloud configured to a failing test endpoint, verify Core still returns 200 after the order is durable and the outbox remains retryable.
8. Restore a healthy Cloud test endpoint and verify the outbox reaches `delivered`.
9. Only after those acceptance checks should a separate owner-approved production rollout be considered.

## Merchant isolation

Core derives the hosted merchant identity from server configuration and rejects a Stripe Session whose merchant metadata conflicts with that hosted tenant. Cart conversion updates are scoped by both cart ID and merchant ID. The Cloud retry worker verifies the stored order merchant matches the outbox merchant before delivery.
