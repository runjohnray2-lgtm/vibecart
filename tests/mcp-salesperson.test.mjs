import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("grounded salesperson tools are feature-gated and model-agnostic", async () => {
  const source = await readFile("app/mcp/route.ts", "utf8")
  const salesCart = await readFile("lib/sales-cart.ts", "utf8")

  assert.match(source, /vibecart\.find_products/)
  assert.match(source, /vibecart\.create_sales_cart/)
  assert.match(source, /vibecart\.checkout_sales_cart/)
  assert.match(source, /SALESPERSON_TOOL_NAMES/)
  assert.match(source, /aiSalespersonEnabled\(\)/)
  assert.match(salesCart, /VIBECART_AI_SALESPERSON_ENABLED/)
  assert.doesNotMatch(source, /OpenAI|Anthropic|Gemini|Claude/)
})

test("salesperson discovery uses trusted catalog and grounded compatibility output", async () => {
  const source = await readFile("app/mcp/route.ts", "utf8")
  const assistant = await readFile("lib/sales-assistant.ts", "utf8")

  assert.match(source, /const products = await listAgentVisibleProducts\(\)/)
  assert.match(source, /discoverSalesProducts\(products/)
  assert.match(assistant, /needs_clarification/)
  assert.match(assistant, /compatibility\.status/)
  assert.match(assistant, /Do not invent a product, fitment, price, discount, or availability/)
  assert.match(assistant, /merchant has not provided structured compatibility data/)
})

test("AI sales cart schema exposes only trusted IDs and quantities", async () => {
  const { default: ts } = await import("typescript")
  const code = ts.transpileModule(await readFile("app/mcp/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const testModule = { exports: {} }
  new Function("require", "exports", "module", code)(name => {
    if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } }
    if (name === "@/lib/sales-cart") return { aiSalespersonEnabled: () => true }
    if (name === "@/lib/he-said-nothing-config") return { hsnCheckoutReadiness: () => ({ enabled: false }) }
    if (["@/lib/catalog-source", "@/app/api/checkout/route", "@/app/api/cart/[id]/checkout/route", "@/lib/sales-assistant"].includes(name)) return {}
    throw new Error("Unexpected import: " + name)
  }, testModule.exports, testModule)
  const response = await testModule.exports.POST(new Request("https://offline.invalid/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))
  assert.equal(response.status, 200)
  const tool = (await response.json()).result.tools.find(tool => tool.name === "vibecart.create_sales_cart")
  assert.ok(tool)
  const schema = tool.inputSchema.properties.items.items
  assert.deepEqual(Object.keys(schema.properties).sort(), ["productId", "quantity"])
  assert.equal(schema.additionalProperties, false)
  assert.ok(schema.required.includes("productId"))
})

test("attributed cart checkout reuses the normal server-priced cart checkout path", async () => {
  const source = await readFile("app/mcp/route.ts", "utf8")
  const cart = await readFile("lib/sales-cart.ts", "utf8")
  const checkout = await readFile("app/api/cart/\[id\]/checkout/route.ts", "utf8")

  assert.match(source, /cartCheckoutPost/)
  assert.match(source, /api\/cart\/\$\{encodeURIComponent\(cartId\)\}\/checkout/)
  assert.match(cart, /createCart\(/)
  assert.match(cart, /vibecart\.sales\.source/)
  assert.match(cart, /vibecart\.sales\.session/)
  assert.match(checkout, /cart\.items\.map/)
  assert.match(checkout, /checkoutPost\(checkoutRequest\)/)
})

test("salesperson commerce writes use the existing distributed rate-limit classes", async () => {
  const middleware = await readFile("middleware.ts", "utf8")

  assert.match(middleware, /MCP_CHECKOUT_TOOLS/)
  assert.match(middleware, /vibecart\.checkout_sales_cart/)
  assert.match(middleware, /RATE_LIMIT_POLICIES\.checkout/)
  assert.match(middleware, /MCP_COMMERCE_WRITE_TOOLS/)
  assert.match(middleware, /vibecart\.create_sales_cart/)
  assert.match(middleware, /RATE_LIMIT_POLICIES\.commerceWrite/)
})

test("agent instructions explicitly forbid inventory and fitment invention", async () => {
  const llms = await readFile("public/llms.txt", "utf8")
  const skill = await readFile("skills/vibecart/SKILL.md", "utf8")

  assert.match(llms, /availability: "unknown"/)
  assert.match(llms, /Never claim fitment unless/)
  assert.match(llms, /No model may invent SKU, variant, fitment, inventory, price, or discount/)
  assert.match(skill, /Treat `availability: "unknown"` as unknown, not in stock/)
  assert.match(skill, /Claim fitment only when VibeCart returns/)
})
