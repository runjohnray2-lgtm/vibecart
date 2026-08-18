import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { NextResponse } from "next/server"
import { PRODUCTS, VibeProduct, getProduct } from "@/lib/products"
import { getUcpOrder, ucpOrderRuntimeConfigured } from "@/lib/ucp-order-service"
import {
  cancelUcpCart,
  createUcpCart,
  getUcpCart,
  updateUcpCart,
  ucpCartRuntimeConfigured,
  type UcpCartServiceResult,
} from "@/lib/ucp-cart-service"
import { mapCartErrorToUcp } from "@/lib/ucp-cart"

export const runtime = "nodejs"

const UCP_VERSION = "2026-04-08"
const SEARCH_CAPABILITY = "dev.ucp.shopping.catalog.search"
const LOOKUP_CAPABILITY = "dev.ucp.shopping.catalog.lookup"
const ORDER_CAPABILITY = "dev.ucp.shopping.order"
const CART_CAPABILITY = "dev.ucp.shopping.cart"
const PROFILE_CACHE_MS = 5 * 60 * 1000
const PROFILE_MAX_BYTES = 256 * 1024
const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 50
const MAX_LOOKUP_IDS = 100

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}

interface PlatformProfile { ucp: { version: string; capabilities: Record<string, unknown> } }
type NegotiationCode = "invalid_profile_url" | "profile_unreachable" | "profile_malformed" | "version_unsupported"
type CachedProfile = { expiresAt: number; profile: PlatformProfile }
const profileCache = new Map<string, CachedProfile>()

class UcpNegotiationError extends Error {
  constructor(public readonly ucpCode: NegotiationCode, public readonly httpStatus: number) { super(ucpCode) }
}

function rpc(id: RpcRequest["id"], result: unknown) { return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }) }
function rpcError(id: RpcRequest["id"], code: number, message: string, status = 400) { return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status }) }
function ucp(capability: string, status?: "success" | "error") { return { version: UCP_VERSION, ...(status ? { status } : {}), capabilities: { [capability]: [{ name: capability, version: UCP_VERSION }] } } }
function structured(content: unknown) { return { structuredContent: content, content: [{ type: "text", text: JSON.stringify(content) }] } }
function incompatibleCapabilities(capability: string) { return structured({ ucp: { version: UCP_VERSION, status: "error", capabilities: {} }, messages: [{ type: "error", code: "capabilities_incompatible", content: `Platform profile does not negotiate ${capability} at ${UCP_VERSION}`, severity: "unrecoverable" }] }) }
function orderError(code: string, content: string, severity: "recoverable" | "unrecoverable") {
  const payload = {
    ucp: { version: UCP_VERSION, status: "error", capabilities: { [ORDER_CAPABILITY]: [{ version: UCP_VERSION }] } },
    messages: [{ type: "error", code, severity, content }],
  }
  return { structuredContent: payload, content: [{ type: "text", text: content }] }
}
function cartResult(result: UcpCartServiceResult) {
  if (result.kind === "success") return structured(result.cart)
  if (result.kind === "not_found") return structured(mapCartErrorToUcp("not_found", "Cart not found or has expired", "unrecoverable"))
  if (result.kind === "invalid") return structured(mapCartErrorToUcp("invalid_request", result.message, "unrecoverable"))
  return structured(mapCartErrorToUcp(
    "service_unavailable",
    result.retryable ? "Cart service is temporarily unavailable." : "Cart service is not configured for this merchant.",
    result.retryable ? "recoverable" : "unrecoverable",
  ))
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
    variants: [{
      id: product.id,
      sku: product.id,
      title: product.variant ?? product.name,
      description: { plain: product.description },
      price: { amount: product.priceCents, currency: "USD" },
      availability: { available: true },
      seller: { name: "VibeCart Demo Merchant" },
      inputs: [{ id: product.id }],
    }],
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

function idempotencyKey(args: Record<string, unknown>, required: boolean) {
  const meta = args.meta
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    if (required) throw new Error("meta.idempotency-key is required")
    return undefined
  }
  const value = (meta as Record<string, unknown>)["idempotency-key"]
  if (value === undefined) {
    if (required) throw new Error("meta.idempotency-key is required")
    return undefined
  }
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("meta.idempotency-key must be a UUID")
  }
  return value
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
  try { url = new URL(value) } catch { throw new UcpNegotiationError("invalid_profile_url", 400) }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new UcpNegotiationError("invalid_profile_url", 400)
  if (isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new UcpNegotiationError("invalid_profile_url", 400)
  } else {
    let addresses: { address: string; family: number }[]
    try { addresses = await lookup(url.hostname, { all: true, verbatim: true }) } catch { throw new UcpNegotiationError("invalid_profile_url", 400) }
    if (addresses.length === 0 || addresses.some(entry => isPrivateIp(entry.address))) throw new UcpNegotiationError("invalid_profile_url", 400)
  }
  return url
}

function asPlatformProfile(value: unknown): PlatformProfile {
  if (!value || typeof value !== "object") throw new UcpNegotiationError("profile_malformed", 422)
  const ucpValue = (value as Record<string, unknown>).ucp
  if (!ucpValue || typeof ucpValue !== "object") throw new UcpNegotiationError("profile_malformed", 422)
  const ucpObject = ucpValue as Record<string, unknown>
  if (typeof ucpObject.version !== "string" || !ucpObject.capabilities || typeof ucpObject.capabilities !== "object" || Array.isArray(ucpObject.capabilities)) throw new UcpNegotiationError("profile_malformed", 422)
  return { ucp: { version: ucpObject.version, capabilities: ucpObject.capabilities as Record<string, unknown> } }
}

async function fetchPlatformProfile(profileUrl: string) {
  const cached = profileCache.get(profileUrl)
  if (cached && cached.expiresAt > Date.now()) return cached.profile
  const url = await validateProfileUrl(profileUrl)
  let response: Response
  try { response = await fetch(url, { redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) }) } catch { throw new UcpNegotiationError("profile_unreachable", 424) }
  if (!response.ok || response.status >= 300 && response.status < 400) throw new UcpNegotiationError("profile_unreachable", 424)
  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  if (declaredLength > PROFILE_MAX_BYTES) throw new UcpNegotiationError("profile_malformed", 422)
  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > PROFILE_MAX_BYTES) throw new UcpNegotiationError("profile_malformed", 422)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new UcpNegotiationError("profile_malformed", 422) }
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
    } catch { return false }
  })
}

async function negotiateCapability(args: Record<string, unknown>, capability: string) {
  const profileUrl = agentProfileUrl(args)
  if (!profileUrl) throw new UcpNegotiationError("invalid_profile_url", 400)
  const profile = await fetchPlatformProfile(profileUrl)
  if (profile.ucp.version !== UCP_VERSION) throw new UcpNegotiationError("version_unsupported", 422)
  return capabilityEntryIsValid(capability, profile.ucp.capabilities[capability])
}

function decodeCursor(value: unknown) {
  if (value === undefined) return 0
  if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new Error("invalid cursor")
  try {
    const offset = Number(Buffer.from(value, "base64url").toString("utf8"))
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid cursor")
    return offset
  } catch { throw new Error("invalid cursor") }
}

function encodeCursor(offset: number) { return Buffer.from(String(offset), "utf8").toString("base64url") }

function searchPage(value: unknown) {
  if (value === undefined) return { offset: 0, limit: DEFAULT_SEARCH_LIMIT }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("catalog.pagination must be an object")
  const pagination = value as Record<string, unknown>
  let limit = DEFAULT_SEARCH_LIMIT
  if (pagination.limit !== undefined) {
    if (typeof pagination.limit !== "number" || !Number.isSafeInteger(pagination.limit) || pagination.limit < 1) throw new Error("catalog.pagination.limit must be a positive whole number")
    limit = Math.min(pagination.limit, MAX_SEARCH_LIMIT)
  }
  return { offset: decodeCursor(pagination.cursor), limit }
}

const metaSchema = {
  type: "object",
  required: ["ucp-agent"],
  properties: {
    "ucp-agent": { type: "object", required: ["profile"], properties: { profile: { type: "string", format: "uri" } }, additionalProperties: true },
    "idempotency-key": { type: "string", format: "uuid" },
  },
  additionalProperties: true,
}

const cartSchema = {
  type: "object",
  required: ["line_items"],
  properties: {
    line_items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["item", "quantity"],
        properties: {
          item: { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } }, additionalProperties: true },
          quantity: { type: "integer", minimum: 1, maximum: 99 },
        },
        additionalProperties: true,
      },
    },
    context: { type: "object" },
    buyer: { type: "object" },
  },
  additionalProperties: true,
}

const catalogTools = [
  { name: "search_catalog", description: "Search the merchant catalog using the UCP Catalog Search capability.", inputSchema: { type: "object", required: ["meta", "catalog"], properties: { meta: metaSchema, catalog: { type: "object", properties: { query: { type: "string" }, context: { type: "object" }, signals: { type: "object" }, attribution: { type: "object" }, filters: { type: "object" }, pagination: { type: "object", properties: { limit: { type: "integer", minimum: 1 }, cursor: { type: "string" } }, additionalProperties: true } }, additionalProperties: true } }, additionalProperties: false } },
  { name: "lookup_catalog", description: "Look up one or more merchant catalog products by stable identifier.", inputSchema: { type: "object", required: ["meta", "catalog"], properties: { meta: metaSchema, catalog: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: MAX_LOOKUP_IDS } }, additionalProperties: true } }, additionalProperties: false } },
  { name: "get_product", description: "Get one merchant catalog product by stable identifier.", inputSchema: { type: "object", required: ["meta", "catalog"], properties: { meta: metaSchema, catalog: { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } }, additionalProperties: true } }, additionalProperties: false } },
]

const orderTool = {
  name: "get_order",
  description: "Get the current state of a paid order using the UCP Order capability.",
  inputSchema: {
    type: "object",
    required: ["meta", "id"],
    properties: { meta: metaSchema, id: { type: "string", minLength: 1, maxLength: 200 } },
    additionalProperties: false,
  },
}

const cartTools = [
  { name: "create_cart", description: "Create a durable UCP cart using trusted merchant catalog pricing.", inputSchema: { type: "object", required: ["meta", "cart"], properties: { meta: metaSchema, cart: cartSchema }, additionalProperties: false } },
  { name: "get_cart", description: "Get the current state of a durable UCP cart.", inputSchema: { type: "object", required: ["meta", "id"], properties: { meta: metaSchema, id: { type: "string", minLength: 1, maxLength: 200 } }, additionalProperties: false } },
  { name: "update_cart", description: "Replace the contents of a durable UCP cart.", inputSchema: { type: "object", required: ["meta", "id", "cart"], properties: { meta: metaSchema, id: { type: "string", minLength: 1, maxLength: 200 }, cart: cartSchema }, additionalProperties: false } },
  { name: "cancel_cart", description: "Cancel a durable UCP cart and return its state before invalidation.", inputSchema: { type: "object", required: ["meta", "id"], properties: { meta: { ...metaSchema, required: ["ucp-agent", "idempotency-key"] }, id: { type: "string", minLength: 1, maxLength: 200 } }, additionalProperties: false } },
]

function activeTools() {
  const tools = [...catalogTools]
  if (ucpCartRuntimeConfigured()) tools.push(...cartTools)
  if (ucpOrderRuntimeConfigured()) tools.push(orderTool)
  return tools
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const tools = activeTools()
  return NextResponse.json({ name: "vibecart-ucp", version: UCP_VERSION, endpoint: `${origin}/ucp/mcp`, tools: tools.map(t => t.name) })
}

export async function POST(req: Request) {
  let message: RpcRequest
  try { message = await req.json() as RpcRequest } catch { return rpcError(null, -32700, "Parse error") }
  if (message.jsonrpc !== "2.0" || !message.method) return rpcError(message.id, -32600, "Invalid Request")
  if (message.method === "initialize") return rpc(message.id, { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "vibecart-ucp", version: "0.3.0" }, instructions: "UCP 2026-04-08 commerce transport. Catalog and cart operations validate meta.ucp-agent.profile and negotiate capabilities. Durable cart tools are exposed only when database storage is configured. Order lookup is exposed only when durable Cloud order state and a merchant permalink are configured." })
  if (message.method === "notifications/initialized") return new NextResponse(null, { status: 204 })
  if (message.method === "ping") return rpc(message.id, {})
  if (message.method === "tools/list") return rpc(message.id, { tools: activeTools() })
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Method not found")

  const name = message.params?.name
  const args = message.params?.arguments ?? {}
  const orderEnabled = ucpOrderRuntimeConfigured()
  const cartEnabled = ucpCartRuntimeConfigured()
  const capability = name === "search_catalog"
    ? SEARCH_CAPABILITY
    : (name === "lookup_catalog" || name === "get_product")
      ? LOOKUP_CAPABILITY
      : name === "get_order" && orderEnabled
        ? ORDER_CAPABILITY
        : cartEnabled && ["create_cart", "get_cart", "update_cart", "cancel_cart"].includes(String(name))
          ? CART_CAPABILITY
          : null
  if (!capability) return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`)

  let negotiated: boolean
  try { negotiated = await negotiateCapability(args, capability) } catch (error) {
    if (error instanceof UcpNegotiationError) return rpcError(message.id, -32001, error.ucpCode, error.httpStatus)
    console.error("[vibecart ucp] Unexpected profile negotiation failure", error)
    return rpcError(message.id, -32603, "Internal error", 500)
  }
  if (!negotiated) return rpc(message.id, incompatibleCapabilities(capability))

  if (name === "get_order") {
    if (typeof args.id !== "string" || args.id.trim().length === 0 || args.id.length > 200) return rpcError(message.id, -32602, "id must be a non-empty string no longer than 200 characters")
    const result = await getUcpOrder(args.id)
    if (result.kind === "success") return rpc(message.id, structured(result.order))
    if (result.kind === "not_found") return rpc(message.id, orderError("not_found", "Order not found.", "unrecoverable"))
    if (result.kind === "unauthorized") return rpc(message.id, orderError("unauthorized", "Not authorized to access this order.", "unrecoverable"))
    if (result.kind === "invalid_id") return rpcError(message.id, -32602, "id is invalid")
    return rpc(message.id, orderError("service_unavailable", result.retryable ? "Order service is temporarily unavailable." : "Order service is not configured for this merchant.", result.retryable ? "recoverable" : "unrecoverable"))
  }

  if (name === "create_cart") {
    if (!args.cart || typeof args.cart !== "object" || Array.isArray(args.cart)) return rpcError(message.id, -32602, "cart is required")
    let key: string | undefined
    try { key = idempotencyKey(args, false) } catch (error) { return rpcError(message.id, -32602, error instanceof Error ? error.message : "invalid idempotency key") }
    return rpc(message.id, cartResult(await createUcpCart(args.cart, key)))
  }

  if (name === "get_cart") {
    if (typeof args.id !== "string" || args.id.trim().length === 0 || args.id.length > 200) return rpcError(message.id, -32602, "id must be a non-empty string no longer than 200 characters")
    return rpc(message.id, cartResult(await getUcpCart(args.id)))
  }

  if (name === "update_cart") {
    if (typeof args.id !== "string" || args.id.trim().length === 0 || args.id.length > 200) return rpcError(message.id, -32602, "id must be a non-empty string no longer than 200 characters")
    if (!args.cart || typeof args.cart !== "object" || Array.isArray(args.cart)) return rpcError(message.id, -32602, "cart is required")
    if ("id" in (args.cart as Record<string, unknown>)) return rpcError(message.id, -32602, "cart.id must be omitted; use the top-level id parameter")
    return rpc(message.id, cartResult(await updateUcpCart(args.id, args.cart)))
  }

  if (name === "cancel_cart") {
    if (typeof args.id !== "string" || args.id.trim().length === 0 || args.id.length > 200) return rpcError(message.id, -32602, "id must be a non-empty string no longer than 200 characters")
    try { idempotencyKey(args, true) } catch (error) { return rpcError(message.id, -32602, error instanceof Error ? error.message : "invalid idempotency key") }
    return rpc(message.id, cartResult(await cancelUcpCart(args.id)))
  }

  const catalog = args.catalog
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return rpcError(message.id, -32602, "catalog is required")
  const input = catalog as Record<string, unknown>

  if (name === "search_catalog") {
    if (input.query !== undefined && typeof input.query !== "string") return rpcError(message.id, -32602, "catalog.query must be a string")
    let page: { offset: number; limit: number }
    try { page = searchPage(input.pagination) } catch (error) { return rpcError(message.id, -32602, error instanceof Error ? error.message : "invalid pagination") }
    const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
    const matches = PRODUCTS.filter(p => !query || `${p.name} ${p.description} ${p.variant ?? ""}`.toLowerCase().includes(query))
    const products = matches.slice(page.offset, page.offset + page.limit)
    const nextOffset = page.offset + products.length
    const hasNextPage = nextOffset < matches.length
    return rpc(message.id, structured({ ucp: ucp(SEARCH_CAPABILITY), products: products.map(asUcpProduct), pagination: { ...(hasNextPage ? { cursor: encodeCursor(nextOffset) } : {}), has_next_page: hasNextPage, total_count: matches.length } }))
  }

  if (name === "lookup_catalog") {
    if (!Array.isArray(input.ids) || input.ids.length === 0) return rpcError(message.id, -32602, "catalog.ids must contain at least one identifier")
    if (input.ids.length > MAX_LOOKUP_IDS) return rpcError(message.id, -32602, `catalog.ids cannot exceed ${MAX_LOOKUP_IDS} identifiers`)
    if (input.ids.some(id => typeof id !== "string" || id.trim().length === 0)) return rpcError(message.id, -32602, "catalog.ids must contain only non-empty strings")
    const ids = input.ids as string[]
    const found = ids.map(getProduct).filter((p): p is VibeProduct => Boolean(p))
    const missing = ids.filter(id => !getProduct(id))
    return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY), products: found.map(asUcpProduct), ...(missing.length ? { messages: missing.map(id => ({ type: "info", code: "not_found", content: id })) } : {}) }))
  }

  if (typeof input.id !== "string" || input.id.trim().length === 0) return rpcError(message.id, -32602, "catalog.id must be a non-empty string")
  const id = input.id
  const product = getProduct(id)
  if (!product) return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY, "error"), messages: [{ type: "error", code: "not_found", content: `Product not found: ${id}`, severity: "unrecoverable" }] }))
  return rpc(message.id, structured({ ucp: ucp(LOOKUP_CAPABILITY), product: asUcpProduct(product) }))
}
