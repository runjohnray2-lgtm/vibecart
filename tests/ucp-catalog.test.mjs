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

test("UCP MCP catalog validates and negotiates agent profiles", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /meta\.ucp-agent\.profile is required/)
  assert.match(source, /fetchPlatformProfile/)
  assert.match(source, /version_unsupported/)
  assert.match(source, /capability_not_negotiated/)
  assert.match(source, /PROFILE_CACHE_MS/)
  assert.match(source, /redirect: "manual"/)
  assert.match(source, /AbortSignal\.timeout/)
  assert.match(source, /isPrivateIp/)
  assert.match(source, /search_catalog/)
  assert.match(source, /lookup_catalog/)
  assert.match(source, /get_product/)
})

test("UCP catalog prices come from trusted server products", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /product\.priceCents/)
  assert.match(source, /PRODUCTS\.filter/)
  assert.match(source, /getProduct/)
})
