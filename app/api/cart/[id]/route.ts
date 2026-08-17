import { NextResponse } from "next/server"
import { cancelCart, CartItemInput, getCart, replaceCartItems } from "@/lib/cart-store"

export const runtime = "nodejs"

interface UpdateCartBody {
  items?: CartItemInput[]
  version?: number
}

async function cartId(context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  return params.id
}

function isStorageConfigurationError(error: unknown) {
  return error instanceof Error && error.message.includes("storage is not configured")
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const cart = await getCart(await cartId(context))
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    return NextResponse.json({ success: true, cart })
  } catch (error) {
    console.error("[vibecart cart] get failed", error)
    if (isStorageConfigurationError(error)) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    return NextResponse.json({ success: false, code: "CART_READ_FAILED", error: "Cart could not be read." }, { status: 500 })
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await req.json() as UpdateCartBody
    if (!Array.isArray(body.items)) {
      return NextResponse.json({ success: false, code: "INVALID_CART", error: "items is required." }, { status: 400 })
    }
    const cart = await replaceCartItems(await cartId(context), body.items, body.version)
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    return NextResponse.json({ success: true, cart })
  } catch (error) {
    if (isStorageConfigurationError(error)) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    const message = error instanceof Error ? error.message : "Cart could not be updated"
    const conflict = message === "Cart version conflict"
    return NextResponse.json(
      { success: false, code: conflict ? "CART_VERSION_CONFLICT" : "INVALID_CART", error: message },
      { status: conflict ? 409 : 400 }
    )
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const cart = await cancelCart(await cartId(context))
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    return NextResponse.json({ success: true, cart })
  } catch (error) {
    console.error("[vibecart cart] cancel failed", error)
    if (isStorageConfigurationError(error)) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    return NextResponse.json({ success: false, code: "CART_CANCEL_FAILED", error: "Cart could not be cancelled." }, { status: 500 })
  }
}
