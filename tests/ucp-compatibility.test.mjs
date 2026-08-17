import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const fixtureNames = ["search-request", "lookup-request", "get-product-request"]

async function fixture(name) {
  return JSON.parse(await readFile(`tests/fixtures/ucp/${name}.json`, "utf8"))
}

test("UCP platform fixture advertises the exact catalog capabilities VibeCart implements", async () => {
  const profile = await fixture("platform-profile")
  assert.equal(profile.ucp.version, "2026-04-08")
  assert.deepEqual(Object.keys(profile.ucp.capabilities).sort(), [
    "dev.ucp.shopping.catalog.lookup",
    "dev.ucp.shopping.catalog.search",
  ])
  for (const entries of Object.values(profile.ucp.capabilities)) {
    assert.ok(Array.isArray(entries) && entries.length > 0)
    for (const entry of entries) {
      assert.equal(entry.version, "2026-04-08")
      assert.equal(new URL(entry.spec).hostname, "ucp.dev")
      assert.equal(new URL(entry.schema).hostname, "ucp.dev")
    }
  }
})

test("provider-neutral request fixtures use JSON-RPC tools/call and public UCP profile metadata", async () => {
  for (const name of fixtureNames) {
    const request = await fixture(name)
    assert.equal(request.jsonrpc, "2.0")
    assert.equal(request.method, "tools/call")
    const profile = request.params?.arguments?.meta?.["ucp-agent"]?.profile
    const profileUrl = new URL(profile)
    assert.equal(profileUrl.protocol, "https:")
    assert.ok(request.params.arguments.catalog && typeof request.params.arguments.catalog === "object")
  }
})

test("fixtures cover every UCP catalog MCP tool advertised by the implementation", async () => {
  const names = []
  for (const fixtureName of fixtureNames) names.push((await fixture(fixtureName)).params.name)
  assert.deepEqual(names.sort(), ["get_product", "lookup_catalog", "search_catalog"])

  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  for (const name of names) assert.match(source, new RegExp(`name: \\"${name}\\"`))
})

test("compatibility guide keeps one backend and does not claim remote MCP equals native UCP", async () => {
  const guide = await readFile("docs/ucp-agent-compatibility.md", "utf8")
  assert.match(guide, /provider-neutral/i)
  assert.match(guide, /Remote MCP is not automatically UCP/i)
  assert.match(guide, /\/ucp\/mcp/)
  assert.match(guide, /OpenAI/)
  assert.match(guide, /Anthropic/)
  assert.match(guide, /Gemini/)
})
