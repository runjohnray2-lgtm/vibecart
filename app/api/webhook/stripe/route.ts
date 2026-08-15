import { NextResponse } from "next/server"
import Stripe from "stripe"

export const runtime = "nodejs"

// Minimal Stripe webhook receiver for order-confirmation events.
// This endpoint verifies Stripe signatures before doing any work. Durable
// order state and managed fulfillment delivery belong in VibeCart Cloud and
// are intentionally not simulated here.

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    console.log(`[vibecart webhook] Checkout completed: ${session.id}, amount_total=${session.amount_total}`)
  }

  return NextResponse.json({ received: true })
}
