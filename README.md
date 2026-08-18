# VibeCart

**Commerce infrastructure for AI agents and AI-built businesses.**

VibeCart lets a merchant keep their existing app and Stripe account while exposing a small, inspectable commerce layer that AI agents can discover and use. Payments settle directly to the merchant's Stripe account; VibeCart does not need to become merchant of record.

The architecture is protocol-first: one trusted commerce backend, then thin MCP/UCP/client adapters around it.

## Current production surface

### Generic MCP

Endpoint: `https://vibecart.vercel.app/mcp`

Production tools:

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

`vibecart.create_checkout` supports both the legacy `productId` + `quantity` input and trusted multi-item `items[]` checkout. Prices are always resolved from the server-side merchant catalog on the generic MCP path; agents do not send prices.

Generic MCP clients should use `/mcp`.

### Durable cart HTTP API

The Neon-backed durable cart is live in production:

- `POST /api/cart`
- `GET /api/cart/:id`
- `PATCH /api/cart/:id`
- `DELETE /api/cart/:id`
- `POST /api/cart/:id/checkout`

The cart supports multiple products, server-side repricing, idempotent creation, optimistic version checks, expiration, cancellation, and handoff into the existing Stripe Checkout route.

### UCP

- Discovery: `https://vibecart.vercel.app/.well-known/ucp`
- UCP MCP transport: `https://vibecart.vercel.app/ucp/mcp`
- Released protocol target: UCP `2026-04-08`
- Production discovery currently advertises:
  - `dev.ucp.shopping.catalog.search`
  - `dev.ucp.shopping.catalog.lookup`
  - `dev.ucp.shopping.cart`
- Production UCP cart tools:
  - `create_cart`
  - `get_cart`
  - `update_cart`
  - `cancel_cart`

Cart success and error payloads are validated in CI against the exact released UCP schemas using official `ucp-schema`.

Do not point an ordinary MCP client at `/ucp/mcp`. UCP calls require `meta.ucp-agent.profile` and capability negotiation.

### Stripe checkout and paid-order pipeline

- Multi-line trusted server-side Checkout creation is supported.
- Catalog prices are resolved on the server rather than accepted from the browser for real transactions by default.
- Stripe webhook signatures are verified before paid events enter VibeCart's post-payment pipeline.
- Delayed-payment success events are handled separately so orders are not created prematurely.
- Paid Checkout line items are normalized into durable order data before optional Cloud forwarding.

## Agent-client distribution

VibeCart does **not** build a different commerce engine for every model. OpenAI/Codex/ChatGPT, Claude, Gemini, VS Code, Cursor, and other MCP clients connect to the same backend.

See:

- [`docs/integrations/agent-clients.md`](docs/integrations/agent-clients.md)
- [`integrations/mcp-clients.json`](integrations/mcp-clients.json)
- production manifest: `https://vibecart.vercel.app/mcp-clients.json`

Provider adapters must stay free of Stripe/database secrets and duplicated product/payment logic.

## VibeCart Cloud

VibeCart Cloud is the optional managed control plane for merchants that want VibeCart to operate the plumbing rather than self-host it. The live Cloud service includes:

- durable verified commerce events
- durable normalized paid-order records
- merchant order history
- integration-key-authenticated server-to-server order lookup
- signed merchant fulfillment webhooks
- delivery history and bounded retry scheduling
- payment/event alerts and support workflows

Core only uses Cloud when the merchant configures the Cloud integration URL/key. Missing Cloud configuration fails closed and does not change the merchant's Stripe settlement path.

## UCP order status

The repository includes the released UCP order mapper, exact released-schema validation, private Core-to-Cloud order lookup, and conditional `get_order` routing.

Public `get_order` remains intentionally hidden until **both** are configured at runtime:

1. VibeCart Cloud ingest URL/key
2. a real merchant order permalink template

Production currently keeps that capability dormant rather than advertising an incomplete order service.

## Quick start

```bash
npm install
npm run dev
```

Without a Stripe secret, checkout runs in clearly labeled demo mode. To use live Stripe Checkout, add `STRIPE_SECRET_KEY` in the hosting provider's secret/environment settings. Never commit secret values or paste them into source code.

Useful endpoints:

- `/mcp` — generic MCP discovery/transport
- `/api/cart` — durable cart creation
- `/.well-known/ucp` — UCP business discovery
- `/ucp/mcp` — UCP-aware MCP transport
- `/mcp-clients.json` — machine-readable client compatibility manifest
- `/llms.txt` — machine-readable integration notes
- `/agents.md` — agent-facing guide
- `/api/health` — boolean readiness state without secret values
- `/privacy`, `/terms`, `/support` — public policy/help surfaces

## Security model

- Merchant owns the Stripe account and receives merchant funds directly.
- Trusted prices come from server-side merchant catalog state.
- Generic MCP checkout accepts product IDs and quantities, never caller prices.
- Client-supplied inline pricing is disabled by default and is prototype-only when explicitly enabled server-side.
- Stripe webhook signatures are verified before post-payment processing.
- Cloud integration credentials remain server-side.
- Public health/discovery endpoints expose readiness booleans/capabilities, not credential values.
- Optional UCP capabilities are advertised only when their runtime dependencies are valid.

## Protocol conformance

CI pins the released UCP `v2026-04-08` repository and uses official `ucp-schema` validation for catalog, cart, cart-error, and order payloads. VibeCart does not treat a locally convenient JSON shape as protocol conformance.

## Reference implementation limits

- The current merchant catalog is still a small reference catalog rather than a complete multi-merchant catalog database.
- Inventory, tax calculation, shipping-rate calculation, returns/refunds, and the full fulfillment lifecycle are not complete commerce-platform services yet.
- Public UCP order lookup remains activation-gated until Cloud + permalink runtime dependencies are configured.
- Next.js App Router is the reference implementation; other frameworks should use adapters around the same Core protocol surface.

## North star

> **VibeCart: commerce infrastructure for every AI agent. Build once. Sell everywhere AI can act.**

## License

MIT-style — free to use and adapt.
