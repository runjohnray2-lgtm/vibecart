import type { NextRequest } from "next/server"

// This is a runtime backstop, not proof of infrastructure isolation. Operators
// must verify branch ownership, env scopes, test keys and allowance under #108.
export function previewSafetyFailure(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VERCEL_ENV !== "preview") return null
  if (env.VIBECART_STAGING_ISOLATION_VERIFIED !== "true") return "isolation_unverified"
  try {
    const database = new URL(env.DATABASE_URL ?? "")
    const approvedHost = env.VIBECART_STAGING_DATABASE_HOST
    if (!approvedHost || database.hostname !== approvedHost || !database.username || !database.password
      || !["postgres:", "postgresql:"].includes(database.protocol)) return "database_target_unverified"
    if (env.POSTGRES_URL && env.POSTGRES_URL !== env.DATABASE_URL) return "database_fallback_mismatch"
  } catch {
    return "database_target_unverified"
  }
  if (!/^(sk|rk)_test_.+/.test(env.STRIPE_SECRET_KEY ?? "")
    || !env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) return "test_payments_unconfigured"
  if (env.VIBECART_HOSTED_MODE !== "true" || !env.VIBECART_MERCHANT_ID
    || env.VIBECART_MERCHANT_ID === "default"
    || (env.VIBECART_MERCHANT_API_KEY?.length ?? 0) < 24
    || (env.VIBECART_CART_ACCESS_SECRET?.length ?? 0) < 32) return "merchant_isolation_unconfigured"
  if (env.VIBECART_CLOUD_INGEST_URL || env.VIBECART_CLOUD_INGEST_KEY
    || env.VIBECART_CLOUD_OUTBOX_CRON_ENABLED === "true") return "external_delivery_enabled"
  return null
}

// Keep staging limited to the commerce pilot; billing, admin probes, auth proxy,
// email, fulfillment, cron and other app APIs remain unavailable.
export function previewRouteAllowed(path: string): boolean {
  if (!path.startsWith("/api/")) return true
  return path === "/api/health" || path === "/api/checkout"
    || path === "/api/webhook/stripe" || path === "/api/cart"
    || /^\/api\/cart\/[^/]+(?:\/checkout)?$/.test(path)
}

export function previewRequestFailure(req: Pick<NextRequest, "nextUrl">): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null
  // Health is configuration-only and does not connect to databases or Stripe.
  if (req.nextUrl.pathname === "/api/health" || req.nextUrl.pathname.startsWith("/_next/")) return null
  return previewSafetyFailure() ?? (previewRouteAllowed(req.nextUrl.pathname) ? null : "route_disabled_in_staging")
}
