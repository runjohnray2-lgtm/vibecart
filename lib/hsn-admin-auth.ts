import { createHmac, timingSafeEqual } from "node:crypto"

export const HSN_ADMIN_COOKIE = "hsn_admin_session"
const SESSION_TTL_SECONDS = 8 * 60 * 60

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function password(): string | null {
  const value = process.env.HSN_ADMIN_PASSWORD ?? ""
  return value.length >= 16 ? value : null
}

function sessionSecret(): string | null {
  const value = process.env.HSN_ADMIN_SESSION_SECRET ?? ""
  return value.length >= 32 ? value : null
}

function signature(expiresAt: number): string | null {
  const secret = sessionSecret()
  if (!secret) return null
  return createHmac("sha256", secret)
    .update(`hsn-admin-v1\n${expiresAt}`, "utf8")
    .digest("base64url")
}

export function verifyHsnAdminPassword(candidate: string): boolean {
  const expected = password()
  return Boolean(expected && secureEqual(candidate, expected))
}

export function issueHsnAdminSession(now = Date.now()): { token: string; maxAge: number } | null {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS
  const digest = signature(expiresAt)
  return digest ? { token: `v1.${expiresAt}.${digest}`, maxAge: SESSION_TTL_SECONDS } : null
}

export function verifyHsnAdminSession(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false
  const [version, rawExpiry, presented] = token.split(".")
  const expiresAt = Number(rawExpiry)
  if (version !== "v1" || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000) || !presented) {
    return false
  }
  const expected = signature(expiresAt)
  return Boolean(expected && secureEqual(presented, expected))
}

export function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return undefined
}

export function hsnAdminRequestAuthorized(req: Request): boolean {
  return verifyHsnAdminSession(cookieValue(req, HSN_ADMIN_COOKIE))
}
