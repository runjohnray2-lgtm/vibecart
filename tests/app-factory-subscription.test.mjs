import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const checkout = fs.readFileSync("app/api/apps/subscribe/route.ts", "utf8")
const webhook = fs.readFileSync("app/api/webhook/stripe/route.ts", "utf8")
const billing = fs.readFileSync("lib/app-factory-billing.ts", "utf8")

test("App Factory checkout stamps account metadata onto Stripe subscription", () => {
  assert.match(checkout, /mode:\s*"subscription"/)
  assert.match(checkout, /vibecart_product:\s*"app-factory-all-access"/)
  assert.match(checkout, /vibecart_account_key:\s*accountKey/)
  assert.match(checkout, /subscription_data:\s*\{\s*metadata\s*\}/)
})

test("verified Stripe webhook handles subscription lifecycle events", () => {
  assert.match(webhook, /stripe\.webhooks\.constructEvent/)
  assert.match(webhook, /customer\.subscription\.created/)
  assert.match(webhook, /customer\.subscription\.updated/)
  assert.match(webhook, /customer\.subscription\.deleted/)
  assert.match(webhook, /vibecart_product\s*!==\s*"app-factory-all-access"/)
  assert.match(webhook, /setAllAppsAccess\(accountKey, accessStatus/)
})

test("subscription status mapping grants active access, pauses non-good-standing access, and removes canceled access", () => {
  assert.match(billing, /status === "active" \|\| status === "trialing"\) return "active"/)
  assert.match(billing, /status === "canceled" \|\| status === "incomplete_expired"\) return "expired"/)
  assert.match(billing, /return "paused"/)
  assert.match(webhook, /customer\.subscription\.deleted"\s*\?\s*"expired"/)
})

test("entitlement write remains idempotent by account and all-apps key", () => {
  assert.match(billing, /VALUES \(\$\{key\}, 'all-apps'/)
  assert.match(billing, /ON CONFLICT \(account_key, app_key\)/)
  assert.match(billing, /DO UPDATE SET status = EXCLUDED\.status/)
})
