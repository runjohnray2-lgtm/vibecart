import { NextResponse } from "next/server"
import Stripe from "stripe"
import { forwardVerifiedCheckoutEvent } from "@/lib/cloud-events"
import { setAllAppsAccess, subscriptionStatusToAccess } from "@/lib/app-factory-billing"

export const runtime = "nodejs"

const FORWARDABLE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
])

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
])

function paymentReady(event: Stripe.Event, session: Stripe.Checkout.Session): boolean {
  if (event.type === "checkout.session.async_payment_succeeded") return true
  return session.payment_status === "paid" || session.payment_status === "no_payment_required"
}

async function syncAppFactorySubscription(event: Stripe.Event): Promise<void> {
  if (!SUBSCRIPTION_EVENTS.has(event.type)) return

  const subscription = event.data.object as Stripe.Subscription
  if (subscription.metadata?.vibecart_product !== "app-factory-all-access") return

  const accountKey = subscription.metadata?.vibecart_account_key?.trim()
  if (!accountKey) {
    console.warn(`[vibecart webhook] App Factory subscription ${subscription.id} is missing vibecart_account_key`)
    return
  }

  const accessStatus =
    event.type === "customer.subscription.deleted"
      ? "expired"
      : subscriptionStatusToAccess(subscription.status)

  await setAllAppsAccess(accountKey, accessStatus, `stripe:${event.type}`)
  console.log(
    `[vibecart webhook] Synced App Factory access: subscription=${subscription.id}, account=${accountKey}, status=${accessStatus}`
  )
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
    await syncAppFactorySubscription(event)
  } catch (error) {
    console.error("[vibecart webhook] Failed to sync App Factory subscription access", error)
    return NextResponse.json(
      { received: false, retry: true, error: "Subscription access update temporarily unavailable." },
      { status: 503 }
    )
  }

  if (FORWARDABLE_EVENTS.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session

    if (paymentReady(event, session)) {
      const cloud = await forwardVerifiedCheckoutEvent(event, session, stripe)

      if (cloud.configured && !cloud.delivered && cloud.retryable) {
        // A non-2xx response asks Stripe to retry this exact event. Cloud uses
        // Stripe's stable event.id for event idempotency and Checkout Session
        // identity for order idempotency, so retries cannot intentionally
        // create duplicate durable commerce records.
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

  return NextResponse.json({ received: true })
}
