import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("He Said Nothing tiers are trusted server-side products at the displayed prices", async () => {
  const products = await readFile("lib/products.ts", "utf8")
  assert.match(products, /id: "hsn-nothing-box-39"[\s\S]*?priceCents: 3900/)
  assert.match(products, /id: "hsn-nothing-box-59"[\s\S]*?priceCents: 5900/)
  assert.match(products, /id: "hsn-nothing-box-89"[\s\S]*?priceCents: 8900/)
})

test("private pilot saves quiz choices as a no-payment durable cart", async () => {
  const page = await readFile("app/he-said-nothing/page.tsx", "utf8")
  assert.match(page, /get\("pilot"\) === "cart"/)
  assert.match(page, /fetch\("\/api\/cart"/)
  assert.match(page, /he-said-nothing-web-pilot/)
  assert.match(page, /recipient_interest/)
  assert.match(page, /fulfillment_note: "PILOT TEST CART — NO PAYMENT"/)
  assert.match(page, /Create no-payment pilot cart/)
  assert.doesNotMatch(page, /fetch\("\/api\/checkout"/)
})

test("relationship choices visibly switch the storefront mode", async () => {
  const page = await readFile("app/he-said-nothing/page.tsx", "utf8")
  for (const role of ["Wife", "Girlfriend", "Daughter", "Mom", "Sister", "Other"]) {
    assert.match(page, new RegExp(`${role}:\\s*\\{[\\s\\S]*?mode:`))
  }
  assert.match(page, /Buying for your \{shopper\.toLowerCase\(\)\}/)
  assert.match(page, /<Image src=\{vibe\.image\}/)
  assert.match(page, /--hsn-accent/)
  assert.match(page, /wife-garage\.webp/)
  assert.match(page, /girlfriend-apartment\.webp/)
  assert.match(page, /daughter-backyard\.webp/)
  assert.match(page, /mom-desk\.webp/)
  assert.match(page, /sister-trail\.webp/)
  assert.match(page, /other-lounge\.webp/)
})

test("cart metadata is bounded, persisted, and returned with the cart", async () => {
  const store = await readFile("lib/cart-store.ts", "utf8")
  const route = await readFile("app/api/cart/route.ts", "utf8")
  const migration = await readFile("migrations/004_cart_metadata.sql", "utf8")

  assert.match(store, /MAX_METADATA_ENTRIES = 20/)
  assert.match(store, /MAX_METADATA_TOTAL_LENGTH = 5_000/)
  assert.match(store, /normalizeCartMetadata/)
  assert.match(store, /items, metadata, subtotal_cents/)
  assert.match(route, /body\.metadata/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL/)
  assert.match(migration, /jsonb_typeof\(metadata\) = 'object'/)
})
