import { NextResponse } from "next/server"
import { PRODUCTS, getProduct, type VibeProduct } from "@/lib/products"
import { POST as checkoutPost } from "@/app/api/checkout/route"

export const runtime = "nodejs"

const SERVER_NAME = "vibecart"
const SERVER_VERSION = "0.3.0"
const MODERN_PROTOCOL = "2026-07-28"
const LEGACY_PROTOCOL = "2025-11-25"
const MCP_STANDARD_PROTOCOL = "2025-06-18"
const MAX_REQUESTS_PER_MINUTE = 60
const MAX_CHECKOUT_LINE_ITEMS = 50
const MAX_QUANTITY = 99

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

interface RateBucket {
  count: number
  resetAt: number
}

interface CheckoutItem {
  productId: string
  quantity: number
}

const rateBuckets = new Map<string, RateBucket>()

const productSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable server-side catalog identifier." },
    name: { type: "string" },
    description: { type: "string" },
    priceCents: { type: "integer", minimum: 0, description: "Trusted unit price in USD cents." },
    image: { type: "string" },
    variant: { type: "string" },
  },
  required: ["id", "name", "description", "priceCents", "image"],
  additionalProperties: false,
} as const

const checkoutItemSchema = {
  type: "object",
  properties: {
    productId: { type: "string", minLength: 1, description: "A trusted server-side catalog product ID." },
    quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY, default: 1, description: "Whole-number quantity from 1 through 99." },
  },
  required: ["productId"],
  additionalProperties: false,
} as const

const errorProperties = {
  success: { type: "boolean", const: false },
  code: { type: "string" },
  error: { type: "string" },
} as const

const tools = [
  {
    name: "vibecart.list_products",
    title: "List trusted catalog products",
    description: "Lists fictional demonstration products registered in VibeCart's trusted server-side catalog. Use the returned stable IDs for product lookup or checkout.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean", const: true },
        products: { type: "array", items: productSchema },
      },
      required: ["success", "products"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "vibecart.get_product",
    title: "Get one trusted catalog product",
    description: "Looks up one product and its trusted USD-cent price from the server-side catalog. Does not access Stripe or create a checkout.",
    inputSchema: {
      type: "object",
      properties: { productId: { type: "string", minLength: 1, description: "A stable ID returned by vibecart.list_products." } },
      required: ["productId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        product: productSchema,
        code: errorProperties.code,
        error: errorProperties.error,
      },
      required: ["success"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "vibecart.get_integration_instructions",
    title: "Get secure integration instructions",
    description: "Returns concise Next.js App Router guidance for installing VibeCart with trusted catalog pricing, multi-item checkout, and the shared MCP endpoint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean", const: true }, framework: { type: "string" }, component: { type: "string" },
        checkoutRoute: { type: "string" }, mcpEndpoint: { type: "string" }, rules: { type: "array", items: { type: "string" } },
        machineReadableSpec: { type: "string" },
      },
      required: ["success", "framework", "component", "checkoutRoute", "mcpEndpoint", "rules", "machineReadableSpec"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "vibecart.create_checkout",
    title: "Create a hosted Stripe Checkout session",
    description: "Creates a hosted checkout URL for one or more trusted server-catalog products. Legacy productId + quantity input remains supported; new integrations should use items[]. VibeCart resolves all prices server-side. This can contact Stripe but never charges by itself; the customer must complete Stripe Checkout.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", minLength: 1, description: "Legacy single-product input. Use either productId or items, not both." },
        quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY, default: 1, description: "Legacy single-product quantity." },
        items: { type: "array", minItems: 1, maxItems: MAX_CHECKOUT_LINE_ITEMS, items: checkoutItemSchema, description: "Trusted product IDs and quantities for a multi-item checkout." },
      },
      oneOf: [
        { required: ["productId"] },
        { required: ["items"] },
      ],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        mode: { type: "string", enum: ["demo", "live"] },
        checkoutUrl: { type: ["string", "null"] },
        message: { type: "string" },
        totalCents: { type: "integer" },
        untrustedPricing: { type: "boolean" },
        items: { type: "array", items: checkoutItemSchema },
        productId: { type: "string" },
        quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY },
        code: errorProperties.code,
        error: errorProperties.error,
        details: { type: "object" },
      },
      required: ["success"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
] as const

function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return true

  try {
    const requestOrigin = new URL(req.url).origin
    const normalized = new URL(origin).origin
    if (normalized === requestOrigin) return true

    const configured = process.env.VIBECART_MCP_ALLOWED_ORIGINS
    const allowed = (configured ?? "https://chatgpt.com,https://chat.openai.com,https://claude.ai,https://gemini.google.com")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)

    return allowed.includes(normalized)
  } catch {
    return false
  }
}

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "unknown"
}

function isRateLimited(req: Request): boolean {
  const now = Date.now()
  const key = clientKey(req)
  const current = rateBuckets.get(key)

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 })
    return false
  }

  current.count += 1
  return current.count > MAX_REQUESTS_PER_MINUTE
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    }
  )
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 400, data?: unknown) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    }
  )
}

function completeToolResult(structuredContent: unknown, text?: string, isError = false) {
  const serialized = text ?? JSON.stringify(structuredContent)
  return {
    resultType: "complete",
    content: [{ type: "text", text: serialized }],
    structuredContent,
    isError,
  }
}

function toolError(message: string, code: string, details?: unknown) {
  return completeToolResult(
    {
      success: false,
      code,
      error: message,
      ...(details === undefined ? {} : { details }),
    },
    `${code}: ${message}`,
    true
  )
}

function getStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function normalizeQuantity(value: unknown, location: string) {
  const quantity = value ?? 1
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new Error(`${location} must be a whole number from 1 to ${MAX_QUANTITY}`)
  }
  return quantity
}

function normalizeCheckoutItems(args: Record<string, unknown>): { items: CheckoutItem[]; products: VibeProduct[]; legacy: boolean } {
  const hasLegacy = args.productId !== undefined || args.quantity !== undefined
  const hasItems = args.items !== undefined
  if (hasLegacy && hasItems) throw new Error("Use either productId + quantity or items, not both")

  const rawItems: CheckoutItem[] = []
  let legacy = false

  if (hasItems) {
    if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > MAX_CHECKOUT_LINE_ITEMS) {
      throw new Error(`items must contain 1 to ${MAX_CHECKOUT_LINE_ITEMS} line items`)
    }
    for (let index = 0; index < args.items.length; index += 1) {
      const raw = args.items[index]
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`items[${index}] must be an object`)
      const line = raw as Record<string, unknown>
      const productId = getStringArg(line, "productId")
      if (!productId) throw new Error(`items[${index}].productId is required`)
      rawItems.push({ productId, quantity: normalizeQuantity(line.quantity, `items[${index}].quantity`) })
    }
  } else {
    legacy = true
    const productId = getStringArg(args, "productId")
    if (!productId) throw new Error("productId is required")
    rawItems.push({ productId, quantity: normalizeQuantity(args.quantity, "quantity") })
  }

  const combined = new Map<string, number>()
  for (const line of rawItems) {
    const next = (combined.get(line.productId) ?? 0) + line.quantity
    if (next > MAX_QUANTITY) throw new Error(`Combined quantity for ${line.productId} exceeds ${MAX_QUANTITY}`)
    combined.set(line.productId, next)
  }

  const items = [...combined.entries()].map(([productId, quantity]) => ({ productId, quantity }))
  const products = items.map(line => {
    const product = getProduct(line.productId)
    if (!product) throw new Error(`Unknown productId \"${line.productId}\". Call vibecart.list_products and retry with a returned ID.`)
    return product
  })

  return { items, products, legacy }
}

async function callTool(req: Request, name: string, args: Record<string, unknown>) {
  if (name === "vibecart.list_products") {
    return completeToolResult(
      {
        success: true,
        products: PRODUCTS,
      },
      JSON.stringify({ products: PRODUCTS })
    )
  }

  if (name === "vibecart.get_product") {
    const productId = getStringArg(args, "productId")
    if (!productId) return toolError("productId is required", "INVALID_ARGUMENT")

    const product = getProduct(productId)
    if (!product) {
      return toolError(
        `Unknown productId \"${productId}\". Call vibecart.list_products and retry with a returned ID.`,
        "UNKNOWN_PRODUCT"
      )
    }

    return completeToolResult({ success: true, product })
  }

  if (name === "vibecart.get_integration_instructions") {
    const integration = {
      success: true,
      framework: "nextjs-app-router",
      component: "<VibeCartButton product={product} />",
      checkoutRoute: "/api/checkout",
      mcpEndpoint: "/mcp",
      rules: [
        "Keep prices server-side for production stores.",
        "Use product IDs registered in the merchant catalog for trusted checkout.",
        "vibecart.create_checkout accepts legacy productId + quantity or a multi-item items[] list.",
        "Never expose STRIPE_SECRET_KEY in client code.",
        "Never send prices through the generic MCP checkout tool; VibeCart resolves trusted prices server-side.",
      ],
      machineReadableSpec: "/llms.txt",
    }
    return completeToolResult(integration)
  }

  if (name === "vibecart.create_checkout") {
    let checkout: { items: CheckoutItem[]; products: VibeProduct[]; legacy: boolean }
    try {
      checkout = normalizeCheckoutItems(args)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid checkout items"
      return toolError(message, message.startsWith("Unknown productId") ? "UNKNOWN_PRODUCT" : "INVALID_ARGUMENT")
    }

    const origin = new URL(req.url).origin
    const checkoutRequest = new Request(`${origin}/api/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({ items: checkout.items }),
    })

    const checkoutResponse = await checkoutPost(checkoutRequest)
    const checkoutData = await checkoutResponse.json() as Record<string, unknown>

    if (!checkoutResponse.ok || checkoutData.success !== true) {
      const code = typeof checkoutData.code === "string" ? checkoutData.code : "CHECKOUT_FAILED"
      const message = typeof checkoutData.error === "string" ? checkoutData.error : "Stripe Checkout creation failed"
      return toolError(message, code, checkoutData)
    }

    const legacyFields = checkout.legacy
      ? { productId: checkout.items[0].productId, quantity: checkout.items[0].quantity }
      : {}
    const itemCount = checkout.items.reduce((sum, line) => sum + line.quantity, 0)
    const productNames = checkout.products.map(product => product.name).join(", ")

    return completeToolResult(
      {
        ...checkoutData,
        items: checkout.items,
        ...legacyFields,
      },
      checkoutData.mode === "demo"
        ? String(checkoutData.message ?? "VibeCart is running in demo mode.")
        : `Checkout created for ${itemCount} item${itemCount === 1 ? "" : "s"} (${productNames}). Open ${String(checkoutData.checkoutUrl)} to complete payment.`
    )
  }

  return null
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  return NextResponse.json({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    endpoint: `${origin}/mcp`,
    protocols: [MODERN_PROTOCOL, LEGACY_PROTOCOL, MCP_STANDARD_PROTOCOL],
    tools: tools.map(tool => tool.name),
    spec: `${origin}/llms.txt`,
  })
}

export async function OPTIONS(req: Request) {
  if (!allowedOrigin(req)) {
    return new NextResponse(null, { status: 403 })
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": req.headers.get("origin") ?? "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,mcp-protocol-version,mcp-method,mcp-name",
      "access-control-max-age": "86400",
    },
  })
}

export async function POST(req: Request) {
  if (!allowedOrigin(req)) {
    return rpcError(null, -32000, "Origin not allowed", 403)
  }

  if (isRateLimited(req)) {
    return rpcError(null, -32000, "Rate limit exceeded. Retry in one minute.", 429)
  }

  let message: JsonRpcRequest
  try {
    message = await req.json() as JsonRpcRequest
  } catch {
    return rpcError(null, -32700, "Parse error", 400)
  }

  if (message.jsonrpc !== "2.0" || !message.method) {
    return rpcError(message.id, -32600, "Invalid Request", 400)
  }

  if (message.method === "ping") {
    return rpcResult(message.id, {})
  }

  if (message.method === "notifications/initialized") {
    return new NextResponse(null, { status: 204 })
  }

  if (message.method === "server/discover") {
    return rpcResult(message.id, {
      resultType: "complete",
      supportedVersions: [MODERN_PROTOCOL, LEGACY_PROTOCOL, MCP_STANDARD_PROTOCOL],
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions: "VibeCart is agent-friendly commerce infrastructure with a trusted catalog and hosted multi-item checkout on the generic MCP surface. Durable cart and released UCP commerce capabilities are available through VibeCart's dedicated UCP transport. Always use trusted product IDs; merchants own their Stripe account and fulfillment workflow.",
    })
  }

  if (message.method === "initialize") {
    const requested = typeof message.params?.protocolVersion === "string"
      ? message.params.protocolVersion
      : LEGACY_PROTOCOL
    const supported = [MODERN_PROTOCOL, LEGACY_PROTOCOL, MCP_STANDARD_PROTOCOL]
    const protocolVersion = supported.includes(requested) ? requested : MCP_STANDARD_PROTOCOL

    return rpcResult(message.id, {
      protocolVersion,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions: "VibeCart exposes a compact trusted-catalog and multi-item checkout toolset for generic MCP clients; UCP-aware clients use /ucp/mcp for durable cart/order protocol capabilities.",
    })
  }

  if (message.method === "tools/list") {
    return rpcResult(message.id, {
      resultType: "complete",
      tools,
      ttlMs: 300_000,
      cacheScope: "public",
    })
  }

  if (message.method === "tools/call") {
    const name = typeof message.params?.name === "string" ? message.params.name : null
    if (!name) return rpcError(message.id, -32602, "tools/call requires params.name", 400)

    const rawArgs = message.params?.arguments
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? rawArgs as Record<string, unknown>
      : {}

    const result = await callTool(req, name, args)
    if (!result) {
      return rpcError(message.id, -32602, `Unknown tool: ${name}`, 400)
    }

    return rpcResult(message.id, result)
  }

  return rpcError(message.id, -32601, `Method not found: ${message.method}`, 404)
}
