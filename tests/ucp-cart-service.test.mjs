import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP cart service readiness depends only on durable database configuration", async () => {
  const source = await readFile("lib/ucp-cart-service.ts", "utf8")
  assert.match(source, /DATABASE_URL \?\? process\.env\.POSTGRES_URL/)
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY|VIBECART_CLOUD_INGEST_KEY/)
})

test("UCP cart requests use item IDs and quantity, never caller prices or totals", async () => {
  const source = await readFile("lib/ucp-cart-service.ts", "utf8")
  assert.match(source, /const productId = \(item as Record<string, unknown>\)\.id/)
  assert.match(source, /quantity: line\.quantity/)
  assert.doesNotMatch(source, /item\.price|line\.totals|amountTotal|priceCents/)
})

test("create and update are full replacements over the shared durable cart engine", async () => {
  const source = await readFile("lib/ucp-cart-service.ts", "utf8")
  assert.match(source, /createCart\(items, idempotencyKey\)/)
  assert.match(source, /replaceCartItems\(id, items\)/)
  assert.match(source, /mapDurableCartToUcp\(cart\)/)
})

test("cancel returns the active cart state before invalidating the durable cart", async () => {
  const source = await readFile("lib/ucp-cart-service.ts", "utf8")
  const mapIndex = source.indexOf("const responseCart = mapDurableCartToUcp(existing)")
  const cancelIndex = source.indexOf("const cancelled = await cancelCart(id)")
  assert.ok(mapIndex >= 0)
  assert.ok(cancelIndex > mapIndex)
  assert.match(source, /cancelled\.status !== "cancelled"/)
  assert.match(source, /kind: "success", cart: responseCart/)
})

test("expired, cancelled, or converted durable carts become UCP not_found", async () => {
  const source = await readFile("lib/ucp-cart-service.ts", "utf8")
  assert.match(source, /cart && cart\.status === "active" \? cart : null/)
  assert.match(source, /if \(!cart\) return \{ kind: "not_found" \}/)
})
