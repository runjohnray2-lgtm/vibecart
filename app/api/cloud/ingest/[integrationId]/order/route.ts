import { NextResponse } from "next/server"
import { cloudIntegrationAuthorized } from "@/lib/cloud-ingest-auth"
import { getStoredOrderByCheckoutSession } from "@/lib/order-store"

export const runtime = "nodejs"

export async function POST(req: Request, context: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await context.params
  if (!cloudIntegrationAuthorized(req, integrationId)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const body = await req.json() as { checkoutSessionId?: unknown }
    if (typeof body.checkoutSessionId !== "string"
      || body.checkoutSessionId.length < 1
      || body.checkoutSessionId.length > 200) {
      return NextResponse.json({ success: false, error: "Invalid checkout session." }, { status: 400 })
    }
    const order = await getStoredOrderByCheckoutSession(body.checkoutSessionId)
    if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 })
    return NextResponse.json({ success: true, order })
  } catch (error) {
    console.error("[vibecart cloud] Durable order lookup failed", error)
    return NextResponse.json({ success: false, error: "Order lookup unavailable." }, { status: 503 })
  }
}
