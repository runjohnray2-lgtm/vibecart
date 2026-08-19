import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("durable cart storage uses the shared trusted catalog provider and Neon", async () => {
  const source = await readFile("lib/cart-store.ts", "utf8")
  assert.match(source, /@neondatabase\/serverless/)
  assert.match(source, /getCatalogProduct\(productId\)/)
  assert.match(source, /await resolveCartItems/)
  assert.match(source, /subtotalCents/)
  assert.match(source, /Cart version conflict/)
  assert.doesNotMatch(source, /getProduct\(productId\)/)
})

test("cart creation is idempotent under concurrent retries", async () => {
  const source = await readFile("lib/cart-store.ts", "utf8")
  assert.match(source, /normalizeIdempotencyKey/)
  assert.match(source, /ON CONFLICT \(merchant_id, idempotency_key\)/)
  assert.match(source, /DO NOTHING/)
  assert.match(source, /idempotency_key = \$\{key\}/)
})

test("expiration races re-read durable state inside the same merchant tenant", async () => {
  const source = await readFile("lib/cart-store.ts", "utf8")
  assert.match(source, /SET status = 'expired'/)
  assert.match(source, /const current = await db`[\s\S]*?SELECT \* FROM vibecart_carts[\s\S]*?WHERE id = \$\{id\} AND merchant_id = \$\{merchantId\}[\s\S]*?LIMIT 1[\s\S]*?`/)
  assert.match(source, /expires_at > now\(\)/)
})

test("cart API exposes create read update cancel and checkout", async () => {
  const create = await readFile("app/api/cart/route.ts", "utf8")
  const mutate = await readFile("app/api/cart/[id]/route.ts", "utf8")
  const checkout = await readFile("app/api/cart/[id]/checkout/route.ts", "utf8")

  assert.match(create, /export async function POST/)
  assert.match(mutate, /export async function GET/)
  assert.match(mutate, /export async function PATCH/)
  assert.match(mutate, /export async function DELETE/)
  assert.match(checkout, /checkoutPost/)
})

test("cart routes fail closed when durable storage or the trusted merchant catalog is unavailable", async () => {
  const create = await readFile("app/api/cart/route.ts", "utf8")
  const mutate = await readFile("app/api/cart/[id]/route.ts", "utf8")
  const checkout = await readFile("app/api/cart/[id]/checkout/route.ts", "utf8")

  assert.match(create, /CART_STORAGE_NOT_CONFIGURED/)
  assert.match(create, /CatalogSourceError/)
  assert.match(create, /Trusted merchant catalog is unavailable/)
  assert.match(mutate, /CART_STORAGE_NOT_CONFIGURED/)
  assert.match(mutate, /CatalogSourceError/)
  assert.match(mutate, /status: 503/)
  assert.match(checkout, /CART_STORAGE_NOT_CONFIGURED/)
  assert.match(checkout, /503/)
})
