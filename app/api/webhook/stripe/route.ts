import { NextResponse } from "next/server"
import Stripe from "stripe"
import { forwardVerifiedCheckoutEvent } from "@/lib/cloud-events"
import { setAllAppsAccess, subscriptionStatusToAccess } from "@/lib/app-factory-billing"

export const runtime = "nodejs"

const FORWARDABLE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
])

function paymentReady(event: Stripe.Event, session: Stripe.Checkout.Session): boolean {
  if (event.type === "checkout.session.async_payment_succeeded") return true
  return session.payment_status === "paid" || session.payment_status === "no_payment_required"
}

function isAppFactoryMetadata(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.vibecart_product === "app-factory-all-access"
}

async function applyAppFactoryCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (!isAppFactoryMetadata(session.metadata)) return
  const accountKey = session.metadata?.vibecart_account_key || session.client_reference_id
  if (!accountKey) throw new Error("App Factory checkout is missing account metadata")
  await setAllAppsAccess(accountKey, "active", "stripe-checkout")
}

async function applyAppFactorySubscription(subscription: Stripe.Subscription): Promise<void> {
  if (!isAppFactoryMetadata(subscription.metadata)) return
  const accountKey = subscription.metadata?.vibecart_account_key
  if (!accountKey) throw new Error("App Factory subscription is missing account metadata")
  await setAllAppsAccess(accountKey, subscriptionStatusToAccess(subscription.status), `stripe-subscription:${subscription.status}`)
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

  try {
    if (FORWARDABLE_EVENTS.has(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session

      if (paymentReady(event, session)) {
        await applyAppFactoryCheckout(session)
        const cloud = await forwardVerifiedCheckoutEvent(event, session, stripe)

        if (cloud.configured && !cloud.delivered && cloud.retryable) {
          return NextResponse.json(
            { received: false, retry: true, error: "Durable event delivery temporarily unavailable." },
            { status: 503 }
          )
        }

        console.log(
          `[vibecart webhook] Verified payment event ${event.id}: session=${session.id}, amount_total=${session.amount_total}, cloud=${cloud.delivered ? "delivered" : cloud.configured ? "not-delivered" : "not-configured"}`
        )
      } else {
        console.log(`[vibecart webhook] Checkout ${session.id} completed before payment settled; waiting for payment-success event`)
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await applyAppFactorySubscription(event.data.object as Stripe.Subscription)
    }
  } catch (error) {
    console.error("[vibecart webhook] Failed to apply verified event", event.id, error)
    return NextResponse.json({ received: false, retry: true, error: "Verified event processing failed." }, { status: 503 })
  }

  return NextResponse.json({ received: true })
}
