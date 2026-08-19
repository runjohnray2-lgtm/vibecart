# Merchant authentication and tenant isolation

VibeCart Core supports two deployment modes.

## Self-host / single-merchant mode

This remains the default. If `VIBECART_HOSTED_MODE` is not `true`, Core behaves like the existing reference deployment:

- merchant identity defaults to `default` unless `VIBECART_MERCHANT_ID` is set;
- MCP/UCP and checkout do not require a VibeCart merchant key;
- direct cart routes do not require a VibeCart cart capability token;
- durable cart SQL is still scoped by `merchant_id`, so moving to an explicit merchant identity does not require changing the schema.

This mode is intended for a merchant running its own VibeCart Core deployment.

## Hosted merchant mode

Set all of the following server-side values:

```bash
VIBECART_HOSTED_MODE=true
VIBECART_MERCHANT_ID=merchant-stable-id
VIBECART_MERCHANT_API_KEY=long-random-server-to-server-key
VIBECART_CART_ACCESS_SECRET=long-random-cart-signing-secret
```

Requirements:

- `VIBECART_MERCHANT_ID` must be explicit; hosted mode refuses the legacy `default` identity.
- `VIBECART_MERCHANT_API_KEY` must contain at least 24 characters.
- `VIBECART_CART_ACCESS_SECRET` must contain at least 32 characters.
- Keep both secrets in the hosting provider's secret/environment settings. Never put them in Git, public MCP metadata, browser JavaScript, logs, or the VibeCart Command Center.

When hosted mode is enabled, merchant/server-to-server POST operations on `/mcp`, `/ucp/mcp`, `/api/checkout`, and `/api/cart` require:

```http
x-vibecart-merchant-key: <merchant API key>
```

Cart creation returns a `cartAccessToken` in addition to the cart. That token is an HMAC capability bound to both the merchant identity and the cart ID. Direct cart read/update/cancel/checkout requests may then use:

```http
Authorization: Bearer <cartAccessToken>
```

A valid merchant key also authorizes direct cart operations. Knowing a cart UUID by itself is not authorization in hosted mode.

## Database isolation

Every durable cart read, expiration transition, update, cancellation, and conversion query includes both `id` and `merchant_id`. Idempotency is already unique within `(merchant_id, idempotency_key)`.

A cart created under one configured merchant ID is therefore not returned by a Core instance configured for another merchant ID even if the caller knows the cart UUID.

## Existing `merchant_id = default` carts

Do not switch an existing production deployment to a new hosted merchant ID until its existing carts have been reviewed. The reference migration is deliberately manual because only the operator can know whether all legacy `default` rows belong to the new merchant.

First check for idempotency-key collisions between the legacy and intended merchant identities:

```sql
SELECT idempotency_key, count(*)
FROM vibecart_carts
WHERE merchant_id IN ('default', 'merchant-stable-id')
  AND idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING count(*) > 1;
```

If that query returns no collisions and all legacy rows belong to the merchant, perform the one-time reassignment during a maintenance window:

```sql
UPDATE vibecart_carts
SET merchant_id = 'merchant-stable-id', updated_at = now()
WHERE merchant_id = 'default';
```

Back up or snapshot the database first. Do not run this migration blindly on a shared database.

## Current boundary

This security layer makes merchant identity explicit, scopes durable cart storage by tenant, removes UUID-by-possession authorization for hosted direct carts, and provides server-to-server merchant authentication for hosted MCP/UCP/checkout/cart creation.

It does **not** yet turn the reference Vercel deployment into a full shared multi-merchant control plane. Per-merchant encrypted Stripe credentials, managed API-key issuance/rotation, merchant user sessions, roles, and Cloud-owned tenant provisioning remain separate work before VibeCart should host unrelated merchants inside one shared runtime.
