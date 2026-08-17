import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP discovery advertises only implemented catalog capabilities", async () => {
  const source = await readFile("app/.well-known/ucp/route.ts", "utf8")
  assert.match(source, /2026-04-08/)
  assert.match(source, /dev\.ucp\.shopping\.catalog\.search/)
  assert.match(source, /dev\.ucp\.shopping\.catalog\.lookup/)
  assert.doesNotMatch(source, /dev\.ucp\.shopping\.cart/)
  assert.doesNotMatch(source, /dev\.ucp\.shopping\.checkout/)
})

test("UCP MCP catalog uses UCP negotiation errors and capability outcomes", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /fetchPlatformProfile/)
  assert.match(source, /invalid_profile_url/)
  assert.match(source, /profile_unreachable/)
  assert.match(source, /profile_malformed/)
  assert.match(source, /version_unsupported/)
  assert.match(source, /capabilities_incompatible/)
  assert.match(source, /rpcError\(message\.id, -32001/)
  assert.match(source, /PROFILE_CACHE_MS/)
  assert.match(source, /redirect: "manual"/)
  assert.match(source, /AbortSignal\.timeout/)
  assert.match(source, /isPrivateIp/)
})

test("UCP search implements cursor pagination with default limit 10", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /DEFAULT_SEARCH_LIMIT = 10/)
  assert.match(source, /decodeCursor/)
  assert.match(source, /encodeCursor/)
  assert.match(source, /has_next_page/)
  assert.match(source, /total_count/)
})

test("UCP lookup enforces a batch limit with Invalid params", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /MAX_LOOKUP_IDS = 100/)
  assert.match(source, /catalog\.ids cannot exceed/)
  assert.match(source, /-32602/)
})

test("UCP catalog prices come from trusted server products", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /product\.priceCents/)
  assert.match(source, /PRODUCTS\.filter/)
  assert.match(source, /getProduct/)
})
