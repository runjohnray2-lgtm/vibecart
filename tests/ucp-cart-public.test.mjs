import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const routePath = "app/ucp/mcp/route.ts"
const discoveryPath = "app/.well-known/ucp/route.ts"

test("UCP cart discovery and tool listing share the same durable runtime gate", async () => {
  const [route, discovery] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile(discoveryPath, "utf8"),
  ])

  assert.match(route, /ucpCartRuntimeConfigured\(\)/)
  assert.match(discovery, /ucpCartRuntimeConfigured\(\)/)
  assert.match(route, /tools\.push\(\.\.\.cartTools\)/)
  assert.match(discovery, /cartEnabled \? \{/)
  assert.match(route, /CART_CAPABILITY = "dev\.ucp\.shopping\.cart"/)
  assert.match(discovery, /CART_CAPABILITY = "dev\.ucp\.shopping\.cart"/)
})

test("UCP cart exposes the released MCP tool names without duplicating cart storage", async () => {
  const route = await readFile(routePath, "utf8")
  for (const name of ["create_cart", "get_cart", "update_cart", "cancel_cart"]) {
    assert.match(route, new RegExp(`name: "${name}"`))
  }
  assert.match(route, /createUcpCart/)
  assert.match(route, /getUcpCart/)
  assert.match(route, /updateUcpCart/)
  assert.match(route, /cancelUcpCart/)
  assert.doesNotMatch(route, /neon\(|vibecart_carts/)
})

test("cancel_cart requires the released UCP idempotency key", async () => {
  const route = await readFile(routePath, "utf8")
  assert.match(route, /required: \["ucp-agent", "idempotency-key"\]/)
  assert.match(route, /idempotencyKey\(args, true\)/)
  assert.match(route, /meta\.idempotency-key must be a UUID/)
})

test("update_cart keeps resource identity top-level", async () => {
  const route = await readFile(routePath, "utf8")
  assert.match(route, /cart\.id must be omitted; use the top-level id parameter/)
  assert.match(route, /required: \["meta", "id", "cart"\]/)
})

test("cart business failures use released UCP error responses instead of ad-hoc RPC bodies", async () => {
  const route = await readFile(routePath, "utf8")
  const mapper = await readFile("lib/ucp-cart.ts", "utf8")
  assert.match(route, /mapCartErrorToUcp\("not_found"/)
  assert.match(route, /mapCartErrorToUcp\("invalid_request"/)
  assert.match(route, /mapCartErrorToUcp\(/)
  assert.match(mapper, /status: "error"/)
  assert.match(mapper, /severity: "recoverable" \| "unrecoverable"/)
})
