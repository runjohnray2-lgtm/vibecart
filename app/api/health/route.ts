import { NextResponse } from "next/server"
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

  const mode = value.startsWith("sk_live_") || value.startsWith("rk_live_")
    ? "live"
    : value.startsWith("sk_test_") || value.startsWith("rk_test_")
      ? "test"
      : "unknown"

  const credentialType = value.startsWith("rk_")
    ? "restricted"
    : value.startsWith("sk_")
      ? "secret"
      : "unknown"

  return { configured: true, mode, credentialType }
}

export async function GET() {
  const hsn = hsnCheckoutReadiness()
  const stripe = stripeCredentialInfo()
  const catalogMode = catalogSourceMode()

  return NextResponse.json(
    {
      service: "vibecart",
      ok: true,
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
