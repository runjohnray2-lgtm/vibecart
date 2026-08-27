import { NextResponse } from "next/server"
import type { NormalizedOrder } from "@/lib/orders"
import { normalizeCartMetadata } from "@/lib/cart-store"
import { cloudIntegrationAuthorized } from "@/lib/cloud-ingest-auth"
import { storeVerifiedOrder } from "@/lib/order-store"

export const runtime = "nodejs"

type IngestBody = {
  eventId?: unknown
  type?: unknown
  source?: unknown
  merchantId?: unknown
  metadata?: unknown
  order?: unknown
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max
}

function validOrder(value: unknown): value is NormalizedOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const order = value as Partial<NormalizedOrder>
  return boundedString(order.checkoutSessionId, 200)
    && typeof order.cartId === "string"
    && typeof order.stripePaymentIntentId === "string"
    && typeof order.customerEmail === "string"
    && typeof order.customerName === "string"
    && typeof order.customerPhone === "string"
    && Boolean(order.shipping && typeof order.shipping === "object")
    && (order.amountSubtotal === null || Number.isSafeInteger(order.amountSubtotal))
    && Number.isSafeInteger(order.amountShipping)
    && Number.isSafeInteger(order.amountTax)
    && (order.amountTotal === null || Number.isSafeInteger(order.amountTotal))
    && typeof order.currency === "string"
    && typeof order.paymentStatus === "string"
    && Array.isArray(order.lines)
    && order.lines.length >= 1
}

export async function POST(req: Request, context: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await context.params
  if (!cloudIntegrationAuthorized(req, integrationId)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 })
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 128_000) {
    return NextResponse.json({ success: false, error: "Payload too large." }, { status: 413 })
  }

  try {
    const body = await req.json() as IngestBody
    if (!boundedString(body.eventId, 200)
      || (body.type !== "checkout.session.completed" && body.type !== "checkout.session.async_payment_succeeded")
      || body.source !== "vibecart-core"
      || !boundedString(body.merchantId, 100)
      || !validOrder(body.order)) {
      return NextResponse.json({ success: false, error: "Invalid verified-order payload." }, { status: 400 })
    }

    const metadata = normalizeCartMetadata(body.metadata)
    const order = await storeVerifiedOrder({
      eventId: body.eventId,
      merchantId: body.merchantId,
      metadata,
      order: body.order,
    })
    return NextResponse.json({ success: true, orderId: order.id }, { status: 201 })
  } catch (error) {
    console.error("[vibecart cloud] Durable order ingest failed", error)
    return NextResponse.json(
      { success: false, error: "Durable order could not be stored." },
      { status: 503 }
    )
  }
}
