import { NextResponse } from "next/server"
import Stripe from "stripe"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const origin = new URL(req.url).origin
  const secret = process.env.STRIPE_SECRET_KEY

  if (!secret) {
    return NextResponse.redirect(`${origin}/founding-merchant?checkout=unavailable`, 303)
  }

  try {
    const stripe = new Stripe(secret)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 19900,
            product_data: {
              name: "VibeCart Founding Merchant Setup",
              description: "One-store production setup: trusted catalog connection, MCP/UCP commerce endpoints, Stripe Checkout handoff, validation, and launch support.",
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            unit_amount: 2900,
            recurring: { interval: "month" },
            product_data: {
              name: "VibeCart Cloud — Founding Merchant",
              description: "Managed VibeCart Cloud operations, commerce event/order plumbing, webhook delivery/retries, monitoring, updates, and support.",
            },
          },
          quantity: 1,
        },
      ],
      billing_address_collection: "auto",
      metadata: {
        product: "vibecart",
        offer: "founding_merchant",
      },
      subscription_data: {
        metadata: {
          product: "vibecart",
          plan: "founding_merchant",
        },
      },
      success_url: `${origin}/founding-merchant/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/founding-merchant?checkout=cancelled`,
    })

    if (!session.url) {
      throw new Error("Stripe Checkout did not return a hosted URL")
    }

    return NextResponse.redirect(session.url, 303)
  } catch (error) {
    console.error("[vibecart founding merchant checkout] failed", error)
    return NextResponse.redirect(`${origin}/founding-merchant?checkout=error`, 303)
  }
}
