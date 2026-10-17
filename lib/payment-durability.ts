import Stripe from "stripe"
import { buildNormalizedOrder } from "@/lib/orders"
import { getCart } from "@/lib/cart-store"
import { configuredMerchantId, hostedModeEnabled } from "@/lib/merchant-auth"
import { cloudDeliveryRequested } from "@/lib/cloud-events"
import { storeVerifiedOrder, type StoredOrder } from "@/lib/order-store"

const MERCHANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

function stripeEventCreatedAt(event: Stripe.Event): string {
  return new Date(event.created * 1000).toISOString()
}

function sessionMerchantId(session: Stripe.Checkout.Session): string | null {
  const value = session.metadata?.vibecart_merchant_id?.trim()
  if (!value) return null
  if (!MERCHANT_ID_PATTERN.test(value)) {
    throw new Error("Stripe Checkout Session has invalid VibeCart merchant identity")
  }
  return value
}

export async function persistVerifiedCheckoutEvent(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  stripe: Stripe
): Promise<StoredOrder> {
  const order = await buildNormalizedOrder(stripe, session)
  const configuredId = configuredMerchantId()
  const sessionId = sessionMerchantId(session)

  if (hostedModeEnabled() && sessionId && sessionId !== configuredId) {
    throw new Error("Stripe Checkout merchant identity does not match this hosted merchant")
  }

  let merchantId = sessionId ?? configuredId
  let metadata: Record<string, string> = {}

  if (order.cartId) {
    const cart = await getCart(order.cartId, merchantId)
    if (cart) {
      merchantId = cart.merchantId
      metadata = cart.metadata
    }
  }

  return storeVerifiedOrder({
    eventId: event.id,
    merchantId,
    order,
    metadata,
    ...(cloudDeliveryRequested()
      ? {
          cloudOutbox: {
            eventId: event.id,
            eventType: event.type as "checkout.session.completed" | "checkout.session.async_payment_succeeded",
            eventCreatedAt: stripeEventCreatedAt(event),
          },
        }
      : {}),
  })
}
