import { NextResponse } from "next/server"
import Stripe from "stripe"
import { attemptCloudOutboxForOrder } from "@/lib/cloud-outbox"
import { persistVerifiedCheckoutEvent } from "@/lib/payment-durability"

export const runtime = "nodejs"

const FORWARDABLE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
])

function paymentReady(event: Stripe.Event, session: Stripe.Checkout.Session): boolean {
  if (event.type === "checkout.session.async_payment_succeeded") return true
  return session.payment_status === "paid" || session.payment_status === "no_payment_required"
}

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secretKey || !webhookSecret) {
    return NextResponse.json(
      { success: false, error: "Webhook not configured." },
      { status: 501 }
    )
  }

  const stripe = new Stripe(secretKey)
  const signature = req.headers.get("stripe-signature")
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    if (!signature) throw new Error("Missing stripe-signature header")
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (error) {
    console.warn("[vibecart webhook] Stripe signature verification failed", error)
    return NextResponse.json({ success: false, error: "Signature verification failed." }, { status: 400 })
  }

  if (FORWARDABLE_EVENTS.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session

    if (paymentReady(event, session)) {
      let orderId: string
      try {
        const order = await persistVerifiedCheckoutEvent(event, session, stripe)
        orderId = order.id
      } catch (error) {
        console.error(
          `[vibecart webhook] Verified payment event ${event.id} (session ${session.id}) was NOT durably stored; requesting Stripe retry`,
          error instanceof Error ? error.message : "unknown"
        )
        return NextResponse.json(
          {
            received: false,
            retry: true,
            error: "Durable order persistence temporarily unavailable.",
          },
          { status: 503 }
        )
      }

      let cloudState = "not-requested"
      try {
        const cloud = await attemptCloudOutboxForOrder(orderId)
        cloudState = cloud
          ? cloud.delivered
            ? "delivered"
            : cloud.reason ?? "queued"
          : "not-requested-or-not-due"
      } catch (error) {
        // Core order storage is authoritative. Cloud delivery is optional and
        // retryable from the durable outbox, so a Cloud problem must not cause
        // Stripe to replay an order that Core already persisted.
        cloudState = "queued-after-error"
        console.warn(
          `[vibecart webhook] Core order ${orderId} stored but immediate Cloud delivery could not run`,
          error instanceof Error ? error.message : "unknown"
        )
      }

      console.log(
        `[vibecart webhook] Verified payment event ${event.id}: session=${session.id}, amount_total=${session.amount_total}, core_order=${orderId}, cloud=${cloudState}`
      )
    } else {
      console.log(`[vibecart webhook] Checkout ${session.id} completed before payment settled; waiting for payment-success event`)
    }
  }

  return NextResponse.json({ received: true })
}
