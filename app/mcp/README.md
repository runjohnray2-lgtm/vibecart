# VibeCart MCP endpoint

`/mcp` is the agent-facing interface for VibeCart.

It intentionally exposes a small tool surface:

- `vibecart.list_products`
- `vibecart.get_product`
- `vibecart.get_integration_instructions`
- `vibecart.create_checkout`

The endpoint supports the current stateless MCP protocol (`2026-07-28`) and the prior initialize-based protocol (`2025-11-25`) for compatibility.

## Safety defaults

- Prices come from the trusted server-side catalog.
- Checkout creation does not itself charge a customer; the customer must complete Stripe Checkout.
- Quantities are limited to whole numbers from 1 to 99.
- Browser origins are validated.
- Requests are rate-limited per warm server instance.
- Stripe secrets remain server-side.

The public discovery manifest is at `/.well-known/vibecart.json` and the broader AI integration guide remains at `/llms.txt`.
