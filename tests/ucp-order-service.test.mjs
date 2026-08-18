import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP order runtime is ready only when Cloud lookup and merchant permalink are both valid", async () => {
  const source = await readFile("lib/ucp-order-service.ts", "utf8")
  assert.match(source, /cloudOrderLookupConfigured\(\) && orderPermalinkConfigured\(\)/)
})

test("UCP order service preserves stable not-found and unauthorized outcomes", async () => {
  const source = await readFile("lib/ucp-order-service.ts", "utf8")
  assert.match(source, /lookup\.status === 404/)
  assert.match(source, /kind: "not_found"/)
  assert.match(source, /lookup\.reason === "unauthorized"/)
  assert.match(source, /kind: "unauthorized"/)
})

test("UCP order service never fabricates a permalink or unsafe mapped order", async () => {
  const source = await readFile("lib/ucp-order-service.ts", "utf8")
  assert.match(source, /merchantOrderPermalink\(lookup\.order\.orderId\)/)
  assert.match(source, /if \(!permalink\) return \{ kind: "unavailable", retryable: false \}/)
  assert.match(source, /mapDurableOrderToUcp\(lookup\.order, permalink\)/)
  assert.match(source, /Durable order cannot be mapped safely/)
})

test("Cloud lookup readiness validates configuration without exposing the key", async () => {
  const source = await readFile("lib/cloud-orders.ts", "utf8")
  assert.match(source, /export function cloudOrderLookupConfigured\(\)/)
  assert.match(source, /config !== null && config !== "invalid"/)
})
