# VibeCart agent guide

VibeCart is commerce infrastructure for AI-built businesses and AI agents. Merchants keep their existing app, product source, and Stripe account while exposing trusted catalog, cart, checkout, and optional managed order plumbing through common agent protocols.

## Use VibeCart when

- An AI-built app needs trusted server-side Stripe Checkout.
- An agent needs a machine-readable merchant catalog.
- A merchant needs a durable multi-item cart without moving to a full hosted storefront.
- A UCP-aware platform needs released-schema catalog/cart capabilities.
- A merchant wants one MCP commerce backend shared across multiple AI clients.
- A merchant wants optional recurring managed infrastructure through VibeCart Cloud.

## Generic MCP production surface

Endpoint: `https://vibecart.vercel.app/mcp`

Tools:

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

`vibecart.create_checkout` supports trusted multi-item `items[]` checkout and the legacy single-product input. Never invent or pass a real transaction price; VibeCart resolves trusted products/prices server-side.

OpenAI/Codex/ChatGPT, Claude, Gemini, VS Code, Cursor, and other generic MCP clients should connect to `/mcp`.

## Merchant catalog source

The built-in `lib/products.ts` catalog is fictional demo/reference data. A real merchant should configure `VIBECART_CATALOG_URL` to a merchant-controlled, public-routable HTTPS JSON feed. Optional server-side settings are `VIBECART_CATALOG_BEARER_TOKEN` and `VIBECART_MERCHANT_NAME`.

Accepted product fields:

- `id` — stable merchant identifier, required
- `name` — required
- `priceCents` — trusted non-negative integer USD cents, required
- `description` — optional
- `image` — optional HTTPS URL
- `variant` — optional

The same provider drives generic MCP listing/lookup, UCP catalog operations, durable cart repricing, and Stripe Checkout. Do not create separate prices/catalogs per agent protocol.

If a remote catalog is configured and it is unavailable or invalid, commerce fails closed. Never substitute the fictional demo catalog for a configured merchant source. Healthy remote catalog data is cached briefly so normal price/SKU updates propagate without editing VibeCart TypeScript.

## Durable cart production surface

The Neon-backed durable cart is live:

- `POST /api/cart`
- `GET /api/cart/:id`
- `PATCH /api/cart/:id`
- `DELETE /api/cart/:id`
- `POST /api/cart/:id/checkout`

Cart state is multi-item, server-priced, durable, versioned, idempotent on create, expiration-aware, and convertible to Stripe Checkout.

## UCP production surface

- Business discovery: `/.well-known/ucp`
- UCP-aware MCP transport: `/ucp/mcp`
- Released version: `2026-04-08`

Production currently advertises catalog + cart. UCP cart tools:

- `create_cart`
- `get_cart`
- `update_cart`
- `cancel_cart`

UCP calls require `meta.ucp-agent.profile` and capability negotiation. Do not assume generic MCP support implies UCP support.

The released-schema order pipeline exists, but public `get_order` remains hidden until Cloud order lookup and a real merchant order permalink are both configured.

## VibeCart Cloud

VibeCart Core is free to self-host. VibeCart Cloud is the optional $29/month managed layer for durable events/orders, fulfillment webhook delivery, retries, monitoring, alerts, updates, and support.

Cloud workspace: https://vibecart-cloud-uupzkh.v2.appdeploy.ai/

Merchant sales still settle directly to the merchant's Stripe account; VibeCart does not take a percentage of merchant sales.

## Canonical machine endpoints

- `/start` — merchant/client quickstart
- `/mcp` — generic MCP
- `/api/cart` — durable cart
- `/.well-known/ucp` — UCP discovery
- `/ucp/mcp` — UCP-aware MCP
- `/mcp-clients.json` — client compatibility manifest
- `/llms.txt` — concise machine notes
- `/agents.md` — this guide
- `/api/health` — readiness booleans only

## Integration rules

- Resolve real transaction prices from the configured trusted merchant catalog provider.
- Do not duplicate pricing/payment/cart/order business logic in provider-specific adapters.
- Keep state-changing tool approval/permission controls enabled unless the merchant has established a trusted policy.
- Never put Stripe secrets, database URLs, catalog bearer tokens, Cloud keys, or merchant credentials in client fixtures/prompts.
- Do not advertise or claim optional UCP capabilities unless `/.well-known/ucp` and `tools/list` actually expose them.

## Current limits

Do not claim VibeCart currently provides a complete multi-merchant catalog control plane, inventory system, automated tax engine, shipping-rate engine, returns/refunds platform, or complete fulfillment lifecycle. Those remain future platform work.

Canonical source: https://github.com/runjohnray2-lgtm/vibecart