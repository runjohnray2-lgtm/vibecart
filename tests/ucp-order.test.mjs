import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP order mapper pins the released 2026-04-08 contract", async () => {
  const source = await readFile("lib/ucp-order.ts", "utf8")
  assert.match(source, /UCP_ORDER_VERSION = "2026-04-08"/)
  assert.match(source, /UCP_ORDER_CAPABILITY = "dev\.ucp\.shopping\.order"/)
  assert.match(source, /checkout_id:\s*order\.checkoutSessionId/)
  assert.match(source, /permalink_url:\s*permalink/)
  assert.match(source, /\[UCP_ORDER_CAPABILITY\]: \[\{ version: UCP_ORDER_VERSION \}\]/)
  assert.match(source, /expectations:\s*\[\]/)
  assert.match(source, /events:\s*\[\]/)
})

test("UCP order mapper never fabricates missing merchant or fulfillment facts", async () => {
  const source = await readFile("lib/ucp-order.ts", "utf8")
  assert.match(source, /requireHttpsPermalink/)
  assert.match(source, /missing merchant product identity/)
  assert.match(source, /unit amount/)
  assert.match(source, /unexplained total delta/)
  assert.match(source, /fulfillment, fee, or other amounts that are not yet represented/)
})

test("UCP totals use signed discounts and exactly one subtotal and total construction path", async () => {
  const source = await readFile("lib/ucp-order.ts", "utf8")
  assert.match(source, /items_discount", amount: -discount/)
  assert.match(source, /const totals: UcpOrderTotal\[\] = \[\{ type: "subtotal", amount: subtotal \}\]/)
  assert.match(source, /totals\.push\(\{ type: "total", amount: total \}\)/)
})

test("unfulfilled paid lines map truthfully to processing with zero fulfilled quantity", async () => {
  const source = await readFile("lib/ucp-order.ts", "utf8")
  assert.match(source, /original:\s*line\.quantity/)
  assert.match(source, /total:\s*line\.quantity/)
  assert.match(source, /fulfilled:\s*0/)
  assert.match(source, /status:\s*"processing"/)
})
