import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("UCP discovery advertises order only behind the shared runtime readiness gate", async () => {
  const source = await readFile("app/.well-known/ucp/route.ts", "utf8")
  assert.match(source, /ucpOrderRuntimeConfigured/)
  assert.match(source, /const orderEnabled = ucpOrderRuntimeConfigured\(\)/)
  assert.match(source, /\.\.\.\(orderEnabled \? \{/)
  assert.match(source, /dev\.ucp\.shopping\.order/)
  assert.match(source, /schemas\/shopping\/order\.json/)
})

test("UCP tools list exposes get_order only when the same readiness gate is true", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /function activeTools\(\)/)
  assert.match(source, /ucpOrderRuntimeConfigured\(\) \? \[\.\.\.catalogTools, orderTool\] : catalogTools/)
  assert.match(source, /name: "get_order"/)
  assert.match(source, /required: \["meta", "id"\]/)
  assert.match(source, /message\.method === "tools\/list".*activeTools\(\)/s)
})

test("get_order negotiates the released order capability before touching private order state", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /ORDER_CAPABILITY = "dev\.ucp\.shopping\.order"/)
  assert.match(source, /name === "get_order" && orderEnabled/)
  assert.match(source, /negotiated = await negotiateCapability\(args, capability\)/)
  assert.match(source, /if \(name === "get_order"\)/)
  assert.match(source, /getUcpOrder\(args\.id\)/)
})

test("get_order uses released structured not-found and unauthorized outcomes", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.match(source, /orderError\("not_found", "Order not found\.", "unrecoverable"\)/)
  assert.match(source, /orderError\("unauthorized", "Not authorized to access this order\.", "unrecoverable"\)/)
  assert.match(source, /orderError\("service_unavailable"/)
  assert.match(source, /result\.retryable \? "recoverable" : "unrecoverable"/)
})

test("catalog parsing happens only after the get_order branch", async () => {
  const source = await readFile("app/ucp/mcp/route.ts", "utf8")
  const orderBranch = source.indexOf('if (name === "get_order")')
  const catalogRead = source.indexOf("const catalog = args.catalog")
  assert.ok(orderBranch >= 0)
  assert.ok(catalogRead > orderBranch)
})

test("public UCP routes never expose Cloud keys or raw environment values", async () => {
  const discovery = await readFile("app/.well-known/ucp/route.ts", "utf8")
  const mcp = await readFile("app/ucp/mcp/route.ts", "utf8")
  assert.doesNotMatch(discovery, /VIBECART_CLOUD_INGEST_KEY|DATABASE_URL|POSTGRES_URL/)
  assert.doesNotMatch(mcp, /VIBECART_CLOUD_INGEST_KEY|DATABASE_URL|POSTGRES_URL/)
})
