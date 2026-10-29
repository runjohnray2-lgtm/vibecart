import type { NormalizedOrder } from "@/lib/orders"
import type { StoredOrder } from "@/lib/order-store"

const CLOUD_TIMEOUT_MS = 5_000

export interface CloudForwardResult {
  configured: boolean
  delivered: boolean
  retryable: boolean
  status?: number
  reason?: "incomplete_config" | "invalid_url" | "timeout" | "network" | "cloud_rejected"
}

export interface StoredCloudOrderEvent {
  eventId: string
  eventType: "checkout.session.completed" | "checkout.session.async_payment_succeeded"
  eventCreatedAt: string
  order: StoredOrder
}

interface CloudConfig {
  url: string
  key: string
}

function getCloudConfig(): CloudConfig | null | "invalid" {
  const rawUrl = process.env.VIBECART_CLOUD_INGEST_URL?.trim() ?? ""
  const key = process.env.VIBECART_CLOUD_INGEST_KEY?.trim() ?? ""

  if (!rawUrl && !key) return null
  if (!rawUrl || !key) return "invalid"

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return "invalid"
    return { url: url.toString(), key }
  } catch {
    return "invalid"
  }
}

export function cloudDeliveryRequested(): boolean {
  return Boolean(
    process.env.VIBECART_CLOUD_INGEST_URL?.trim()
      || process.env.VIBECART_CLOUD_INGEST_KEY?.trim()
  )
}

function normalizedOrder(order: StoredOrder): NormalizedOrder {
  return {
    checkoutSessionId: order.checkoutSessionId,
    cartId: order.cartId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    shipping: { ...order.shipping },
    amountSubtotal: order.amountSubtotal,
    amountShipping: order.amountShipping,
    amountTax: order.amountTax,
    amountTotal: order.amountTotal,
    currency: order.currency,
    paymentStatus: order.paymentStatus,
    lines: order.lines.map(line => ({ ...line })),
  }
}

function primaryProductId(order: StoredOrder): string {
  return order.lines.length === 1 ? order.lines[0]?.productId ?? "" : ""
}

function totalQuantity(order: StoredOrder): number | null {
  const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0)
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 9_999 ? quantity : null
}

export async function forwardStoredOrderEvent(input: StoredCloudOrderEvent): Promise<CloudForwardResult> {
  const config = getCloudConfig()
  if (config === null) return { configured: false, delivered: false, retryable: false }
  if (config === "invalid") {
    console.error("[vibecart cloud] Ingest configuration is incomplete or invalid")
    return { configured: true, delivered: false, retryable: true, reason: "incomplete_config" }
  }

  const { eventId, eventType, eventCreatedAt, order } = input
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS)

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "VibeCart-Core/1",
        "x-vibecart-key": config.key,
      },
      body: JSON.stringify({
        eventId,
        type: eventType,
        source: "vibecart-core",
        checkoutSessionId: order.checkoutSessionId,
        customerEmail: order.customerEmail,
        amountTotal: order.amountTotal,
        currency: order.currency,
        productId: primaryProductId(order),
        quantity: totalQuantity(order),
        merchantId: order.merchantId,
        metadata: order.metadata,
        createdAt: eventCreatedAt,
        order: normalizedOrder(order),
      }),
      redirect: "error",
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`[vibecart cloud] Ingest returned HTTP ${response.status} for Stripe event ${eventId}`)
      return {
        configured: true,
        delivered: false,
        retryable: true,
        status: response.status,
        reason: "cloud_rejected",
      }
    }

    return { configured: true, delivered: true, retryable: false, status: response.status }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError"
    console.warn(`[vibecart cloud] Ingest ${timedOut ? "timed out" : "failed"} for Stripe event ${eventId}`)
    return {
      configured: true,
      delivered: false,
      retryable: true,
      reason: timedOut ? "timeout" : "network",
    }
  } finally {
    clearTimeout(timeout)
  }
}
