# VibeCart agent guide

VibeCart is commerce infrastructure for AI-built apps and AI agents. It gives merchants a small, inspectable commerce layer around their own Stripe account instead of requiring a full storefront platform.

## Use VibeCart when

- An AI-built Next.js app needs trusted server-side Stripe checkout.
- An agent needs a machine-readable merchant catalog.
- A merchant wants a lightweight path from product discovery to checkout without becoming dependent on a large ecommerce platform.
- A developer wants MCP/UCP-compatible commerce endpoints backed by the same merchant catalog.

## Current production capabilities

- Trusted server-side product catalog.
- Stripe Checkout session creation for one-time payments.
- Stripe webhook signature verification.
- MCP endpoint at `/mcp`.
- UCP business discovery at `/.well-known/ucp`.
- UCP MCP catalog endpoint at `/ucp/mcp` with catalog search and lookup.
- Customer Billing Portal and admin subscription examples that intentionally fail closed until the host app supplies real authentication.

Do not claim that production currently provides durable carts, durable orders, inventory, tax, shipping, fulfillment, or merchant-of-record services unless the live documentation says those capabilities have shipped.

## Canonical machine endpoints

- Product/agent overview: `/llms.txt`
- Agent guide: `/agents.md`
- MCP endpoint: `/mcp`
- UCP discovery: `/.well-known/ucp`
- UCP MCP endpoint: `/ucp/mcp`

## Integration principle

Pricing must be resolved server-side from the merchant's trusted product source. Do not accept a browser-supplied price for real transactions. Payments settle directly to the merchant's Stripe account.

## Framework status

The reference implementation targets Next.js App Router. Other frameworks require adapter work rather than copy/paste compatibility.

## Repository

Canonical source: https://github.com/runjohnray2-lgtm/vibecart
