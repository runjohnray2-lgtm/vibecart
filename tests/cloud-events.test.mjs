import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Stripe signatures are verified before durable Core persistence is reachable", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  const verification = source.indexOf("stripe.webhooks.constructEvent")
  const persistence = source.indexOf("persistVerifiedCheckoutEvent(event, session, stripe)")
  assert.ok(verification >= 0, "Stripe signature verification must exist")
  assert.ok(persistence > verification, "Core persistence must happen only after signature verification")
})

test("optional Cloud bridge uses stable Stripe event IDs and server-side integration key", async () => {
  const source = await readFile("lib/cloud-events.ts", "utf8")
  const outbox = await readFile("lib/cloud-outbox.ts", "utf8")
  assert.match(source, /eventId,/)
  assert.match(source, /VIBECART_CLOUD_INGEST_URL/)
  assert.match(source, /VIBECART_CLOUD_INGEST_KEY/)
  assert.match(source, /"x-vibecart-key": config\.key/)
  assert.match(outbox, /event_id/)
  assert.match(outbox, /event_type/)
})

test("Cloud failures never cause Stripe replay after Core order persistence", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  const persistenceFailure = source.indexOf("Durable order persistence temporarily unavailable.")
  const cloudAttempt = source.indexOf("attemptCloudOutboxForOrder(orderId)")
  assert.ok(persistenceFailure >= 0)
  assert.ok(cloudAttempt >= 0)
  assert.match(source, /Core order storage is authoritative/)
  assert.doesNotMatch(source, /if \(!cloud\.delivered\)[\s\S]{0,300}status:\s*503/)
})

test("delayed payment methods do not create premature durable payment events", async () => {
  const source = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  assert.match(source, /checkout\.session\.async_payment_succeeded/)
  assert.match(source, /session\.payment_status === "paid"/)
})

test("health reports durable storage and Cloud retry configuration without exposing values", async () => {
  const source = await readFile("app/api/health/route.ts", "utf8")
  assert.match(source, /durableOrderStoreConfigured/)
  assert.match(source, /cloudConfigured/)
  assert.match(source, /cloudOutboxRetryEnabled/)
  assert.doesNotMatch(source, /cloudIngestUrl\s*:/)
  assert.doesNotMatch(source, /cloudIngestKey\s*:/)
  assert.doesNotMatch(source, /cronSecret\s*:/i)
})
