# VibeCart

**Commerce infrastructure for AI agents and AI-built businesses.**

VibeCart lets a merchant keep their existing app and Stripe account while exposing a small, inspectable commerce layer that AI agents can discover and use. Payments settle directly to the merchant's Stripe account; VibeCart does not need to become merchant of record.

The architecture is protocol-first: one commerce backend, then thin MCP/UCP/client adapters around it.

## Current production surface

### Generic MCP

Endpoint: `https://vibecart.vercel.app/mcp`

Current production tools:

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

Generic MCP clients should use `/mcp`.

### UCP

- Discovery: `https://vibecart.vercel.app/.well-known/ucp`
- UCP MCP transport: `https://vibecart.vercel.app/ucp/mcp`
- Released protocol target: UCP `2026-04-08`
- Production currently advertises catalog search/lookup only unless an optional capability's full runtime dependencies are ready.

Do not point an ordinary MCP client at `/ucp/mcp`. UCP calls require `meta.ucp-agent.profile` and capability negotiation.

### Stripe checkout

- Multi-line trusted server-side Checkout creation is supported by the Core checkout API.
- Catalog prices are resolved on the server rather than accepted from the browser for real transactions.
- Stripe webhook signatures are verified before paid events enter VibeCart's post-payment pipeline.
- Delayed-payment success events are handled separately so orders are not created prematurely.

## Agent-client distribution

VibeCart does **not** build a different commerce engine for every model. OpenAI/Codex/ChatGPT, Claude, Gemini, VS Code, Cursor, and other MCP clients connect to the same backend.

See:

- [`docs/integrations/agent-clients.md`](docs/integrations/agent-clients.md)
- [`integrations/mcp-clients.json`](integrations/mcp-clients.json)

The distribution fixtures are CI-checked to keep provider adapters free of Stripe/database secrets and duplicated product/payment logic.

## VibeCart Cloud

VibeCart Cloud is the optional managed control plane for merchants that want VibeCart to operate the plumbing rather than self-host it. The current Cloud service includes:

- durable verified commerce events
- durable normalized paid-order records
- merchant order history
- integration-key-authenticated server-to-server order lookup
- signed merchant fulfillment webhooks
- delivery history and bounded retry scheduling
- payment/event alerts and support workflows

Core only uses Cloud when the merchant has configured the Cloud integration URL/key. A missing Cloud configuration fails closed and does not change the merchant's Stripe settlement path.

## Order/UCP work

The repository already contains:

- paginated Stripe Checkout line-item normalization
- stable Checkout Session order identity
- trusted merchant product-ID correlation through Stripe Product metadata
- private Core-to-Cloud order lookup
- a fail-closed UCP `2026-04-08` order mapper
- CI that executes the production mapper and validates its result with official `ucp-schema` against the released order schema
- explicit merchant order-permalink configuration with no fake fallback URL

Public UCP `get_order` is being kept fail-closed: it must not be advertised until Cloud order lookup and a real merchant order permalink are both configured and the conditional route passes its release gates.

## Durable cart status

A Neon-backed durable cart implementation exists in PR #11, including trusted repricing, idempotency, optimistic versioning, expiration, update/cancel, and cart-to-checkout handoff. The production Neon schema is prepared, but the feature is intentionally not merged or advertised until Vercel has the database connection environment configured and the full route lifecycle is exercised against that runtime.

This is deliberate: VibeCart does not advertise a capability merely because code exists for it.

## Quick start

```bash
npm install
npm run dev
```

Without a Stripe secret, checkout runs in clearly labeled demo mode. To use live Stripe Checkout, add `STRIPE_SECRET_KEY` directly in the hosting provider's secret/environment settings. Never commit secret values or paste them into source code.

Useful endpoints:

- `/mcp` — generic MCP discovery/transport
- `/.well-known/ucp` — UCP business discovery
- `/ucp/mcp` — UCP-aware MCP transport
- `/llms.txt` — machine-readable integration notes
- `/agents.md` — agent-facing guide
- `/api/health` — boolean readiness state without secret values
- `/privacy`, `/terms`, `/support` — public policy/help surfaces

## Security model

- Merchant owns the Stripe account and receives merchant funds directly.
- Trusted prices come from server-side merchant catalog state.
- Client-supplied pricing is disabled by default and is prototype-only when explicitly enabled server-side.
- Stripe webhook signatures are verified before post-payment processing.
- Cloud integration credentials remain server-side.
- Public health/discovery endpoints expose readiness booleans/capabilities, not credential values.
- Optional UCP capabilities are advertised only when their runtime dependencies are valid.

## Protocol conformance

CI pins the released UCP `v2026-04-08` repository and uses official `ucp-schema` validation for catalog and order payloads. VibeCart does not treat a locally convenient JSON shape as protocol conformance.

## Reference implementation limits

- The current merchant catalog is still a small reference catalog rather than a complete multi-merchant catalog database.
- Inventory, tax calculation, shipping-rate calculation, returns/refunds, and full fulfillment lifecycle are not complete commerce-platform services yet.
- Durable cart code is activation-gated as described above.
- Public UCP order lookup remains activation-gated until its runtime dependencies are configured.
- Next.js App Router is the reference implementation; other frameworks should use adapters around the same Core protocol surface.

## North star

> **VibeCart: commerce infrastructure for every AI agent. Build once. Sell everywhere AI can act.**

## License

MIT-style — free to use and adapt.
