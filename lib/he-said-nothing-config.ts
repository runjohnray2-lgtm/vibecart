const HSN_PRODUCT_PREFIX = "hsn-nothing-box-"
const MIN_ADMIN_PASSWORD_LENGTH = 16
const MIN_SECRET_LENGTH = 32

export type HsnCheckoutMode = "test" | "live"

export interface HsnCheckoutReadiness {
  enabled: boolean
  mode: HsnCheckoutMode | null
  shippingCents: number | null
  premiumPackagingCents: number | null
  reasons: string[]
}

export interface HsnPolicyConfig {
  supportEmail: string
  returnPolicy: string
  processingTime: string
}

function positiveMinorUnits(raw: string | undefined): number | null {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function configuredMode(): HsnCheckoutMode | null {
  const value = process.env.HSN_CHECKOUT_MODE?.trim().toLowerCase()
  return value === "test" || value === "live" ? value : null
}

function stripeKeyMatchesMode(mode: HsnCheckoutMode | null): boolean {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
  if (mode === "test") return key.startsWith("sk_test_")
  if (mode === "live") return key.startsWith("sk_live_")
  return false
}

export function isHsnProductId(productId: string): boolean {
  return productId.startsWith(HSN_PRODUCT_PREFIX)
}

export function hsnAdminAuthConfigured(): boolean {
  return (process.env.HSN_ADMIN_PASSWORD?.length ?? 0) >= MIN_ADMIN_PASSWORD_LENGTH
    && (process.env.HSN_ADMIN_SESSION_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH
}

export function hsnCheckoutReadiness(): HsnCheckoutReadiness {
  const requested = process.env.HSN_CHECKOUT_ENABLED?.trim().toLowerCase() === "true"
  const mode = configuredMode()
  const shippingCents = positiveMinorUnits(process.env.HSN_SHIPPING_RATE_CENTS)
  const premiumPackagingCents = positiveMinorUnits(process.env.HSN_PREMIUM_PACKAGING_CENTS)
  const reasons: string[] = []

  if (!requested) reasons.push("ordering_disabled")
  if (!mode) reasons.push("checkout_mode_missing")
  if (!stripeKeyMatchesMode(mode)) reasons.push("stripe_mode_mismatch")
  if (!process.env.STRIPE_WEBHOOK_SECRET) reasons.push("stripe_webhook_missing")
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) reasons.push("database_missing")
  if (shippingCents === null) reasons.push("shipping_rate_missing")
  if (!process.env.VIBECART_CLOUD_INGEST_URL || !process.env.VIBECART_CLOUD_INGEST_KEY) {
    reasons.push("durable_order_ingest_missing")
  }
  if (!process.env.VIBECART_ORDER_PERMALINK_TEMPLATE) reasons.push("order_permalink_missing")
  if (!hsnAdminAuthConfigured()) reasons.push("admin_auth_missing")
  if (mode === "live") {
    if (!process.env.HSN_SUPPORT_EMAIL) reasons.push("support_email_missing")
    if (!process.env.HSN_RETURN_POLICY) reasons.push("return_policy_missing")
    if (!process.env.HSN_PROCESSING_TIME) reasons.push("processing_time_missing")
  }

  return {
    enabled: requested && reasons.length === 0,
    mode,
    shippingCents,
    premiumPackagingCents,
    reasons,
  }
}

export function hsnPolicyConfig(): HsnPolicyConfig {
  return {
    supportEmail: process.env.HSN_SUPPORT_EMAIL?.trim() ?? "",
    returnPolicy: process.env.HSN_RETURN_POLICY?.trim() ?? "Final return terms will be published before ordering opens.",
    processingTime: process.env.HSN_PROCESSING_TIME?.trim() ?? "Final processing times will be published before ordering opens.",
  }
}

export function requireHsnCheckoutReady(): HsnCheckoutReadiness {
  const readiness = hsnCheckoutReadiness()
  if (!readiness.enabled) {
    throw new Error(`He Said Nothing checkout is not ready: ${readiness.reasons.join(", ")}`)
  }
  return readiness
}

export function hsnPublicSiteUrl(): string {
  const configured = process.env.HSN_SITE_URL?.trim()
  if (!configured) return "https://hesaidnothing.com"
  const url = new URL(configured)
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("HSN_SITE_URL must be a public HTTPS origin")
  }
  return url.origin
}
