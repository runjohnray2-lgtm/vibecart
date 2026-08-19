import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP discovery keeps catalog always available and gates additional shipped capabilities", async () => {
  const source = await readFile("app/.well-known/ucp/route.ts", "utf8")
  assert.match(source, /2026-04-08/)
  assert.match(source, /dev\.ucp\.shopping\.catalog\.search/)
  assert.match(source, /dev\.ucp\.shopping\.catalog\.lookup/)
  assert.match(source, /CART_CAPABILITY = "dev\.ucp\.shopping\.cart"/)
  assert.match(source, /const cartEnabled = ucpCartRuntimeConfigured\(\)/)
  assert.match(source, /\.\.\.\(cartEnabled \? \{/)
  assert.doesNotMatch(source, /dev\.ucp\.shopping\.checkout/)
  assert.doesNotMatch(source, /dev\.ucp\.shopping\.payment/)
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

test("UCP catalog prices come from the shared trusted merchant provider", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /product\.priceCents/)
  assert.match(source, /await listCatalogProducts\(\)/)
  assert.match(source, /configuredMerchantName\(\)/)
  assert.doesNotMatch(source, /PRODUCTS\.filter/)
  assert.doesNotMatch(source, /\bgetProduct\(/)
})

test("UCP catalog fails closed when the configured merchant source is unhealthy", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /CatalogSourceError/)
  assert.match(source, /catalogResultError/)
  assert.match(source, /service_unavailable/)
  assert.match(source, /Merchant catalog is temporarily unavailable/)
})
