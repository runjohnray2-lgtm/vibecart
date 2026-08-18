# VibeCart

**Commerce infrastructure for AI-built apps and AI agents.**

VibeCart lets a merchant keep their existing app and Stripe account while adding a small, inspectable commerce layer that AI agents can discover and use. Payments settle directly to the merchant's Stripe account; VibeCart does not need to become merchant of record.

The architecture is protocol-first: one trusted commerce backend, then thin MCP/UCP/client adapters around it.

## Live production surface

### Generic MCP

Endpoint: `https://vibecart.vercel.app/mcp`

Tools:

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

`vibecart.create_checkout` supports both the legacy single-product input and a trusted multi-item `items[]` input. Product prices are resolved on the server; callers do not supply real transaction prices.

Generic MCP clients should use `/mcp`.

### Durable cart

VibeCart's Neon-backed cart is live in production:

- `POST /api/cart`
- `GET /api/cart/:id`
- `PATCH /api/cart/:id`
- `DELETE /api/cart/:id`
- `POST /api/cart/:id/checkout`

The cart uses trusted server-side repricing, idempotent creation, optimistic version checks, expiration, multi-item state, and cart-to-Stripe Checkout handoff.

### UCP

- Discovery: `https://vibecart.vercel.app/.well-known/ucp`
- UCP-aware MCP transport: `https://vibecart.vercel.app/ucp/mcp`
- Released protocol target: UCP `2026-04-08`

Production advertises released catalog and cart capabilities. Current cart tools are:

- `create_cart`
- `get_cart`
- `update_cart`
- `cancel_cart`

UCP calls require `meta.ucp-agent.profile` and capability negotiation. Do not point an ordinary MCP client at `/ucp/mcp`.

The order pipeline and released-schema `get_order` adapter also exist, but `get_order` remains hidden until its VibeCart Cloud lookup and real merchant permalink dependencies are configured. VibeCart does not advertise optional capabilities before their runtime dependencies are ready.

### Stripe checkout and orders

- Trusted multi-line Stripe Checkout creation is supported.
- Stripe webhook signatures are verified before paid events enter the post-payment pipeline.
- Delayed-payment completion is handled separately so orders are not created prematurely.
- Paid Checkout line items are normalized into durable order records when VibeCart Cloud forwarding is configured.
- Trusted merchant product IDs survive Checkout through Stripe Product metadata.

## Agent-client distribution

VibeCart does **not** build a different commerce engine for every model. OpenAI/Codex/ChatGPT, Claude, Gemini, VS Code, Cursor, and other MCP clients connect to the same backend.

See:

- [`docs/integrations/agent-clients.md`](docs/integrations/agent-clients.md)
- [`integrations/mcp-clients.json`](integrations/mcp-clients.json)
- `https://vibecart.vercel.app/mcp-clients.json`

Provider adapters are CI-checked to keep Stripe/database secrets and duplicated commerce logic out of client configuration.

## VibeCart Cloud

VibeCart Core is free to self-host. **VibeCart Cloud is the optional $29/month managed layer** for merchants that want VibeCart to operate the recurring plumbing.

Current Cloud capabilities include:

- durable verified commerce events
- durable normalized paid-order records and order history
- server-to-server order lookup
- signed merchant fulfillment webhooks
- delivery history and bounded retries
- monitoring/alerts and support workflows

Cloud workspace: `https://vibecart-cloud-uupzkh.v2.appdeploy.ai/`

Merchant checkout revenue still settles directly to the merchant's Stripe account. VibeCart takes no percentage of merchant sales.

## Quick start

```bash
npm install
npm run dev
```

Without a Stripe secret, Checkout runs in clearly labeled demo mode. For live payments, configure `STRIPE_SECRET_KEY` in the hosting provider's secret/environment settings. Never commit secret values.

Useful public endpoints:

- `/mcp` — generic MCP transport/discovery
- `/api/cart` — durable cart creation
- `/.well-known/ucp` — UCP business discovery
- `/ucp/mcp` — UCP-aware MCP transport
- `/mcp-clients.json` — machine-readable client compatibility manifest
- `/llms.txt` — concise machine-readable integration notes
- `/agents.md` — agent-facing guide
- `/api/health` — boolean readiness state without secret values
- `/cloud` — managed Cloud offer

## Security model

- Merchant owns the Stripe account and receives merchant funds directly.
- Trusted prices come from server-side merchant catalog state.
- Client-supplied pricing is disabled by default and is prototype-only when explicitly enabled server-side.
- Stripe webhook signatures are verified before post-payment processing.
- Cart state is durable and versioned rather than trusted from the browser/agent.
- Cloud integration credentials remain server-side.
- Public health/discovery endpoints expose readiness booleans/capabilities, not credential values.
- Optional UCP capabilities are advertised only when their runtime dependencies are valid.

## Protocol conformance

CI pins the released UCP `v2026-04-08` source and executes VibeCart's real mappers through the official `ucp-schema` validator. Cart success/error payloads, catalog responses, discovery, and the private order mapper have release-pinned conformance gates.

## Current reference limits

- The merchant catalog is still a small reference catalog rather than a complete multi-merchant catalog service.
- Inventory, automated tax calculation, shipping-rate calculation, returns/refunds, and a complete fulfillment lifecycle are not finished platform services.
- Public UCP order lookup remains activation-gated until its Cloud/permalink runtime dependencies are configured.
- Next.js App Router is the reference implementation; other frameworks should use adapters around the same Core protocol surface rather than fork commerce logic.

## North star

> **VibeCart: commerce infrastructure for every AI agent. Build once. Sell everywhere AI can act.**

## License

MIT-style — free to use and adapt.
