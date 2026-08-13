import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getProduct, VibeProduct } from "@/lib/products"

export const runtime = "nodejs"

interface InlineProduct {
  id: string
  name: string
  description?: string
  priceCents: number
  image?: string
  variant?: string
}

interface CheckoutItem {
  productId?: string
  product?: InlineProduct
  quantity: number
}

interface CheckoutRequestBody {
  items: CheckoutItem[]
  // Explicit opt-in required to trust a client-supplied price. Without this,
  // inline `product` data is rejected unless it matches a catalog entry —
  // this exists specifically so a naive integration can't let a visitor set
  // their own price by editing the request in devtools.
  allowInlineProduct?: boolean
  successUrl?: string
  cancelUrl?: string
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function displayName(product: VibeProduct): string {
  return product.variant ? `${product.name} (${product.variant})` : product.name
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CheckoutRequestBody

    if (!body.items || body.items.length === 0) {
      return NextResponse.json({ success: false, error: "No items provided" }, { status: 400 })
    }

    const resolved: { product: VibeProduct; quantity: number; trusted: boolean }[] = []

    for (const item of body.items) {
      const quantity = Math.max(1, item.quantity)

      // 1. Prefer a known, server-side catalog product — always trusted,
      //    price cannot be tampered with by the client.
      if (item.productId) {
        const catalogProduct = getProduct(item.productId)
        if (catalogProduct) {
          resolved.push({ product: catalogProduct, quantity, trusted: true })
          continue
        }
      }

      // 2. Fall back to client-supplied inline product data — only if the
      //    caller explicitly opted in. This exists for the common
      //    "AI agent added a new product but didn't register it in the
      //    catalog" case, but it means the price came from the browser and
      //    could have been edited before the request was sent. Fine for
      //    prototypes/demos. NOT safe for a real store without your own
      //    server-side price validation.
      if (item.product && body.allowInlineProduct) {
        const p = item.product
        if (!p.id || !p.name || typeof p.priceCents !== "number") {
          return NextResponse.json(
            { success: false, error: "Inline product missing required fields (id, name, priceCents)" },
            { status: 400 }
          )
        }
        if (p.image && !isAbsoluteUrl(p.image)) {
          return NextResponse.json(
            {
              success: false,
              error: `Product image must be an absolute URL (https://...), got "${p.image}". Stripe cannot use relative paths.`,
            },
            { status: 400 }
          )
        }
        resolved.push({
          product: {
            id: p.id,
            name: p.name,
            description: p.description ?? "",
            priceCents: p.priceCents,
            image: p.image ?? "",
            variant: p.variant,
          },
          quantity,
          trusted: false,
        })
        continue
      }

      return NextResponse.json(
        {
          success: false,
          error: `Unknown productId "${item.productId ?? "(none)"}" — either register this product in lib/products.ts, or pass full product data with allowInlineProduct: true (see /llms.txt).`,
        },
        { status: 400 }
      )
    }

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
        untrustedPricing: resolved.some(r => !r.trusted),
      })
    }

    const stripe = new Stripe(secretKey)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: resolved.map(r => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: displayName(r.product),
            description: r.product.description,
            images: r.product.image ? [r.product.image] : [],
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
