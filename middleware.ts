import { NextRequest, NextResponse } from "next/server"
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
  type RateLimitResult,
} from "@/lib/distributed-rate-limit"

const MIN_MERCHANT_KEY_LENGTH = 24
const HOSTED_MERCHANT_POST_PATHS = new Set([
  "/mcp",
  "/ucp/mcp",
  "/api/checkout",
  "/api/cart",
])

const UCP_MUTATING_TOOLS = new Set([
  "create_cart",
  "update_cart",
  "cancel_cart",
])

interface RpcEnvelope {
  id?: string | number | null
  method?: string
  params?: { name?: string }
}

const HSN_APEX_HOST = "hesaidnothing.com"
const HSN_WWW_HOST = "www.hesaidnothing.com"

function hostname(req: NextRequest): string {
  return (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase()
}

function brandedSiteRouting(req: NextRequest): NextResponse | null {
  const host = hostname(req)
  if (host !== HSN_APEX_HOST && host !== HSN_WWW_HOST) return null

  if (host === HSN_WWW_HOST) {
    const canonical = req.nextUrl.clone()
    canonical.protocol = "https:"
    canonical.host = HSN_APEX_HOST
    return NextResponse.redirect(canonical, 308)
  }

  const path = req.nextUrl.pathname
  if (path === "/") {
    const destination = req.nextUrl.clone()
    destination.pathname = "/he-said-nothing"
    return NextResponse.rewrite(destination)
  }
  if (path === "/he-said-nothing") {
    const canonical = req.nextUrl.clone()
    canonical.pathname = "/"
    return NextResponse.redirect(canonical, 308)
  }
  if (path === "/robots.txt" || path === "/sitemap.xml") {
    const destination = req.nextUrl.clone()
    destination.pathname = `/he-said-nothing${path}`
    return NextResponse.rewrite(destination)
  }
  return null
}

function hostedModeEnabled() {
  return process.env.VIBECART_HOSTED_MODE?.trim().toLowerCase() === "true"
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
}

async function secureEqual(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)])
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

function jsonError(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status })
}

function hostedMerchantAuthFailure(req: NextRequest): NextResponse | null | Promise<NextResponse | null> {
  if (!hostedModeEnabled() || req.method !== "POST" || !HOSTED_MERCHANT_POST_PATHS.has(req.nextUrl.pathname)) {
    return null
  }

  const merchantId = process.env.VIBECART_MERCHANT_ID?.trim()
  const expectedKey = process.env.VIBECART_MERCHANT_API_KEY?.trim()
  if (!merchantId || merchantId === "default" || !expectedKey || expectedKey.length < MIN_MERCHANT_KEY_LENGTH) {
    return jsonError(503, "MERCHANT_AUTH_NOT_CONFIGURED", "Hosted merchant authentication is not configured.")
  }

  const presented = req.headers.get("x-vibecart-merchant-key")?.trim()
  return secureEqual(presented ?? "", expectedKey).then(valid => valid
    ? null
    : jsonError(401, "UNAUTHORIZED", "Merchant authentication is required."))
}

async function rpcEnvelope(req: NextRequest): Promise<RpcEnvelope | null> {
  try {
    const value = await req.clone().json()
    return value && typeof value === "object" && !Array.isArray(value) ? value as RpcEnvelope : null
  } catch {
    return null
  }
}

async function classifyRateLimit(req: NextRequest): Promise<{ policy: RateLimitPolicy; rpcId?: RpcEnvelope["id"] } | null> {
  const path = req.nextUrl.pathname

  if (path === "/api/he-said-nothing/admin/login" && req.method === "POST") {
    return { policy: RATE_LIMIT_POLICIES.commerceWrite }
  }

  if (path === "/api/checkout" && req.method === "POST") {
    return { policy: RATE_LIMIT_POLICIES.checkout }
  }

  if (path === "/api/cart" && req.method === "POST") {
    return { policy: RATE_LIMIT_POLICIES.commerceWrite }
  }

  if (path.startsWith("/api/cart/")) {
    if (path.endsWith("/checkout") && req.method === "POST") return { policy: RATE_LIMIT_POLICIES.checkout }
    if (req.method === "GET") return { policy: RATE_LIMIT_POLICIES.catalogRead }
    if (req.method === "PATCH" || req.method === "DELETE") return { policy: RATE_LIMIT_POLICIES.commerceWrite }
    return null
  }

  if ((path === "/mcp" || path === "/ucp/mcp") && req.method === "POST") {
    const envelope = await rpcEnvelope(req)
    const name = envelope?.method === "tools/call" ? envelope.params?.name : undefined
    if (path === "/mcp" && name === "vibecart.create_checkout") {
      return { policy: RATE_LIMIT_POLICIES.checkout, rpcId: envelope?.id }
    }
    if (path === "/ucp/mcp" && name && UCP_MUTATING_TOOLS.has(name)) {
      return { policy: RATE_LIMIT_POLICIES.commerceWrite, rpcId: envelope?.id }
    }
    return { policy: RATE_LIMIT_POLICIES.catalogRead, rpcId: envelope?.id }
  }

  return null
}

function rateHeaders(result: RateLimitResult) {
  return {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(result.resetAtEpochSeconds),
    ...(result.degraded ? { "x-vibecart-rate-limit-degraded": "1" } : {}),
  }
}

function rateFailure(req: NextRequest, result: RateLimitResult, rpcId?: RpcEnvelope["id"]) {
  const backendUnavailable = result.backendUnavailable
  const status = backendUnavailable ? 503 : 429
  const code = backendUnavailable ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "RATE_LIMITED"
  const message = backendUnavailable
    ? "Commerce protection is temporarily unavailable. Retry shortly."
    : "Rate limit exceeded. Retry after the indicated delay."
  const headers = {
    ...rateHeaders(result),
    "retry-after": String(result.retryAfterSeconds),
    "cache-control": "no-store",
  }

  if (req.nextUrl.pathname === "/mcp" || req.nextUrl.pathname === "/ucp/mcp") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId ?? null,
        error: {
          code: -32000,
          message,
          data: {
            code,
            scope: result.scope,
            retryAfterSeconds: result.retryAfterSeconds,
          },
        },
      },
      { status, headers }
    )
  }

  return NextResponse.json(
    {
      success: false,
      code,
      error: message,
      scope: result.scope,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { status, headers }
  )
}

export async function middleware(req: NextRequest) {
  const brandedRoute = brandedSiteRouting(req)
  if (brandedRoute) return brandedRoute

  const authFailure = await hostedMerchantAuthFailure(req)
  if (authFailure) return authFailure

  const classification = await classifyRateLimit(req)
  if (!classification) return NextResponse.next()

  const result = await consumeRateLimit(req, classification.policy)
  if (!result.allowed) return rateFailure(req, result, classification.rpcId)

  const response = NextResponse.next()
  for (const [key, value] of Object.entries(rateHeaders(result))) response.headers.set(key, value)
  return response
}

export const config = {
  matcher: "/:path*",
}
