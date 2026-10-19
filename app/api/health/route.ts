import { previewSafetyFailure } from "@/lib/preview-safety"
import { NextResponse } from "next/server"
import { stripeKeyMode } from "@/lib/stripe-mode"
import { orderPermalinkConfigured } from "@/lib/order-permalink"
import { hostedMerchantAuthConfigured, hostedModeEnabled } from "@/lib/merchant-auth"
import { hsnCheckoutReadiness } from "@/lib/he-said-nothing-config"
import { catalogSourceMode, configuredMerchantName } from "@/lib/catalog-source"

export const dynamic = "force-dynamic"

function stripeCredentialInfo() {
  const value = process.env.STRIPE_SECRET_KEY?.trim()
  if (!value) {
    return { configured: false, mode: "none", credentialType: "none" }
  }

  const mode = stripeKeyMode(value)

  const credentialType = value.startsWith("rk_")
    ? "restricted"
    : value.startsWith("sk_")
      ? "secret"
      : "unknown"

  return { configured: true, mode, credentialType }
}

export async function GET(req: Request) {
  if (req && new URL(req.url).searchParams.get("staging-database") === "verify") {
    const { verifyStagingDatabase } = await import("@/lib/staging-database-verification")
    return verifyStagingDatabase(req)
  }
  if (req && new URL(req.url).searchParams.get("staging-database") === "form") {
    const { stagingVerificationForm } = await import("@/lib/staging-database-verification")
    return stagingVerificationForm()
  }
  const hsn = hsnCheckoutReadiness()
  const stripe = stripeCredentialInfo()
  const catalogMode = catalogSourceMode()

  return NextResponse.json(
    {
      service: "vibecart",
      ok: true,
      readinessScope: "configuration-only",
      stagingSafetyConfigured: process.env.VERCEL_ENV === "preview" ? previewSafetyFailure() === null : null,
      catalogMode,
      merchantName: configuredMerchantName(),
      referenceCatalog: catalogMode === "reference",
      stripeConfigured: stripe.configured,
      stripeMode: stripe.mode,
      stripeCredentialType: stripe.credentialType,
      checkoutConfigurationState: stripe.configured
        ? catalogMode === "remote"
          ? "merchant-catalog-stripe-configured"
          : "reference-catalog-with-stripe-credential"
        : "no-stripe-credential",
      webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      durableOrderStoreConfigured: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      cloudOutboxRetryEnabled: process.env.VIBECART_CLOUD_OUTBOX_CRON_ENABLED?.trim().toLowerCase() === "true",
      cloudConfigured: Boolean(
        process.env.VIBECART_CLOUD_INGEST_URL && process.env.VIBECART_CLOUD_INGEST_KEY
      ),
      orderPermalinkConfigured: orderPermalinkConfigured(),
      hostedMode: hostedModeEnabled(),
      merchantAuthConfigured: hostedMerchantAuthConfigured(),
      heSaidNothingCheckoutEnabled: hsn.enabled,
      heSaidNothingCheckoutMode: hsn.mode,
    },
    { headers: { "cache-control": "no-store" } }
  )
}

export async function POST(req: Request) {
  if (new URL(req.url).searchParams.get("staging-database") !== "verify") return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { submitStagingVerification } = await import("@/lib/staging-database-verification")
  return submitStagingVerification(req)
}
