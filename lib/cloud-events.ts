import Stripe from "stripe"
import { buildNormalizedOrder, type NormalizedOrder } from "@/lib/orders"
import { getCart } from "@/lib/cart-store"

const CLOUD_TIMEOUT_MS = 5_000

export interface CloudForwardResult {
  configured: boolean
  delivered: boolean
  retryable: boolean
  status?: number
  reason?: "incomplete_config" | "invalid_url" | "order_normalization" | "timeout" | "network" | "cloud_rejected"
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

function metadataQuantity(session: Stripe.Checkout.Session): number | null {
  const raw = session.metadata?.vibecart_quantity
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : null
}

function eventCreatedAt(event: Stripe.Event): string {
  return new Date(event.created * 1000).toISOString()
}

export async function forwardVerifiedCheckoutEvent(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  stripe: Stripe
): Promise<CloudForwardResult> {
  const config = getCloudConfig()
  if (config === null) return { configured: false, delivered: false, retryable: false }
  if (config === "invalid") {
    console.error("[vibecart cloud] Ingest configuration is incomplete or invalid")
    return { configured: true, delivered: false, retryable: true, reason: "incomplete_config" }
  }

  let order: NormalizedOrder
  try {
    order = await buildNormalizedOrder(stripe, session)
  } catch (error) {
    console.warn(`[vibecart cloud] Could not normalize Checkout Session ${session.id}`, error)
    return { configured: true, delivered: false, retryable: true, reason: "order_normalization" }
  }

  let merchantId = session.metadata?.vibecart_merchant_id?.trim() || "default"
  let metadata: Record<string, string> = {}
  if (order.cartId) {
    try {
      const cart = await getCart(order.cartId, merchantId)
      if (cart) {
        merchantId = cart.merchantId
        metadata = cart.metadata
      }
    } catch (error) {
      console.warn(`[vibecart cloud] Could not load cart metadata for ${order.cartId}`, error)
      return { configured: true, delivered: false, retryable: true, reason: "order_normalization" }
    }
  }

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
        eventId: event.id,
        type: event.type,
        source: "vibecart-core",
        checkoutSessionId: session.id,
        customerEmail: session.customer_details?.email ?? session.customer_email ?? "",
        amountTotal: session.amount_total,
        currency: session.currency ?? "",
        productId: session.metadata?.vibecart_product_id ?? "",
        quantity: metadataQuantity(session),
        merchantId,
        metadata,
        createdAt: eventCreatedAt(event),
        order,
      }),
      redirect: "error",
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`[vibecart cloud] Ingest returned HTTP ${response.status} for Stripe event ${event.id}`)
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
    console.warn(`[vibecart cloud] Ingest ${timedOut ? "timed out" : "failed"} for Stripe event ${event.id}`)
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
