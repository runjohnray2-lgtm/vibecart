import { NextResponse } from "next/server"
import { orderPermalinkConfigured } from "@/lib/order-permalink"

export const dynamic = "force-dynamic"

export async function GET() {
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
    },
    { headers: { "cache-control": "no-store" } }
  )
}
