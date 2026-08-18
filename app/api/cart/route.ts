import { NextResponse } from "next/server"
import { createCart, CartItemInput } from "@/lib/cart-store"
import { CatalogSourceError } from "@/lib/catalog-source"

export const runtime = "nodejs"

interface CreateCartBody {
  items?: CartItemInput[]
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as CreateCartBody
    const idempotencyKey = req.headers.get("idempotency-key") ?? undefined
    const cart = await createCart(body.items ?? [], idempotencyKey)
    return NextResponse.json({ success: true, cart }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cart could not be created"
    const configurationError = message.includes("storage is not configured")
    const catalogError = error instanceof CatalogSourceError
    console.error("[vibecart cart] create failed", error)
    return NextResponse.json(
      {
        success: false,
        code: configurationError ? "CART_STORAGE_NOT_CONFIGURED" : catalogError ? error.code : "INVALID_CART",
        error: configurationError
          ? "Cart storage is not configured."
          : catalogError
            ? "Trusted merchant catalog is unavailable."
            : message,
      },
      { status: configurationError || catalogError ? 503 : 400 }
    )
  }
}
