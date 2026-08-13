import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getProduct } from "@/lib/products"

export const runtime = "nodejs"

interface CheckoutRequestBody {
  items: { productId: string; quantity: number }[]
  successUrl?: string
  cancelUrl?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CheckoutRequestBody

    if (!body.items || body.items.length === 0) {
      return NextResponse.json({ success: false, error: "No items provided" }, { status: 400 })
    }

    const resolved = body.items.map(item => {
      const product = getProduct(item.productId)
      if (!product) throw new Error(`Unknown productId: ${item.productId}`)
      return { product, quantity: Math.max(1, item.quantity) }
    })

    const secretKey = process.env.STRIPE_SECRET_KEY

    // DEMO MODE — no Stripe key configured. Returns a fake session so the
    // integration can be tested end-to-end before a merchant connects a real
    // Stripe account. Clearly labeled, never silently pretends to be real.
    if (!secretKey) {
      const total = resolved.reduce((sum, r) => sum + r.product.priceCents * r.quantity, 0)
      return NextResponse.json({
        success: true,
        mode: "demo",
        checkoutUrl: null,
        message: `[DEMO MODE — no Stripe key configured] Would charge $${(total / 100).toFixed(2)} for ${resolved.length} item(s). Add STRIPE_SECRET_KEY to go live.`,
        totalCents: total,
      })
    }

    const stripe = new Stripe(secretKey)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: resolved.map(r => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: r.product.name,
            description: r.product.description,
            images: [r.product.image],
          },
          unit_amount: r.product.priceCents,
        },
        quantity: r.quantity,
      })),
      success_url: body.successUrl ?? `${req.headers.get("origin")}/?checkout=success`,
      cancel_url: body.cancelUrl ?? `${req.headers.get("origin")}/?checkout=cancelled`,
    })

    return NextResponse.json({
      success: true,
      mode: "live",
      checkoutUrl: session.url,
    })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
