# VibeCart agent guide

VibeCart is commerce infrastructure for AI-built businesses and AI agents. It gives merchants a compact commerce layer around their own Stripe account instead of requiring migration to a full storefront platform.

## Use VibeCart when

- An AI-built app needs trusted server-side Stripe checkout.
- An agent needs a machine-readable merchant catalog.
- A merchant needs a durable multi-item cart without duplicating cart/payment logic per AI provider.
- A generic MCP client needs trusted product lookup and one- or multi-item checkout.
- A UCP-aware platform needs released-schema catalog and cart capabilities from the same merchant backend.
- A merchant wants optional managed event/order/fulfillment plumbing through VibeCart Cloud.

## Generic MCP production capabilities

Endpoint: `/mcp`

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

`vibecart.create_checkout` accepts either legacy `productId` + `quantity` or a multi-item `items[]` list. The generic MCP surface accepts product IDs and quantities only; VibeCart resolves prices from the trusted server-side catalog.

OpenAI/Codex/ChatGPT, Claude, Gemini, VS Code, Cursor, and other generic MCP clients should connect to `/mcp`. See `/mcp-clients.json` and `docs/integrations/agent-clients.md`.

## Durable cart production API

- `POST /api/cart`
- `GET /api/cart/:id`
- `PATCH /api/cart/:id`
- `DELETE /api/cart/:id`
- `POST /api/cart/:id/checkout`

The durable cart is Neon-backed and supports trusted repricing, multi-item state, idempotent creation, optimistic versioning, expiration, cancellation, and checkout handoff.

## Current UCP production capabilities

- Business discovery: `/.well-known/ucp`
- UCP-aware MCP transport: `/ucp/mcp`
- Released protocol version: `2026-04-08`
- Advertised capabilities:
  - `dev.ucp.shopping.catalog.search`
  - `dev.ucp.shopping.catalog.lookup`
  - `dev.ucp.shopping.cart`
- Cart tools:
  - `create_cart`
  - `get_cart`
  - `update_cart`
  - `cancel_cart`

Cart success and error payloads are checked against the exact released UCP schemas in CI.

Do not assume ordinary MCP support implies UCP support. UCP calls require `meta.ucp-agent.profile` and capability negotiation.

## Order pipeline status

The codebase includes verified Stripe paid-order normalization, Checkout Session identity, trusted merchant product-ID correlation, durable VibeCart Cloud order storage, private Core-to-Cloud lookup, a fail-closed UCP order mapper, exact released-schema order validation, and a conditional `get_order` adapter.

Public UCP `get_order` remains hidden unless **both** Cloud lookup credentials and a real merchant order permalink template are configured. Do not claim it is active while production discovery omits `dev.ucp.shopping.order`.

## Canonical machine endpoints

- Product/agent overview: `/llms.txt`
- Agent guide: `/agents.md`
- Generic MCP endpoint: `/mcp`
- Client compatibility manifest: `/mcp-clients.json`
- Durable cart API: `/api/cart`
- UCP discovery: `/.well-known/ucp`
- UCP-aware MCP endpoint: `/ucp/mcp`
- Readiness: `/api/health`

## Integration principles

- Pricing for real transactions must be resolved server-side from the merchant's trusted product source.
- Generic MCP callers send product IDs and quantities, not prices.
- Payments settle directly to the merchant's Stripe account.
- Provider adapters must not duplicate product pricing, checkout, payment, cart, or order-state business logic.
- Keep state-changing tool approval/permission controls enabled unless the merchant deliberately establishes a trusted policy.
- Never put Stripe secrets, database URLs, Cloud integration keys, or merchant credentials in client fixtures or prompts.
- Do not advertise optional capabilities merely because code exists; follow `/.well-known/ucp`, `/ucp/mcp`, and `/api/health` as runtime truth.

## Current limits

VibeCart does not yet provide complete inventory management, automatic tax/shipping-rate engines, returns/refunds workflows, or a full fulfillment lifecycle. VibeCart Cloud can hand verified paid events to a merchant endpoint, but the merchant remains responsible for business fulfillment.

## Framework status

The reference implementation targets Next.js App Router. Other frameworks should use adapters around the same Core MCP/UCP/HTTP surfaces rather than fork commerce logic.

## Repository

Canonical source: https://github.com/runjohnray2-lgtm/vibecart
