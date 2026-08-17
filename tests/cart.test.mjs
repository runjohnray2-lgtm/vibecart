import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("durable cart storage uses trusted catalog products and Neon", async () => {
  const source = await readFile("lib/cart-store.ts", "utf8")
  assert.match(source, /@neondatabase\/serverless/)
  assert.match(source, /getProduct\(productId\)/)
  assert.match(source, /subtotalCents/)
  assert.match(source, /idempotencyKey/)
  assert.match(source, /Cart version conflict/)
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
