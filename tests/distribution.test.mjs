import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const GENERIC_ENDPOINT = "https://vibecart.vercel.app/mcp"
const UCP_ENDPOINT = "https://vibecart.vercel.app/ucp/mcp"

async function fixtures() {
  return JSON.parse(await readFile("integrations/mcp-clients.json", "utf8"))
}

test("distribution kit covers major independent agent ecosystems", async () => {
  const config = await fixtures()
  for (const name of ["openai_responses", "codex", "chatgpt", "claude_code", "gemini_interactions", "vscode", "cursor"]) {
    assert.ok(config.clients[name], `missing ${name} fixture`)
  }
})

test("generic MCP clients share exactly one VibeCart backend", async () => {
  const config = await fixtures()
  assert.equal(config.genericMcpEndpoint, GENERIC_ENDPOINT)
  const serializedClients = JSON.stringify(config.clients)
  assert.ok(serializedClients.includes(GENERIC_ENDPOINT))
  assert.ok(!serializedClients.includes(UCP_ENDPOINT), "generic client fixtures must not point at the UCP-negotiated endpoint")
})

test("UCP endpoint remains separate and requires an explicitly UCP-aware client", async () => {
  const config = await fixtures()
  assert.equal(config.ucpEndpoint, UCP_ENDPOINT)
  assert.equal(config.ucpAwareClients.endpoint, UCP_ENDPOINT)
  assert.match(config.ucpAwareClients.requirement, /meta\.ucp-agent\.profile/)
})

test("provider fixtures contain no commerce business logic or credentials", async () => {
  const source = await readFile("integrations/mcp-clients.json", "utf8")
  for (const forbidden of [
    "STRIPE_SECRET_KEY",
    "VIBECART_CLOUD_INGEST_KEY",
    "DATABASE_URL",
    "POSTGRES_URL",
    "priceCents",
    "unit_amount",
    "productId",
    "line_items"
  ]) {
    assert.ok(!source.includes(forbidden), `provider fixture must not contain ${forbidden}`)
  }
})

test("officially structured fixtures retain their provider transport requirements", async () => {
  const config = await fixtures()
  assert.deepEqual(config.clients.openai_responses.tool, {
    type: "mcp",
    server_label: "vibecart",
    server_url: GENERIC_ENDPOINT,
    require_approval: "always"
  })
  assert.equal(config.clients.claude_code.projectConfig.mcpServers.vibecart.type, "http")
  assert.equal(config.clients.claude_code.projectConfig.mcpServers.vibecart.url, GENERIC_ENDPOINT)
  assert.deepEqual(config.clients.gemini_interactions.tool, {
    type: "mcp_server",
    name: "vibecart",
    url: GENERIC_ENDPOINT
  })
  assert.equal(config.clients.vscode.config.servers.vibecart.type, "http")
  assert.equal(config.clients.vscode.config.servers.vibecart.url, GENERIC_ENDPOINT)
})
