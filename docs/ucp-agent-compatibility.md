# UCP agent compatibility

VibeCart exposes one provider-neutral commerce surface: `/.well-known/ucp` for discovery and `/ucp/mcp` for UCP catalog MCP calls. Provider packages must remain thin adapters; pricing, catalog, checkout, and order logic stay in VibeCart Core.

## Remote MCP is not automatically UCP

OpenAI, Anthropic, Google, IDE agents, and other clients can connect when they support a compatible remote MCP transport. UCP adds another requirement: every catalog tool call must include `meta["ucp-agent"].profile`, a public HTTPS UCP platform profile used for version and capability negotiation. A generic MCP client therefore needs an adapter, agent instruction, or native client behavior that supplies this metadata.

Official client references:
- OpenAI remote MCP: https://platform.openai.com/docs/api-reference/responses
- Anthropic MCP: https://docs.anthropic.com/en/docs/mcp
- Gemini remote MCP: https://ai.google.dev/gemini-api/docs/function-calling

## Current UCP contract

VibeCart targets UCP `2026-04-08` and currently advertises only:
- `dev.ucp.shopping.catalog.search`
- `dev.ucp.shopping.catalog.lookup`

Lookup exposes both `lookup_catalog` and `get_product`. Cart, checkout, order, and payment capabilities are not advertised until their own conformance work is complete.

Official UCP references:
- https://ucp.dev/2026-04-08/specification/overview/
- https://ucp.dev/2026-04-08/specification/catalog/mcp/

## Fixture rule

The provider-neutral JSON fixtures under `tests/fixtures/ucp/` preserve the contract every adapter must use: JSON-RPC 2.0 `tools/call`, the published catalog tool names, a public HTTPS `meta["ucp-agent"].profile`, UCP catalog arguments, and the same `/ucp/mcp` endpoint regardless of provider.
