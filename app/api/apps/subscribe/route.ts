import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getAuth } from "@/lib/auth/server"

export const runtime = "nodejs"

function appBaseUrl(req: Request): string {
  const configured = process.env.VIBECART_APP_FACTORY_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")
  return new URL(req.url).origin
}

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.APP_FACTORY_STRIPE_PRICE_ID?.trim()
  if (!secretKey || !priceId) {
    return NextResponse.json({ error: "App Factory billing is not configured" }, { status: 501 })
  }

  const { data } = await getAuth().getSession()
  const user = data?.user
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  const stripe = new Stripe(secretKey)
  const baseUrl = appBaseUrl(req)
  const accountKey = String(user.id)
  const metadata = {
    vibecart_product: "app-factory-all-access",
    vibecart_account_key: accountKey,
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: user.email,
    client_reference_id: accountKey,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
    success_url: `${baseUrl}/apps?subscription=success`,
    cancel_url: `${baseUrl}/apps?subscription=cancelled`,
  })

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
