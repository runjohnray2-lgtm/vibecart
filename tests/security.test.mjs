import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("checkout disables client supplied pricing unless the server opts in", async () => {
  const source = await readFile("app/api/checkout/route.ts", "utf8")
  assert.match(source, /VIBECART_ALLOW_UNTRUSTED_PRICING/)
  assert.match(source, /UNTRUSTED_PRICING_DISABLED/)
})

test("checkout has a request throttle and redacts internal failures", async () => {
  const source = await readFile("app/api/checkout/route.ts", "utf8")
  assert.match(source, /MAX_CHECKOUT_REQUESTS_PER_MINUTE/)
  assert.match(source, /RATE_LIMITED/)
  assert.match(source, /Check server logs for details/)
  assert.doesNotMatch(source, /INTERNAL_ERROR[^\n]*String\(/)
})

test("Stripe webhook does not return signature exception details", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  assert.match(source, /Signature verification failed\./)
  assert.doesNotMatch(source, /Signature verification failed:.*String\(/)
})
