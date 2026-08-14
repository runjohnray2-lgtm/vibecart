import { NextResponse } from "next/server"
import { PRODUCTS, getProduct } from "@/lib/products"
import { POST as checkoutPost } from "@/app/api/checkout/route"

export const runtime = "nodejs"

const SERVER_NAME = "vibecart"
const SERVER_VERSION = "0.2.0"
const MODERN_PROTOCOL = "2026-07-28"
const LEGACY_PROTOCOL = "2025-11-25"
const MAX_REQUESTS_PER_MINUTE = 60

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

const rateBuckets = new Map<string, RateBucket>()

const tools = [
  {
    name: "vibecart.list_products",
    title: "List VibeCart Products",
    description: "List the products registered in VibeCart's trusted server-side catalog. Use this before creating checkout when you do not already know a product ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "vibecart.get_product",
    title: "Get VibeCart Product",
    description: "Get one trusted server-side product by ID, including its price in cents.",
    inputSchema: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "The VibeCart product ID returned by vibecart.list_products.",
        },
      },
      required: ["productId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "vibecart.get_integration_instructions",
    title: "Get VibeCart Integration Instructions",
    description: "Return the minimal Next.js App Router integration instructions for adding a VibeCart checkout button to an AI-built site.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "vibecart.create_checkout",
    title: "Create VibeCart Checkout",
    description: "Create a Stripe Checkout session for one trusted VibeCart catalog product. This creates a checkout URL; it does not charge the customer until they complete Stripe Checkout.",
    inputSchema: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "The trusted VibeCart catalog product ID to purchase.",
        },
        quantity: {
          type: "integer",
          minimum: 1,
          maximum: 99,
          default: 1,
          description: "Whole-number quantity from 1 to 99.",
        },
      },
      required: ["productId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
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
        "Use a productId registered in lib/products.ts for trusted checkout.",
        "Never expose STRIPE_SECRET_KEY in client code.",
        "Use trustClientPrice only for prototypes where tamperable browser pricing is acceptable.",
      ],
      machineReadableSpec: "/llms.txt",
    }
    return completeToolResult(integration)
  }

  if (name === "vibecart.create_checkout") {
    const productId = getStringArg(args, "productId")
    if (!productId) return toolError("productId is required", "INVALID_ARGUMENT")

    const product = getProduct(productId)
    if (!product) {
      return toolError(
        `Unknown productId \"${productId}\". Call vibecart.list_products and retry with a returned ID.`,
        "UNKNOWN_PRODUCT"
      )
    }

    const rawQuantity = args.quantity ?? 1
    if (typeof rawQuantity !== "number" || !Number.isSafeInteger(rawQuantity) || rawQuantity < 1 || rawQuantity > 99) {
      return toolError("quantity must be a whole number from 1 to 99", "INVALID_QUANTITY")
    }

    const origin = new URL(req.url).origin
    const checkoutRequest = new Request(`${origin}/api/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        items: [{ productId, quantity: rawQuantity }],
      }),
    })

    const checkoutResponse = await checkoutPost(checkoutRequest)
    const checkoutData = await checkoutResponse.json() as Record<string, unknown>

    if (!checkoutResponse.ok || checkoutData.success !== true) {
      const code = typeof checkoutData.code === "string" ? checkoutData.code : "CHECKOUT_FAILED"
      const message = typeof checkoutData.error === "string" ? checkoutData.error : "Stripe Checkout creation failed"
      return toolError(message, code, checkoutData)
    }

    return completeToolResult(
      {
        ...checkoutData,
        productId,
        quantity: rawQuantity,
      },
      checkoutData.mode === "demo"
        ? String(checkoutData.message ?? "VibeCart is running in demo mode.")
        : `Checkout created for ${product.name}. Open ${String(checkoutData.checkoutUrl)} to complete payment.`
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
    protocols: [MODERN_PROTOCOL, LEGACY_PROTOCOL],
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

  if (message.method === "notifications/initialized") {
    return new NextResponse(null, { status: 204 })
  }

  if (message.method === "server/discover") {
    return rpcResult(message.id, {
      resultType: "complete",
      supportedVersions: [MODERN_PROTOCOL, LEGACY_PROTOCOL],
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions: "VibeCart is a minimal commerce layer for AI-built websites. Discover trusted products, inspect a product, get integration instructions, and create a Stripe Checkout session. Prefer trusted product IDs over client-supplied prices.",
    })
  }

  if (message.method === "initialize") {
    const requested = typeof message.params?.protocolVersion === "string"
      ? message.params.protocolVersion
      : LEGACY_PROTOCOL
    const protocolVersion = requested === LEGACY_PROTOCOL ? LEGACY_PROTOCOL : LEGACY_PROTOCOL

    return rpcResult(message.id, {
      protocolVersion,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions: "VibeCart exposes a deliberately small commerce toolset optimized for AI coding agents.",
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
