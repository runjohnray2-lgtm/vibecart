import { neon } from "@neondatabase/serverless"

export type RateLimitScope = "catalog-read" | "commerce-write" | "checkout"

export interface RateLimitPolicy {
  scope: RateLimitScope
  limit: number
  windowSeconds: number
  failClosed: boolean
}

export interface RateLimitResult {
  allowed: boolean
  scope: RateLimitScope
  limit: number
  remaining: number
  retryAfterSeconds: number
  resetAtEpochSeconds: number
  degraded: boolean
  backendUnavailable: boolean
}

export const RATE_LIMIT_POLICIES = {
  catalogRead: {
    scope: "catalog-read",
    limit: 120,
    windowSeconds: 60,
    failClosed: false,
  },
  commerceWrite: {
    scope: "commerce-write",
    limit: 30,
    windowSeconds: 60,
    failClosed: true,
  },
  checkout: {
    scope: "checkout",
    limit: 20,
    windowSeconds: 60,
    failClosed: true,
  },
} as const satisfies Record<string, RateLimitPolicy>

function databaseUrl(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("VibeCart distributed rate limiter is not configured")
  return value
}

function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")?.trim()
    ?? "unknown"
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

async function requestKeyHash(req: Request, scope: RateLimitScope): Promise<string> {
  const merchant = process.env.VIBECART_MERCHANT_ID?.trim() || "default"
  return sha256Hex(`v1\n${merchant}\n${scope}\n${clientAddress(req)}`)
}

function secondsUntil(timestamp: Date | string, now = Date.now()): number {
  return Math.max(1, Math.ceil((new Date(timestamp).getTime() - now) / 1000))
}

export async function consumeRateLimit(
  req: Request,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const now = Date.now()
  try {
    const db = neon(databaseUrl())
    const keyHash = await requestKeyHash(req, policy.scope)
    const rows = await db`
      INSERT INTO vibecart_rate_limits (
        scope,
        key_hash,
        window_started_at,
        request_count,
        updated_at
      )
      VALUES (${policy.scope}, ${keyHash}, now(), 1, now())
      ON CONFLICT (scope, key_hash) DO UPDATE SET
        request_count = CASE
          WHEN vibecart_rate_limits.window_started_at <= now() - (${policy.windowSeconds} * interval '1 second')
            THEN 1
          ELSE vibecart_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN vibecart_rate_limits.window_started_at <= now() - (${policy.windowSeconds} * interval '1 second')
            THEN now()
          ELSE vibecart_rate_limits.window_started_at
        END,
        updated_at = now()
      RETURNING request_count, window_started_at
    `

    const count = Number(rows[0]?.request_count ?? 1)
    const windowStartedAt = new Date(rows[0]?.window_started_at as string | Date)
    const resetAt = new Date(windowStartedAt.getTime() + policy.windowSeconds * 1000)
    const allowed = count <= policy.limit
    return {
      allowed,
      scope: policy.scope,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      retryAfterSeconds: allowed ? 0 : secondsUntil(resetAt, now),
      resetAtEpochSeconds: Math.ceil(resetAt.getTime() / 1000),
      degraded: false,
      backendUnavailable: false,
    }
  } catch (error) {
    console.error("[vibecart rate-limit] durable backend unavailable", error instanceof Error ? error.name : "unknown")
    const resetAtEpochSeconds = Math.ceil((now + policy.windowSeconds * 1000) / 1000)
    return {
      allowed: !policy.failClosed,
      scope: policy.scope,
      limit: policy.limit,
      remaining: policy.failClosed ? 0 : policy.limit,
      retryAfterSeconds: policy.failClosed ? Math.min(policy.windowSeconds, 30) : 0,
      resetAtEpochSeconds,
      degraded: true,
      backendUnavailable: true,
    }
  }
}

export async function cleanupStaleRateLimits(maxAgeHours = 24): Promise<number> {
  const db = neon(databaseUrl())
  const rows = await db`
    DELETE FROM vibecart_rate_limits
    WHERE updated_at < now() - (${maxAgeHours} * interval '1 hour')
    RETURNING scope
  `
  return rows.length
}
