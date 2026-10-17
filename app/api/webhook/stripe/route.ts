import { NextResponse } from "next/server"
import Stripe from "stripe"
import { forwardVerifiedCheckoutEvent } from "@/lib/cloud-events"

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
      const cloud = await forwardVerifiedCheckoutEvent(event, session, stripe)

      if (!cloud.delivered) {
        // Fail closed: a verified, paid event may only be acknowledged once the
        // durable order write is confirmed. Cloud unconfigured, misconfigured, or
        // temporarily unavailable all return non-2xx so Stripe retries this exact
        // event. Cloud uses Stripe's stable event.id for event idempotency and
        // Checkout Session identity for order idempotency, so retries cannot
        // intentionally create duplicate durable commerce records.
        const reason = cloud.configured ? (cloud.reason ?? "not-delivered") : "not-configured"
        console.error(
          `[vibecart webhook] Verified payment event ${event.id} (session ${session.id}) was NOT persisted (${reason}); requesting Stripe retry`
        )
        return NextResponse.json(
          {
            received: false,
            retry: true,
            error: cloud.configured
              ? "Durable event delivery temporarily unavailable."
              : "Durable order persistence is not configured.",
          },
          { status: 503 }
        )
      }

      console.log(
        `[vibecart webhook] Verified payment event ${event.id}: session=${session.id}, amount_total=${session.amount_total}, cloud=delivered`
      )
    } else {
      console.log(`[vibecart webhook] Checkout ${session.id} completed before payment settled; waiting for payment-success event`)
    }
  }

  return NextResponse.json({ received: true })
}
