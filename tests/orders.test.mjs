import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("paid Checkout orders page through every Stripe line item", async () => {
  const source = await readFile("lib/orders.ts", "utf8")
  assert.match(source, /listLineItems\(checkoutSessionId/)
  assert.match(source, /limit:\s*100/)
  assert.match(source, /expand:\s*\["data\.price\.product"\]/)
  assert.match(source, /page\.has_more/)
  assert.match(source, /starting_after/)
  assert.match(source, /amountSubtotal/)
  assert.match(source, /amountDiscount/)
  assert.match(source, /amountTax/)
  assert.match(source, /amountTotal/)
})

test("Checkout carries VibeCart cart identity into Stripe", async () => {
  const source = await readFile("app/api/checkout/route.ts", "utf8")
  assert.match(source, /cartId\?: string/)
  assert.match(source, /client_reference_id:\s*cartId/)
  assert.match(source, /vibecart_cart_id:\s*cartId/)
})

test("trusted catalog product identity survives Stripe Checkout", async () => {
  const checkout = await readFile("app/api/checkout/route.ts", "utf8")
  const orders = await readFile("lib/orders.ts", "utf8")
  assert.match(checkout, /vibecart_product_id:\s*r\.product\.id/)
  assert.match(checkout, /vibecart_catalog_source:\s*"trusted"/)
  assert.match(checkout, /vibecart_catalog_source:\s*"inline_untrusted"/)
  assert.match(orders, /product\.metadata\?\.vibecart_catalog_source === "trusted"/)
  assert.match(orders, /product\.metadata\.vibecart_product_id/)
  assert.match(orders, /return product\.id/)
})

test("verified payment events forward normalized orders to durable Cloud ingest", async () => {
  const cloud = await readFile("lib/cloud-events.ts", "utf8")
  const webhook = await readFile("app/api/webhook/stripe/route.ts", "utf8")
  assert.match(cloud, /buildNormalizedOrder\(stripe, session\)/)
  assert.match(cloud, /order,/)
  assert.match(cloud, /reason:\s*"order_normalization"/)
  assert.match(webhook, /checkout\.session\.async_payment_succeeded/)
  assert.match(webhook, /forwardVerifiedCheckoutEvent\(event, session, stripe\)/)
  assert.match(webhook, /status:\s*503/)
})
