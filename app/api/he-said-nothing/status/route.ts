import { NextResponse } from "next/server"
import { hsnCheckoutReadiness } from "@/lib/he-said-nothing-config"

export const dynamic = "force-dynamic"

export async function GET() {
  const readiness = hsnCheckoutReadiness()
  return NextResponse.json(
    {
      enabled: readiness.enabled,
      mode: readiness.mode,
      shippingCents: readiness.shippingCents,
      premiumPackagingCents: readiness.premiumPackagingCents,
    },
    { headers: { "cache-control": "no-store" } }
  )
}
