import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const expectedServerName = "io.github.runjohnray2-lgtm/vibecart"
const expectedRemote = "https://vibecart.vercel.app/mcp"

test("server.json publishes VibeCart as a public Streamable HTTP remote", async () => {
  const server = JSON.parse(await readFile("server.json", "utf8"))
  assert.equal(server.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json")
  assert.equal(server.name, expectedServerName)
  assert.equal(server.title, "VibeCart")
  assert.equal(server.version, "0.3.0")
  assert.equal(server.repository?.url, "https://github.com/runjohnray2-lgtm/vibecart")
  assert.equal(server.repository?.source, "github")
  assert.equal(server.websiteUrl, "https://vibecart.vercel.app")
  assert.deepEqual(server.remotes, [{ type: "streamable-http", url: expectedRemote }])
})

test("registry metadata points generic MCP clients to /mcp, never the UCP-only transport", async () => {
  const source = await readFile("server.json", "utf8")
  assert.match(source, /https:\/\/vibecart\.vercel\.app\/mcp/)
  assert.doesNotMatch(source, /\/ucp\/mcp/)
})

test("registry version matches the public MCP server implementation version", async () => {
  const server = JSON.parse(await readFile("server.json", "utf8"))
  const route = await readFile("app/mcp/route.ts", "utf8")
  assert.match(route, new RegExp(`SERVER_VERSION = "${server.version.replaceAll(".", "\\.")}"`))
})

test("publisher workflow uses secretless GitHub OIDC and the official registry publisher", async () => {
  const workflow = await readFile(".github/workflows/publish-mcp-registry.yml", "utf8")
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /mcp-publisher login github-oidc/)
  assert.match(workflow, /mcp-publisher publish server\.json/)
  assert.doesNotMatch(workflow, /secrets\./)
})
