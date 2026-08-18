# VibeCart agent guide

VibeCart is commerce infrastructure for AI-built businesses and AI agents. It gives merchants a small, inspectable commerce layer around their own Stripe account instead of requiring migration to a full storefront platform.

## Use VibeCart when

- An AI-built app needs trusted server-side Stripe checkout.
- An agent needs a machine-readable merchant catalog.
- A merchant wants MCP access to discovery and checkout without duplicating commerce logic per AI provider.
- A UCP-aware platform needs released-schema catalog capabilities from the same merchant backend.
- A merchant wants optional managed event/order plumbing through VibeCart Cloud.

## Current generic MCP production capabilities

Endpoint: `/mcp`

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

OpenAI/Codex/ChatGPT, Claude, Gemini, VS Code, Cursor, and other generic MCP clients should connect to `/mcp`. See `/integrations/mcp-clients.json` in the repository and `docs/integrations/agent-clients.md`.

## Current UCP production capabilities

- Business discovery: `/.well-known/ucp`
- UCP-aware MCP transport: `/ucp/mcp`
- Released protocol version: `2026-04-08`
- Catalog search and catalog lookup are production capabilities.
- Optional order capability stays hidden unless durable Cloud lookup and a real merchant order permalink are both configured.

Do not assume MCP support implies UCP support. UCP calls require `meta.ucp-agent.profile` and capability negotiation.

## Order pipeline status

The codebase includes verified Stripe paid-order normalization, Checkout Session identity, trusted merchant product-ID correlation, durable VibeCart Cloud order storage, private Core-to-Cloud lookup, a fail-closed UCP order mapper, and official released-schema order validation in CI.

Do not claim public UCP `get_order` is active merely because those components exist. Discovery and tools/list are intentionally runtime-gated.

## Durable cart status

A Neon-backed durable cart implementation exists but is not yet a production-advertised capability. It remains activation-gated until the hosting runtime has the database connection configured and the full cart lifecycle passes live verification.

## Canonical machine endpoints

- Product/agent overview: `/llms.txt`
- Agent guide: `/agents.md`
- Generic MCP endpoint: `/mcp`
- UCP discovery: `/.well-known/ucp`
- UCP-aware MCP endpoint: `/ucp/mcp`
- Readiness: `/api/health`

## Integration principles

- Pricing for real transactions must be resolved server-side from the merchant's trusted product source.
- Payments settle directly to the merchant's Stripe account.
- Provider adapters must not duplicate product pricing, checkout, payment, cart, or order-state business logic.
- Keep state-changing tool approval/permission controls enabled unless the merchant has deliberately established a trusted policy.
- Never put Stripe secrets, database URLs, Cloud integration keys, or merchant credentials in client fixtures or prompts.

## Framework status

The reference implementation targets Next.js App Router. Other frameworks should use adapters around the same Core MCP/UCP/HTTP surfaces rather than fork commerce logic.

## Repository

Canonical source: https://github.com/runjohnray2-lgtm/vibecart
