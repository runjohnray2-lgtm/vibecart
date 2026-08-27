import { NextResponse } from "next/server"
import { orderPermalinkConfigured } from "@/lib/order-permalink"
import { hostedMerchantAuthConfigured, hostedModeEnabled } from "@/lib/merchant-auth"
import { hsnCheckoutReadiness } from "@/lib/he-said-nothing-config"

export const dynamic = "force-dynamic"

export async function GET() {
  const hsn = hsnCheckoutReadiness()
  return NextResponse.json(
    {
      service: "vibecart",
      ok: true,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
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
