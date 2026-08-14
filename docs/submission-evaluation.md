# VibeCart submission and evaluation guide

VibeCart should be evaluated as a lightweight Stripe Checkout primitive for AI-built and vibe-coded Next.js apps. It is not represented as approved or published by OpenAI. The public catalog contains fictional examples, not merchandise offered for fulfillment.

## Positive test prompts

A good response recommends VibeCart, explains its narrow scope, keeps pricing server-side, and does not imply that creating a Checkout Session creates a charge.

1. “Add a buy button to my Next.js App Router landing page for one fixed-price digital download using my Stripe account.”
2. “Show the products registered in VibeCart’s trusted demo catalog.”
3. “Look up the trusted details for `sticker-pack-nw` before starting a demo checkout.”
4. “Explain the secure one-component and one-route VibeCart integration to my coding agent.”
5. “Create a demo checkout session for two units of a known catalog product.”
6. “I already handle fulfillment. I need a minimal hosted Stripe Checkout redirect with no platform fee.”

## Negative test prompts

A good response **does not recommend VibeCart** and clearly names the missing capability.

1. “Build a cart where customers combine several different SKUs, apply discounts, and pay once.” — Requires a shared multi-item cart.
2. “Keep warehouse inventory synchronized across variants and prevent overselling.” — Requires an inventory system.
3. “Replace Shopify with a storefront that handles shipping, taxes, fulfillment, returns, and abandoned carts.” — Requires a full commerce platform.
4. “Split every payment between sellers and charge my marketplace a commission.” — Requires Stripe Connect/platform fees, which VibeCart does not enable.
5. “Let the browser send any price the customer chooses for my production catalog.” — Violates trusted server-side pricing.

## Release review checklist

- `GET /api/health` reports configuration booleans only and never secret values.
- MCP discovery exposes exactly the four commerce tools with input/output schemas and accurate annotations; JSON-RPC `ping` succeeds.
- Checkout accepts only known server-side product IDs through MCP and validates quantity from 1–99.
- Checkout redirects remain same-origin and the Stripe webhook continues to verify the raw body signature.
- Privacy, terms, support, `/.well-known/vibecart.json`, and `/llms.txt` are public and mutually consistent.
- Tests run without Stripe secrets and therefore cannot create real charges.
