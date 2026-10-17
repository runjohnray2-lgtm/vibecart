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

test("AI sales cart never accepts caller-controlled transaction pricing", async () => {
  const source = await readFile("app/mcp/route.ts", "utf8")
  const start = source.indexOf('name: "vibecart.create_sales_cart"')
  const end = source.indexOf('name: "vibecart.checkout_sales_cart"', start)
  assert.ok(start >= 0 && end > start)
  const schema = source.slice(start, end)

  assert.match(schema, /items/)
  assert.match(schema, /productId/)
  assert.match(schema, /quantity/)
  assert.doesNotMatch(schema, /priceCents|unitPrice|amountTotal|discount/)
  assert.match(source, /createAttributedSalesCart/)
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
