import Stripe from "stripe"
import { POST as checkoutPost } from "@/app/api/checkout/route"

export const dynamic = "force-dynamic"

export default async function CheckoutProbePage() {
  const origin = "https://vibecart.vercel.app"
  const req = new Request(`${origin}/api/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": "127.0.0.77",
    },
    body: JSON.stringify({
      items: [{ productId: "sticker-pack-nw", quantity: 1 }],
    }),
  })

  const response = await checkoutPost(req)
  const data = await response.json() as Record<string, unknown>
  let expired = false
  let expireError: string | null = null

  if (data.success === true && typeof data.checkoutSessionId === "string" && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
      await stripe.checkout.sessions.expire(data.checkoutSessionId)
      expired = true
    } catch (error) {
      expireError = error instanceof Error ? error.message : "expire failed"
    }
  }

  const safe = {
    httpStatus: response.status,
    success: data.success,
    mode: data.mode,
    code: data.code,
    error: data.error,
    checkoutSessionId: data.checkoutSessionId,
    checkoutUrlCreated: typeof data.checkoutUrl === "string" && data.checkoutUrl.length > 0,
    expired,
    expireError,
  }

  return (
    <main style={{ padding: 32, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
      {JSON.stringify(safe, null, 2)}
    </main>
  )
}
