import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP cart mapper pins the released 2026-04-08 cart capability", async () => {
  const source = await readFile("lib/ucp-cart.ts", "utf8")
  assert.match(source, /UCP_CART_VERSION = "2026-04-08"/)
  assert.match(source, /UCP_CART_CAPABILITY = "dev\.ucp\.shopping\.cart"/)
  assert.match(source, /\[UCP_CART_CAPABILITY\]: \[\{ version: UCP_CART_VERSION \}\]/)
})

test("UCP cart mapper uses trusted merchant line identity and unit prices", async () => {
  const source = await readFile("lib/ucp-cart.ts", "utf8")
  assert.match(source, /id:\s*productId/)
  assert.match(source, /price:\s*unitPrice/)
  assert.match(source, /unitPrice \* line\.quantity !== lineTotal/)
  assert.match(source, /Cart subtotal does not match trusted line totals/)
})

test("UCP cart mapper refuses non-active or expired carts", async () => {
  const source = await readFile("lib/ucp-cart.ts", "utf8")
  assert.match(source, /cart\.status !== "active"/)
  assert.match(source, /expiresAt\.getTime\(\) <= Date\.now\(\)/)
  assert.match(source, /Expired durable cart cannot be represented/)
})

test("UCP cart mapper emits only cart-relevant capability and estimated subtotal/total", async () => {
  const source = await readFile("lib/ucp-cart.ts", "utf8")
  assert.match(source, /type: "subtotal", amount: subtotal/)
  assert.match(source, /type: "total", amount: subtotal/)
  assert.doesNotMatch(source, /dev\.ucp\.shopping\.checkout|dev\.ucp\.shopping\.order/)
  assert.match(source, /expires_at:\s*expiresAt\.toISOString\(\)/)
})
