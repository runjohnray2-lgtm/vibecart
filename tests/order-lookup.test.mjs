import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Core reuses the existing Cloud ingest URL and key for order lookup", async () => {
  const source = await readFile("lib/cloud-orders.ts", "utf8")
  assert.match(source, /VIBECART_CLOUD_INGEST_URL/)
  assert.match(source, /VIBECART_CLOUD_INGEST_KEY/)
  assert.match(source, /replace\(\/\\\/$\/, ""\)\/order|\/order/)
  assert.match(source, /"x-vibecart-key": config\.key/)
})

test("Core order lookup fails closed and never follows redirects", async () => {
  const source = await readFile("lib/cloud-orders.ts", "utf8")
  assert.match(source, /CLOUD_ORDER_TIMEOUT_MS = 5_000/)
  assert.match(source, /redirect: "error"/)
  assert.match(source, /response\.status === 404/)
  assert.match(source, /response\.status === 401 \|\| response\.status === 403/)
  assert.match(source, /response\.status === 429 \|\| response\.status >= 500/)
  assert.match(source, /reason: timedOut \? "timeout" : "network"/)
})

test("Core validates Cloud order identity before returning it", async () => {
  const source = await readFile("lib/cloud-orders.ts", "utf8")
  assert.match(source, /order\.checkoutSessionId === expectedCheckoutSessionId/)
  assert.match(source, /Array\.isArray\(order\.lines\)/)
  assert.match(source, /reason: "invalid_response"/)
})
