import { NextResponse } from "next/server"
import { PRODUCTS, VibeProduct, getProduct } from "@/lib/products"

export const runtime = "nodejs"

const UCP_VERSION = "2026-04-08"
const SEARCH_CAPABILITY = "dev.ucp.shopping.catalog.search"
const LOOKUP_CAPABILITY = "dev.ucp.shopping.catalog.lookup"

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: {
    name?: string
    arguments?: Record<string, unknown>
    protocolVersion?: string
  }
}

function rpc(id: RpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result })
}

function rpcError(id: RpcRequest["id"], code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status })
}

function ucp(capability: string, status?: "success" | "error") {
  return {
    version: UCP_VERSION,
    ...(status ? { status } : {}),
    capabilities: { [capability]: [{ version: UCP_VERSION }] },
  }
}

function asUcpProduct(product: VibeProduct) {
  return {
    id: product.id,
    handle: product.id,
    title: product.name,
    description: { plain: product.description },
    price_range: {
      min: { amount: product.priceCents, currency: "USD" },
      max: { amount: product.priceCents, currency: "USD" },
    },
    media: product.image ? [{ type: "image", url: product.image, alt_text: product.name }] : [],
    variants: [
      {
        id: product.id,
        sku: product.id,
        title: product.variant ?? product.name,
        description: { plain: product.description },
        price: { amount: product.priceCents, currency: "USD" },
        availability: { available: true },
        seller: { name: "VibeCart Demo Merchant" },
      },
    ],
  }
}

function argsHaveAgentMeta(args: Record<string, unknown>) {
  const meta = args.meta
  if (!meta || typeof meta !== "object") return false
  const agent = (meta as Record<string, unknown>)["ucp-agent"]
  if (!agent || typeof agent !== "object") return false
  const profile = (agent as Record<string, unknown>).profile
  return typeof profile === "string" && /^https:\/\//.test(profile)
}

function structured(content: unknown) {
  return { structuredContent: content, content: [{ type: "text", text: JSON.stringify(content) }] }
}

const tools = [
  {
    name: "search_catalog",
    description: "Search the merchant catalog using the UCP Catalog Search capability.",
    inputSchema: {
      type: "object",
      required: ["meta", "catalog"],
      properties: {
        meta: { type: "object" },
        catalog: { type: "object", properties: { query: { type: "string" } }, additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_catalog",
    description: "Look up one or more merchant catalog products by stable identifier.",
    inputSchema: {
      type: "object",
      required: ["meta", "catalog"],
      properties: {
        meta: { type: "object" },
        catalog: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string" }, minItems: 1 } }, additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_product",
    description: "Get one merchant catalog product by stable identifier.",
    inputSchema: {
      type: "object",
      required: ["meta", "catalog"],
      properties: {
        meta: { type: "object" },
        catalog: { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
]

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  return NextResponse.json({ name: "vibecart-ucp", version: UCP_VERSION, endpoint: `${origin}/ucp/mcp`, tools: tools.map(t => t.name) })
}

export async function POST(req: Request) {
  let message: RpcRequest
  try {
    message = await req.json() as RpcRequest
  } catch {
    return rpcError(null, -32700, "Parse error")
  }

  if (message.jsonrpc !== "2.0" || !message.method) return rpcError(message.id, -32600, "Invalid Request")

  if (message.method === "initialize") {
    return rpc(message.id, {
      protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "vibecart-ucp", version: "0.1.0" },
      instructions: "UCP 2026-04-08 catalog transport. Catalog operations require meta.ucp-agent.profile.",
    })
  }

  if (message.method === "notifications/initialized") return new NextResponse(null, { status: 204 })
  if (message.method === "ping") return rpc(message.id, {})
  if (message.method === "tools/list") return rpc(message.id, { tools })
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Method not found")

  const name = message.params?.name
  const args = message.params?.arguments ?? {}
  if (!argsHaveAgentMeta(args)) return rpcError(message.id, -32602, "meta.ucp-agent.profile is required")

  const catalog = args.catalog
  if (!catalog || typeof catalog !== "object") return rpcError(message.id, -32602, "catalog is required")
  const input = catalog as Record<string, unknown>

  if (name === "search_catalog") {
    const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
    const products = PRODUCTS.filter(p => !query || `${p.name} ${p.description} ${p.variant ?? ""}`.toLowerCase().includes(query))
    return rpc(message.id, structured({ ucp: ucp(SEARCH_CAPABILITY), products: products.map(asUcpProduct), pagination: { has_next_page: false, total_count: products.length } }))
  }

  if (name === "lookup_catalog") {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === "string") : []
    if (ids.length === 0) return rpcError(message.id, -32602, "catalog.ids must contain at least one identifier")
    const found = ids.map(getProduct).filter((p): p is VibeProduct => Boolean(p))
    const missing = ids.filter(id => !getProduct(id))
    return rpc(message.id, structured({
      ucp: ucp(LOOKUP_CAPABILITY),
      products: found.map(asUcpProduct),
      ...(missing.length ? { messages: missing.map(id => ({ type: "info", code: "not_found", content: id })) } : {}),
    }))
  }

  if (name === "get_product") {
    const id = typeof input.id === "string" ? input.id : ""
    const product = id ? getProduct(id) : undefined
    if (!product) {
      return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY, "error"), messages: [{ type: "error", code: "not_found", content: id || "missing id" }] }))
    }
    return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY), product: asUcpProduct(product) }))
  }

  return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`)
}
