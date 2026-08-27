# VibeCart Core → Cloud event bridge

VibeCart Core can optionally forward Stripe-verified payment events into VibeCart Cloud for durable event state, merchant fulfillment delivery, delivery history, retries, and later order tooling.

## Required configuration

Core remains usable without Cloud. To enable the durable Cloud bridge, configure both server-side environment variables:

- `VIBECART_CLOUD_INGEST_URL` — the full HTTPS ingest endpoint issued by VibeCart Cloud. The self-hosted reference receiver uses `/api/cloud/ingest/<integration-id>`.
- `VIBECART_CLOUD_INGEST_KEY` — the integration key issued by VibeCart Cloud

Never commit either value to the repository or expose the key to browser code.

The existing Stripe webhook also requires:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Configure the Stripe webhook destination to send the Checkout Session events used by Core, including `checkout.session.completed` and `checkout.session.async_payment_succeeded` when delayed payment methods are enabled.

## Delivery behavior

1. Core reads the raw Stripe webhook body.
2. Core verifies the Stripe signature before any Cloud call is possible.
3. Only payment-ready Checkout Session events are forwarded.
4. Core sends Stripe's stable `event.id` to Cloud as `eventId`.
5. Cloud stores the event durably and treats repeated `eventId` deliveries as duplicates.
6. Cloud performs merchant fulfillment delivery from its durable event state, not directly from the Stripe handler.
7. If Cloud is unavailable or rejects the ingest request, Core returns a non-2xx response so Stripe can retry the same event later.

This preserves the separation of responsibilities:

Stripe → verified VibeCart Core webhook → durable VibeCart Cloud event → merchant fulfillment webhook.

The reference Next.js deployment includes an authenticated receiver and lookup pair at:

- `POST /api/cloud/ingest/<integration-id>`
- `POST /api/cloud/ingest/<integration-id>/order`

The receiver writes paid orders, order lines, gift/cart metadata, and order events to Neon. It is inactive unless the shared ingest key and integration URL are configured.

## Health check

`GET /api/health` exposes `cloudConfigured` as a boolean. It never returns the ingest URL, integration key, Stripe keys, or webhook secret.

## Security properties

- invalid Stripe signatures never reach Cloud
- the Cloud key is sent only in the server-to-server `x-vibecart-key` header
- Cloud ingest requires HTTPS
- Cloud response bodies are not reflected to the Stripe caller
- transient failures are retryable
- repeated Stripe deliveries reuse the same event ID

The bridge does not make VibeCart the merchant of record. The merchant continues to own its Stripe account and receive funds directly.
