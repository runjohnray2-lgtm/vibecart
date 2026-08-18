import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("merchant order permalink requires one explicit orderId token and HTTPS", async () => {
  const source = await readFile("lib/order-permalink.ts", "utf8")
  assert.match(source, /ORDER_ID_TOKEN = "\{orderId\}"/)
  assert.match(source, /template\.split\(ORDER_ID_TOKEN\)\.length !== 2/)
  assert.match(source, /url\.protocol !== "https:"/)
  assert.match(source, /url\.username \|\| url\.password \|\| url\.hash/)
})

test("order IDs are encoded before entering merchant permalink templates", async () => {
  const source = await readFile("lib/order-permalink.ts", "utf8")
  assert.match(source, /encodeURIComponent\(orderId\)/)
  assert.match(source, /orderId\.length > 200/)
})

test("health reports only permalink configuration presence, not the template", async () => {
  const health = await readFile("app/api/health/route.ts", "utf8")
  assert.match(health, /orderPermalinkConfigured:\s*orderPermalinkConfigured\(\)/)
  assert.doesNotMatch(health, /VIBECART_ORDER_PERMALINK_TEMPLATE/)
})
