import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getProduct, VibeProduct } from "@/lib/products"

export const runtime = "nodejs"

const MAX_QUANTITY = 99

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

function err(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, error: message }, { status })
}

function validQuantity(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return null
  if (raw < 1 || raw > MAX_QUANTITY) return null
  return raw
}

// Only allow redirecting back to the same origin the request came from by
// default. A merchant CAN pass their own successUrl/cancelUrl, but it must
// be same-origin — this prevents the checkout endpoint from being used as
// an open redirect to an arbitrary external URL.
function safeRedirectUrl(candidate: string | undefined, origin: string, fallbackPath: string): string {
  const fallback = `${origin}${fallbackPath}`
  if (!candidate) return fallback
  try {
    const url = new URL(candidate, origin)
    if (url.origin !== origin) return fallback
    return url.toString()
  } catch {
    return fallback
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CheckoutRequestBody

    if (!body.items || body.items.length === 0) {
      return err("NO_ITEMS", "No items provided", 400)
    }

    const resolved: { product: VibeProduct; quantity: number; trusted: boolean }[] = []

    for (const item of body.items) {
      const quantity = validQuantity(item.quantity)
      if (quantity === null) {
        return err(
          "INVALID_QUANTITY",
          `Quantity must be a whole number between 1 and ${MAX_QUANTITY}, got ${JSON.stringify(item.quantity)}`,
          400
        )
      }

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
          return err("INVALID_INLINE_PRODUCT", "Inline product missing required fields (id, name, priceCents)", 400)
        }
        if (p.image && !isAbsoluteUrl(p.image)) {
          return err(
            "RELATIVE_IMAGE_URL",
            `Product image must be an absolute URL (https://...), got "${p.image}". Stripe cannot use relative paths.`,
            400
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

      return err(
        "UNKNOWN_PRODUCT",
        `Unknown productId "${item.productId ?? "(none)"}" — either register this product in lib/products.ts, or pass full product data with allowInlineProduct: true (see /llms.txt).`,
        400
      )
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin
    const successUrl = safeRedirectUrl(body.successUrl, origin, "/?checkout=success")
    const cancelUrl = safeRedirectUrl(body.cancelUrl, origin, "/?checkout=cancelled")

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
      success_url: successUrl,
      cancel_url: cancelUrl,
    })

    return NextResponse.json({
      success: true,
      mode: "live",
      checkoutUrl: session.url,
    })
  } catch (e) {
    return err("INTERNAL_ERROR", String(e), 500)
  }
}
