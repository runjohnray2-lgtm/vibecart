import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const checkout = fs.readFileSync("app/api/apps/subscribe/route.ts", "utf8")
const webhook = fs.readFileSync("app/api/webhook/stripe/route.ts", "utf8")

test("subscription checkout derives account identity from authenticated session", () => {
  assert.match(checkout, /getAuth\(\)\.getSession\(\)/)
  assert.match(checkout, /if \(!user\?\.id \|\| !user\.email\)/)
  assert.match(checkout, /const accountKey = String\(user\.id\)/)
  assert.doesNotMatch(checkout, /req\.json\(\)/)
})

test("subscription entitlement sync occurs only after Stripe signature verification", () => {
  const verification = webhook.indexOf("stripe.webhooks.constructEvent")
  const sync = webhook.indexOf("await syncAppFactorySubscription(event)")
  assert.ok(verification >= 0, "Stripe signature verification must exist")
  assert.ok(sync > verification, "entitlement sync must happen after signature verification")
})

test("subscription sync is scoped to App Factory all-access metadata", () => {
  assert.match(webhook, /subscription\.metadata\?\.vibecart_product !== "app-factory-all-access"/)
  assert.match(webhook, /subscription\.metadata\?\.vibecart_account_key\?\.trim\(\)/)
})
