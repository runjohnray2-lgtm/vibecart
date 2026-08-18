import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const routePath = "app/mcp/route.ts"

test("generic MCP checkout keeps legacy input while adding items[]", async () => {
  const source = await readFile(routePath, "utf8")
  assert.match(source, /name: "vibecart\.create_checkout"/)
  assert.match(source, /productId: \{ type: "string"/)
  assert.match(source, /items: \{ type: "array", minItems: 1, maxItems: MAX_CHECKOUT_LINE_ITEMS/)
  assert.match(source, /oneOf: \[/)
  assert.match(source, /\{ required: \["productId"\] \}/)
  assert.match(source, /\{ required: \["items"\] \}/)
})

test("generic MCP multi-item checkout never accepts caller pricing", async () => {
  const source = await readFile(routePath, "utf8")
  const normalizeStart = source.indexOf("function normalizeCheckoutItems")
  const normalizeEnd = source.indexOf("async function callTool", normalizeStart)
  const normalize = source.slice(normalizeStart, normalizeEnd)
  assert.ok(normalizeStart >= 0)
  assert.match(normalize, /getProduct\(line\.productId\)/)
  assert.doesNotMatch(normalize, /priceCents|unitPrice|amount|price:/)
  assert.doesNotMatch(source, /allowInlineProduct|trustClientPrice|allowUntrustedPricing/)
})

test("generic MCP combines duplicate product IDs and caps aggregate quantity", async () => {
  const source = await readFile(routePath, "utf8")
  assert.match(source, /const combined = new Map<string, number>\(\)/)
  assert.match(source, /Combined quantity for \$\{line\.productId\} exceeds \$\{MAX_QUANTITY\}/)
  assert.match(source, /MAX_QUANTITY = 99/)
})

test("generic MCP forwards only normalized IDs and quantities to the trusted checkout route", async () => {
  const source = await readFile(routePath, "utf8")
  assert.match(source, /body: JSON\.stringify\(\{ items: checkout\.items \}\)/)
  assert.match(source, /const checkoutResponse = await checkoutPost\(checkoutRequest\)/)
})

test("legacy single-product callers keep productId and quantity in successful output", async () => {
  const source = await readFile(routePath, "utf8")
  assert.match(source, /const legacyFields = checkout\.legacy/)
  assert.match(source, /productId: checkout\.items\[0\]\.productId/)
  assert.match(source, /quantity: checkout\.items\[0\]\.quantity/)
})

test("generic MCP positioning no longer claims VibeCart is not a cart platform", async () => {
  const source = await readFile(routePath, "utf8")
  assert.doesNotMatch(source, /not a cart or inventory platform/)
  assert.match(source, /agent-friendly commerce infrastructure/)
  assert.match(source, /multi-item checkout/)
})
