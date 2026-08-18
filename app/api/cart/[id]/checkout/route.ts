import { NextResponse } from "next/server"
import { getCart } from "@/lib/cart-store"
import { POST as checkoutPost } from "@/app/api/checkout/route"

export const runtime = "nodejs"

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const cart = await getCart(id)
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    if (cart.status !== "active") {
      return NextResponse.json({ success: false, code: "CART_NOT_ACTIVE", error: `Cart is ${cart.status}.` }, { status: 409 })
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin
    const checkoutRequest = new Request(`${origin}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        cartId: cart.id,
        items: cart.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
      }),
    })

    return checkoutPost(checkoutRequest)
  } catch (error) {
    console.error("[vibecart cart] checkout handoff failed", error)
    if (error instanceof Error && error.message.includes("storage is not configured")) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    return NextResponse.json({ success: false, code: "CART_CHECKOUT_FAILED", error: "Cart checkout could not be created." }, { status: 500 })
  }
}
