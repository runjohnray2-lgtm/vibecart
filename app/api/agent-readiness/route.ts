import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import Stripe from "stripe"
import {
  CatalogSourceError,
  catalogSourceMode,
  configuredMerchantName,
  listCatalogProducts,
} from "@/lib/catalog-source"
import { hsnCheckoutReadiness, isHsnProductId } from "@/lib/he-said-nothing-config"
import { ucpCartRuntimeConfigured } from "@/lib/ucp-cart-service"
import { ucpOrderRuntimeConfigured } from "@/lib/ucp-order-service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function stripeKey() {
  const value = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
  return {
    value,
    present: Boolean(value),
    validShape: value.startsWith("sk_") || value.startsWith("rk_"),
    mode: value.startsWith("sk_live_") || value.startsWith("rk_live_")
      ? "live"
      : value.startsWith("sk_test_") || value.startsWith("rk_test_")
        ? "test"
        : value
          ? "unknown"
          : "none",
  }
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const issues: string[] = []
  const catalogMode = catalogSourceMode()
  const hsn = hsnCheckoutReadiness()

  let products: Awaited<ReturnType<typeof listCatalogProducts>> = []
  let catalogHealthy = false
  let catalogErrorCode: string | null = null

  try {
    products = await listCatalogProducts()
    if (catalogMode === "reference" && !hsn.enabled) {
      products = products.filter(product => !isHsnProductId(product.id))
    }
    catalogHealthy = true
  } catch (error) {
    catalogErrorCode = error instanceof CatalogSourceError ? error.code : "CATALOG_ERROR"
    issues.push("catalog_unavailable")
  }

  const catalogSnapshot = products
    .map(product => ({ id: product.id, priceCents: product.priceCents, variant: product.variant ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const catalogHash = catalogHealthy
    ? createHash("sha256").update(JSON.stringify(catalogSnapshot)).digest("hex")
    : null

  const stripe = stripeKey()
  let stripeAuthentication: "not_configured" | "invalid_shape" | "ok" | "failed" = "not_configured"

  if (!stripe.present) {
    issues.push("stripe_not_configured")
  } else if (!stripe.validShape) {
    stripeAuthentication = "invalid_shape"
    issues.push("stripe_key_invalid")
  } else {
    try {
      const client = new Stripe(stripe.value)
      await client.checkout.sessions.list({ limit: 1 })
      stripeAuthentication = "ok"
    } catch {
      stripeAuthentication = "failed"
      issues.push("stripe_authentication_failed")
    }
  }

  if (catalogMode === "reference") issues.push("reference_catalog_only")
  if (!ucpCartRuntimeConfigured()) issues.push("durable_cart_not_configured")
  if (!ucpOrderRuntimeConfigured()) issues.push("order_lookup_not_configured")

  const checkoutReady =
    catalogHealthy &&
    catalogMode === "remote" &&
    products.length > 0 &&
    stripeAuthentication === "ok"

  const durableAgentCommerceReady = checkoutReady && ucpCartRuntimeConfigured()

  return NextResponse.json(
    {
      service: "vibecart",
      checkedAt: new Date().toISOString(),
      merchant: {
        name: configuredMerchantName(),
        catalogMode,
      },
      catalog: {
        healthy: catalogHealthy,
        productCount: products.length,
        hashSha256: catalogHash,
        errorCode: catalogErrorCode,
      },
      checkout: {
        ready: checkoutReady,
        stripeCredentialPresent: stripe.present,
        stripeCredentialShapeValid: stripe.validShape,
        stripeMode: stripe.mode,
        stripeAuthentication,
      },
      cart: {
        durable: true,
        ready: ucpCartRuntimeConfigured(),
      },
      order: {
        ready: ucpOrderRuntimeConfigured(),
      },
      agentCommerce: {
        ready: durableAgentCommerceReady,
        issues: [...new Set(issues)],
      },
      endpoints: {
        mcp: `${origin}/mcp`,
        ucpDiscovery: `${origin}/.well-known/ucp`,
        ucpMcp: `${origin}/ucp/mcp`,
        discovery: `${origin}/.well-known/vibecart.json`,
        health: `${origin}/api/health`,
      },
    },
    { headers: { "cache-control": "no-store" } }
  )
}
