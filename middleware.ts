import { NextRequest, NextResponse } from "next/server"

const MIN_MERCHANT_KEY_LENGTH = 24
const HOSTED_MERCHANT_POST_PATHS = new Set([
  "/mcp",
  "/ucp/mcp",
  "/api/checkout",
  "/api/cart",
])

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

export async function middleware(req: NextRequest) {
  if (!hostedModeEnabled() || req.method !== "POST" || !HOSTED_MERCHANT_POST_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.next()
  }

  const merchantId = process.env.VIBECART_MERCHANT_ID?.trim()
  const expectedKey = process.env.VIBECART_MERCHANT_API_KEY?.trim()
  if (!merchantId || merchantId === "default" || !expectedKey || expectedKey.length < MIN_MERCHANT_KEY_LENGTH) {
    return jsonError(503, "MERCHANT_AUTH_NOT_CONFIGURED", "Hosted merchant authentication is not configured.")
  }

  const presented = req.headers.get("x-vibecart-merchant-key")?.trim()
  if (!presented || !(await secureEqual(presented, expectedKey))) {
    return jsonError(401, "UNAUTHORIZED", "Merchant authentication is required.")
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/mcp", "/ucp/mcp", "/api/checkout", "/api/cart"],
}
