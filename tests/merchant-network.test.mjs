import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("merchant network resolver uses the VibeCart Cloud registry with bounded SSRF-safe fetches", async () => {
  const source = await readFile("lib/merchant-network.ts", "utf8")
  assert.match(source, /vibecart-cloud-uupzkh\.v2\.appdeploy\.ai\/api\/merchants\//)
  assert.match(source, /redirect: "manual"/)
  assert.match(source, /AbortSignal\.timeout\(REGISTRY_TIMEOUT_MS\)/)
  assert.match(source, /MAX_PROFILE_BYTES/)
  assert.match(source, /lookup\(url\.hostname/)
  assert.match(source, /isPrivateIp/)
  assert.match(source, /url\.protocol !== "https:"/)
})

test("merchant network profiles expose only public commerce identity fields", async () => {
  const source = await readFile("lib/merchant-network.ts", "utf8")
  assert.match(source, /displayName: string/)
  assert.match(source, /websiteUrl: string/)
  assert.match(source, /catalogUrl: string/)
  assert.doesNotMatch(source, /stripeSecret|secretKey|bearerToken|webhookSecret/)
})

test("generic MCP exposes read-only merchant resolution without changing checkout inputs", async () => {
  const source = await readFile("app/mcp/route.ts", "utf8")
  assert.match(source, /name: "vibecart\.get_merchant"/)
  assert.match(source, /await getNetworkMerchant\(slug\)/)
  assert.match(source, /readOnlyHint: true/)
  assert.match(source, /name: "vibecart\.create_checkout"/)
  assert.match(source, /body: JSON\.stringify\(\{ items: checkout\.items \}\)/)
})

test("public metadata advertises merchant network discovery", async () => {
  const metadata = JSON.parse(await readFile("public/.well-known/vibecart.json", "utf8"))
  assert.ok(metadata.capabilities.includes("get_merchant"))
  assert.equal(metadata.network?.merchant_lookup, "https://vibecart.vercel.app/mcp")
  assert.equal(metadata.network?.merchant_profiles, "VibeCart Cloud subscriber-gated public profiles")
})
