import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Stripe signatures are verified before Cloud forwarding is reachable", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  const verification = source.indexOf("stripe.webhooks.constructEvent")
  const forwarding = source.indexOf("forwardVerifiedCheckoutEvent(event, session)")
  assert.ok(verification >= 0, "Stripe signature verification must exist")
  assert.ok(forwarding > verification, "Cloud forwarding must happen only after verification")
})

test("Cloud bridge uses stable Stripe event IDs and server-side integration key", async () => {
  const source = await readFile("lib/cloud-events.ts", "utf8")
  assert.match(source, /eventId:\s*event\.id/)
  assert.match(source, /VIBECART_CLOUD_INGEST_URL/)
  assert.match(source, /VIBECART_CLOUD_INGEST_KEY/)
  assert.match(source, /"x-vibecart-key": config\.key/)
})

test("temporary Cloud delivery failures ask Stripe to retry", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  assert.match(source, /cloud\.configured && !cloud\.delivered && cloud\.retryable/)
  assert.match(source, /status:\s*503/)
})

test("delayed payment methods do not create premature durable payment events", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  assert.match(source, /checkout\.session\.async_payment_succeeded/)
  assert.match(source, /session\.payment_status === "paid"/)
})

test("health endpoint reports Cloud configuration without exposing values", async () => {
  const source = await readFile("app/api/health/route.ts", "utf8")
  assert.match(source, /cloudConfigured/)
  assert.doesNotMatch(source, /cloudIngestUrl\s*:/)
  assert.doesNotMatch(source, /cloudIngestKey\s*:/)
})
