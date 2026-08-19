import { NextResponse } from "next/server"
import { cancelCart, CartItemInput, getCart, replaceCartItems } from "@/lib/cart-store"
import { CatalogSourceError } from "@/lib/catalog-source"
import {
  cartRequestAuthorized,
  hostedModeEnabled,
  MerchantAuthConfigurationError,
} from "@/lib/merchant-auth"

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

function catalogFailure(error: unknown) {
  if (!(error instanceof CatalogSourceError)) return null
  return NextResponse.json(
    { success: false, code: error.code, error: "Trusted merchant catalog is unavailable." },
    { status: 503 }
  )
}

function authConfigurationFailure(error: unknown) {
  if (!(error instanceof MerchantAuthConfigurationError)) return null
  console.error("[vibecart cart] hosted auth configuration failed", error)
  return NextResponse.json(
    { success: false, code: "MERCHANT_AUTH_NOT_CONFIGURED", error: "Hosted merchant authentication is not configured." },
    { status: 503 }
  )
}

async function authorize(req: Request, context: { params: Promise<{ id: string }> }) {
  const id = await cartId(context)
  if (hostedModeEnabled() && !cartRequestAuthorized(req, id)) {
    return {
      id,
      response: NextResponse.json(
        { success: false, code: "UNAUTHORIZED", error: "Cart access authorization is required." },
        { status: 401 }
      ),
    }
  }
  return { id, response: null }
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(req, context)
    if (auth.response) return auth.response
    const cart = await getCart(auth.id)
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    return NextResponse.json({ success: true, cart })
  } catch (error) {
    console.error("[vibecart cart] get failed", error)
    const authFailure = authConfigurationFailure(error)
    if (authFailure) return authFailure
    if (isStorageConfigurationError(error)) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    return NextResponse.json({ success: false, code: "CART_READ_FAILED", error: "Cart could not be read." }, { status: 500 })
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(req, context)
    if (auth.response) return auth.response
    const body = await req.json() as UpdateCartBody
    if (!Array.isArray(body.items)) {
      return NextResponse.json({ success: false, code: "INVALID_CART", error: "items is required." }, { status: 400 })
    }
    const cart = await replaceCartItems(auth.id, body.items, body.version)
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    return NextResponse.json({ success: true, cart })
  } catch (error) {
    const authFailure = authConfigurationFailure(error)
    if (authFailure) return authFailure
    if (isStorageConfigurationError(error)) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    const catalog = catalogFailure(error)
    if (catalog) return catalog
    const message = error instanceof Error ? error.message : "Cart could not be updated"
    const conflict = message === "Cart version conflict"
    return NextResponse.json(
      { success: false, code: conflict ? "CART_VERSION_CONFLICT" : "INVALID_CART", error: message },
      { status: conflict ? 409 : 400 }
    )
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(req, context)
    if (auth.response) return auth.response
    const cart = await cancelCart(auth.id)
    if (!cart) return NextResponse.json({ success: false, code: "CART_NOT_FOUND", error: "Cart not found." }, { status: 404 })
    return NextResponse.json({ success: true, cart })
  } catch (error) {
    console.error("[vibecart cart] cancel failed", error)
    const authFailure = authConfigurationFailure(error)
    if (authFailure) return authFailure
    if (isStorageConfigurationError(error)) {
      return NextResponse.json({ success: false, code: "CART_STORAGE_NOT_CONFIGURED", error: "Cart storage is not configured." }, { status: 503 })
    }
    return NextResponse.json({ success: false, code: "CART_CANCEL_FAILED", error: "Cart could not be cancelled." }, { status: 500 })
  }
}
