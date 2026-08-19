import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile("scripts/radiantz-pilot-evidence.mjs", "utf8")

test("pilot evidence harness refuses production by default", () => {
  assert.match(source, /VIBECART_PILOT_ALLOW_PRODUCTION/)
  assert.match(source, /Refusing to run the pilot evidence harness against production/)
})

test("pilot evidence harness requires an explicit checkout opt-in", () => {
  assert.match(source, /VIBECART_PILOT_ALLOW_CHECKOUT/)
  assert.match(source, /controlled checkout handoff/)
  assert.match(source, /skipped: true/)
})

test("pilot evidence harness records catalog and cart behavior without secrets", () => {
  assert.match(source, /real catalog list/)
  assert.match(source, /cart create/)
  assert.match(source, /cart read/)
  assert.match(source, /cart update/)
  assert.match(source, /cart cancel/)
  assert.doesNotMatch(source, /VOLUSION_PRODUCTS_URL|EncryptedPassword|STRIPE_SECRET_KEY/)
})
