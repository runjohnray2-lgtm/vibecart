import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { NextResponse } from "next/server"
import { PRODUCTS, VibeProduct, getProduct } from "@/lib/products"

export const runtime = "nodejs"

const UCP_VERSION = "2026-04-08"
const SEARCH_CAPABILITY = "dev.ucp.shopping.catalog.search"
const LOOKUP_CAPABILITY = "dev.ucp.shopping.catalog.lookup"
const PROFILE_CACHE_MS = 5 * 60 * 1000
const PROFILE_MAX_BYTES = 256 * 1024

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

interface PlatformProfile {
  ucp: {
    version: string
    capabilities: Record<string, unknown>
  }
}

type CachedProfile = { expiresAt: number; profile: PlatformProfile }
const profileCache = new Map<string, CachedProfile>()

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

function agentProfileUrl(args: Record<string, unknown>) {
  const meta = args.meta
  if (!meta || typeof meta !== "object") return null
  const agent = (meta as Record<string, unknown>)["ucp-agent"]
  if (!agent || typeof agent !== "object") return null
  const profile = (agent as Record<string, unknown>).profile
  return typeof profile === "string" ? profile : null
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function isPrivateIp(address: string) {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) {
    const normalized = address.toLowerCase()
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
  }
  return true
}

async function validateProfileUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("invalid_platform_profile")
  }

  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("invalid_platform_profile")
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("invalid_platform_profile")

  if (isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error("invalid_platform_profile")
  } else {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some(entry => isPrivateIp(entry.address))) throw new Error("invalid_platform_profile")
  }
  return url
}

function asPlatformProfile(value: unknown): PlatformProfile {
  if (!value || typeof value !== "object") throw new Error("invalid_platform_profile")
  const ucpValue = (value as Record<string, unknown>).ucp
  if (!ucpValue || typeof ucpValue !== "object") throw new Error("invalid_platform_profile")
  const ucpObject = ucpValue as Record<string, unknown>
  if (typeof ucpObject.version !== "string" || !ucpObject.capabilities || typeof ucpObject.capabilities !== "object") {
    throw new Error("invalid_platform_profile")
  }
  return { ucp: { version: ucpObject.version, capabilities: ucpObject.capabilities as Record<string, unknown> } }
}

async function fetchPlatformProfile(profileUrl: string) {
  const cached = profileCache.get(profileUrl)
  if (cached && cached.expiresAt > Date.now()) return cached.profile

  const url = await validateProfileUrl(profileUrl)
  const response = await fetch(url, {
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok || response.status >= 300 && response.status < 400) throw new Error("invalid_platform_profile")

  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  if (declaredLength > PROFILE_MAX_BYTES) throw new Error("invalid_platform_profile")
  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > PROFILE_MAX_BYTES) throw new Error("invalid_platform_profile")

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("invalid_platform_profile")
  }
  const profile = asPlatformProfile(parsed)
  profileCache.set(profileUrl, { profile, expiresAt: Date.now() + PROFILE_CACHE_MS })
  return profile
}

function capabilityEntryIsValid(capability: string, value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.some(entry => {
    if (!entry || typeof entry !== "object") return false
    const record = entry as Record<string, unknown>
    if (record.version !== UCP_VERSION || typeof record.spec !== "string" || typeof record.schema !== "string") return false
    try {
      const spec = new URL(record.spec)
      const schema = new URL(record.schema)
      if (capability.startsWith("dev.ucp.") && (spec.hostname !== "ucp.dev" || schema.hostname !== "ucp.dev")) return false
      return spec.protocol === "https:" && schema.protocol === "https:"
    } catch {
      return false
    }
  })
}

async function negotiateCapability(args: Record<string, unknown>, capability: string) {
  const profileUrl = agentProfileUrl(args)
  if (!profileUrl) throw new Error("meta.ucp-agent.profile is required")
  const profile = await fetchPlatformProfile(profileUrl)
  if (profile.ucp.version !== UCP_VERSION) throw new Error("version_unsupported")
  if (!capabilityEntryIsValid(capability, profile.ucp.capabilities[capability])) throw new Error("capability_not_negotiated")
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
      serverInfo: { name: "vibecart-ucp", version: "0.2.0" },
      instructions: "UCP 2026-04-08 catalog transport. Catalog operations validate meta.ucp-agent.profile and negotiate capabilities.",
    })
  }

  if (message.method === "notifications/initialized") return new NextResponse(null, { status: 204 })
  if (message.method === "ping") return rpc(message.id, {})
  if (message.method === "tools/list") return rpc(message.id, { tools })
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Method not found")

  const name = message.params?.name
  const args = message.params?.arguments ?? {}
  const capability = name === "search_catalog" ? SEARCH_CAPABILITY : (name === "lookup_catalog" || name === "get_product") ? LOOKUP_CAPABILITY : null
  if (!capability) return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`)

  try {
    await negotiateCapability(args, capability)
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "invalid_platform_profile"
    return rpcError(message.id, -32602, messageText)
  }

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

  const id = typeof input.id === "string" ? input.id : ""
  const product = id ? getProduct(id) : undefined
  if (!product) {
    return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY, "error"), messages: [{ type: "error", code: "not_found", content: id || "missing id" }] }))
  }
  return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY), product: asUcpProduct(product) }))
}
