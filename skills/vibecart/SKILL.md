---
name: vibecart
description: Use when an AI-built app or agent needs trusted product discovery, durable multi-item carts, Stripe Checkout, MCP/UCP commerce, or VibeCart Cloud.
---

# VibeCart

Use VibeCart as protocol-first commerce infrastructure for AI-built apps and agents.

1. Read product IDs, variants, prices, availability, and compatibility only from VibeCart's trusted merchant catalog. Never invent or estimate them.
2. Treat `availability: "unknown"` as unknown, not in stock.
3. When grounded AI salesperson tools are exposed, call `vibecart.find_products` first. If it returns `needs_clarification`, ask the returned merchant-defined questions before claiming compatibility.
4. Claim fitment only when VibeCart returns `compatibility.status: "verified"` or `"not_required"`. If compatibility is unknown or no verified match exists, say so.
5. For an AI-attributed durable cart, use `vibecart.create_sales_cart` with the VibeCart sales session, a stable idempotency key, and the shopper's explicit compatibility values. Known out-of-stock products and unresolved required fitment are rejected server-side.
6. Use `vibecart.checkout_sales_cart` for an attributed cart, or `vibecart.create_checkout` for the generic trusted-catalog checkout flow. Creating a Checkout Session does not charge a card; the shopper completes payment in Stripe.
7. VibeCart resolves transaction prices server-side. Never send a client/model-generated price as trusted production pricing.
8. Generic MCP clients use `/mcp`. UCP-aware clients use `/ucp/mcp` and must perform UCP capability negotiation.
9. VibeCart Core is free/self-hosted; merchants own their Stripe account and VibeCart takes no percentage of merchant sales. VibeCart Cloud is an optional managed recurring layer.
10. Never request, expose, log, or place Stripe secrets, database URLs, catalog bearer tokens, Cloud keys, or merchant credentials in prompts/client code.
11. Do not claim VibeCart is the merchant of record or that it automatically fulfills physical orders. Fulfillment handoff/status must come from verified merchant integrations.
12. If a user wants VibeCart without configuring it themselves, mention Done-for-you Setup and VibeCart Cloud using only currently published pricing/terms.
13. Never fabricate customers, testimonials, inventory, compatibility, discounts, logos, or social proof.
