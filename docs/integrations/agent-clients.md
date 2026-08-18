# VibeCart agent-client distribution

VibeCart uses one commerce backend for every agent ecosystem. Provider integrations are connection recipes only; they do not contain pricing, checkout, payment, cart, or order-state logic.

## Endpoints

- Generic MCP clients: `https://vibecart.vercel.app/mcp`
- UCP-aware platforms: `https://vibecart.vercel.app/ucp/mcp`

Do not point an ordinary MCP client at `/ucp/mcp`. UCP tool calls require `meta.ucp-agent.profile` and capability negotiation. A client that merely supports MCP is not automatically a UCP platform.

The canonical machine-readable examples live in [`integrations/mcp-clients.json`](../../integrations/mcp-clients.json).

## OpenAI Responses API

Use VibeCart as a remote MCP tool:

```json
{
  "type": "mcp",
  "server_label": "vibecart",
  "server_url": "https://vibecart.vercel.app/mcp",
  "require_approval": "always"
}
```

Keep approval enabled while VibeCart exposes commerce actions. OpenAI's remote MCP tool supports `server_url` and an approval policy.

Official reference: https://platform.openai.com/docs/api-reference/responses

## Codex

Add `https://vibecart.vercel.app/mcp` as a remote MCP server named `vibecart` in Codex. Keep tool approval enabled for commerce actions. VibeCart does not require a Codex-specific commerce adapter.

Official reference: https://developers.openai.com/codex/

## ChatGPT

On a ChatGPT plan/workspace that currently supports custom remote MCP apps, register the VibeCart remote MCP endpoint:

`https://vibecart.vercel.app/mcp`

ChatGPT product availability and setup UI can change independently of the VibeCart protocol, so this repository intentionally does not hard-code plan eligibility or a UI-specific click path.

Official reference: https://developers.openai.com/

## Claude Code

```bash
claude mcp add --transport http vibecart https://vibecart.vercel.app/mcp
```

Equivalent project configuration:

```json
{
  "mcpServers": {
    "vibecart": {
      "type": "http",
      "url": "https://vibecart.vercel.app/mcp"
    }
  }
}
```

Official reference: https://docs.anthropic.com/en/docs/claude-code/mcp

## Gemini Interactions API

Gemini's Remote MCP tool uses Streamable HTTP. Use a hyphen-free server name:

```json
{
  "type": "mcp_server",
  "name": "vibecart",
  "url": "https://vibecart.vercel.app/mcp"
}
```

Official reference: https://ai.google.dev/gemini-api/docs/function-calling

## Visual Studio Code

Workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "vibecart": {
      "type": "http",
      "url": "https://vibecart.vercel.app/mcp"
    }
  }
}
```

Official reference: https://code.visualstudio.com/docs/agent-customization/mcp-servers

## Cursor

Add a remote MCP server named `vibecart` in Cursor's MCP settings and use:

`https://vibecart.vercel.app/mcp`

Cursor supports remote Streamable HTTP MCP servers. The repository intentionally avoids freezing a UI-specific setup flow into the canonical machine fixture.

Official reference: https://docs.cursor.com/context/model-context-protocol

## Security and compatibility rules

1. Provider configs point to `/mcp`, not `/ucp/mcp`, unless the platform is explicitly UCP-aware.
2. No provider fixture contains a Stripe key, database URL, Cloud integration key, merchant secret, product price, or duplicated checkout/order logic.
3. Keep approval/permission prompts enabled for state-changing commerce tools unless a merchant has deliberately established a stricter trusted policy.
4. VibeCart's server remains the source of truth for catalog pricing and commerce state.
5. Provider-specific compatibility work should change only connection/configuration surfaces. Business logic belongs in the shared VibeCart Core/Cloud layers.
