import { NextResponse } from "next/server"
import { POST as createCartRoute } from "@/app/api/cart/route"
import { DELETE as cancelCartRoute, GET as getCartRoute, PATCH as updateCartRoute } from "@/app/api/cart/[id]/route"
import { POST as checkoutCartRoute } from "@/app/api/cart/[id]/checkout/route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CartPayload = {
  success?: boolean
  code?: string
  cart?: {
    id: string
    version: number
    status: string
    subtotalCents: number
  }
}

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>
}

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 })
  }

  let cartId: string | null = null
  const checks: Record<string, unknown> = {}

  try {
    const origin = new URL(req.url).origin
    const idempotencyKey = `preview-self-test-${crypto.randomUUID()}`

    const createResponse = await createCartRoute(new Request(`${origin}/api/cart`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        items: [
          { productId: "sticker-pack-nw", quantity: 1 },
          { productId: "shirt-custom-dtf", quantity: 2 },
        ],
      }),
    }))
    const created = await createResponse.json() as CartPayload
    if (createResponse.status !== 201 || created.success !== true || !created.cart?.id) {
      throw new Error(`create failed (${createResponse.status}): ${JSON.stringify(created)}`)
    }
    cartId = created.cart.id
    checks.create = { status: createResponse.status, subtotalCents: created.cart.subtotalCents, version: created.cart.version }

    const getResponse = await getCartRoute(new Request(`${origin}/api/cart/${cartId}`), context(cartId))
    const got = await getResponse.json() as CartPayload
    if (!getResponse.ok || got.success !== true || got.cart?.id !== cartId) {
      throw new Error(`read failed (${getResponse.status}): ${JSON.stringify(got)}`)
    }
    checks.read = { status: getResponse.status, version: got.cart.version }

    const updateResponse = await updateCartRoute(new Request(`${origin}/api/cart/${cartId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: created.cart.version,
        items: [
          { productId: "led-plate-frame", quantity: 1 },
          { productId: "sticker-pack-nw", quantity: 2 },
        ],
      }),
    }), context(cartId))
    const updated = await updateResponse.json() as CartPayload
    if (!updateResponse.ok || updated.success !== true || !updated.cart || updated.cart.version !== created.cart.version + 1) {
      throw new Error(`update failed (${updateResponse.status}): ${JSON.stringify(updated)}`)
    }
    checks.update = { status: updateResponse.status, subtotalCents: updated.cart.subtotalCents, version: updated.cart.version }

    const staleResponse = await updateCartRoute(new Request(`${origin}/api/cart/${cartId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: created.cart.version,
        items: [{ productId: "sticker-pack-nw", quantity: 1 }],
      }),
    }), context(cartId))
    const stale = await staleResponse.json() as CartPayload
    if (staleResponse.status !== 409 || stale.code !== "CART_VERSION_CONFLICT") {
      throw new Error(`stale-version guard failed (${staleResponse.status}): ${JSON.stringify(stale)}`)
    }
    checks.staleVersion = { status: staleResponse.status, code: stale.code }

    const checkoutResponse = await checkoutCartRoute(new Request(`${origin}/api/cart/${cartId}/checkout`, {
      method: "POST",
      headers: { origin },
    }), context(cartId))
    const checkout = await readJson(checkoutResponse)
    if (!checkoutResponse.ok || checkout.success !== true) {
      throw new Error(`checkout handoff failed (${checkoutResponse.status}): ${JSON.stringify(checkout)}`)
    }
    checks.checkout = {
      status: checkoutResponse.status,
      mode: checkout.mode,
      hasCheckoutUrl: typeof checkout.checkoutUrl === "string" && checkout.checkoutUrl.length > 0,
    }

    const cancelResponse = await cancelCartRoute(new Request(`${origin}/api/cart/${cartId}`, { method: "DELETE" }), context(cartId))
    const cancelled = await cancelResponse.json() as CartPayload
    if (!cancelResponse.ok || cancelled.success !== true || cancelled.cart?.status !== "cancelled") {
      throw new Error(`cancel failed (${cancelResponse.status}): ${JSON.stringify(cancelled)}`)
    }
    checks.cancel = { status: cancelResponse.status, state: cancelled.cart.status, version: cancelled.cart.version }

    return NextResponse.json({ success: true, cartId, checks })
  } catch (error) {
    if (cartId) {
      try {
        const origin = new URL(req.url).origin
        await cancelCartRoute(new Request(`${origin}/api/cart/${cartId}`, { method: "DELETE" }), context(cartId))
      } catch {
        // Best-effort cleanup only.
      }
    }
    console.error("[vibecart self-test] failed", error)
    return NextResponse.json({ success: false, cartId, checks, error: error instanceof Error ? error.message : "self-test failed" }, { status: 500 })
  }
}
