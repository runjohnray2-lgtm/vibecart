import { NextResponse } from "next/server"
import Stripe from "stripe"

export const runtime = "nodejs"

// Minimal Stripe webhook receiver for order-confirmation events.
// This is a STUB: it verifies the signature and logs the event, but does
// not send an email, update inventory, or write to a database — those are
// genuine gaps, not hidden. Wire in your own fulfillment logic where noted.
//
// To use: set STRIPE_WEBHOOK_SECRET (from your Stripe Dashboard's webhook
// endpoint settings) as an environment variable, and point a webhook
// endpoint at POST /api/webhook/stripe listening for
// "checkout.session.completed".

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secretKey || !webhookSecret) {
    return NextResponse.json(
      { success: false, error: "Webhook not configured — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET." },
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
  } catch (err) {
    return NextResponse.json({ success: false, error: `Signature verification failed: ${String(err)}` }, { status: 400 })
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    // TODO: this is where real order fulfillment goes — e.g. send a
    // confirmation email, mark the order paid in your own database, trigger
    // shipping. Currently just logged.
    console.log(`[vibecart webhook] Checkout completed: ${session.id}, amount_total=${session.amount_total}`)
  }

  return NextResponse.json({ received: true })
}
