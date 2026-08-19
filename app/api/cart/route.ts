import { NextResponse } from "next/server"
import { createCart, CartItemInput } from "@/lib/cart-store"
import { CatalogSourceError } from "@/lib/catalog-source"
import {
  hostedModeEnabled,
  issueCartAccessToken,
  merchantRequestAuthorized,
  MerchantAuthConfigurationError,
} from "@/lib/merchant-auth"

export const runtime = "nodejs"

interface CreateCartBody {
  items?: CartItemInput[]
}

export async function POST(req: Request) {
  try {
    if (hostedModeEnabled() && !merchantRequestAuthorized(req)) {
      return NextResponse.json(
        { success: false, code: "UNAUTHORIZED", error: "Merchant authentication is required." },
        { status: 401 }
      )
    }

    const body = await req.json() as CreateCartBody
    const idempotencyKey = req.headers.get("idempotency-key") ?? undefined
    const cart = await createCart(body.items ?? [], idempotencyKey)
    const cartAccessToken = issueCartAccessToken(cart.id, cart.merchantId)
    return NextResponse.json(
      { success: true, cart, ...(cartAccessToken ? { cartAccessToken } : {}) },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cart could not be created"
    const configurationError = message.includes("storage is not configured")
    const authConfigurationError = error instanceof MerchantAuthConfigurationError
    const catalogError = error instanceof CatalogSourceError
    console.error("[vibecart cart] create failed", error)
    return NextResponse.json(
      {
        success: false,
        code: authConfigurationError
          ? "MERCHANT_AUTH_NOT_CONFIGURED"
          : configurationError
            ? "CART_STORAGE_NOT_CONFIGURED"
            : catalogError
              ? error.code
              : "INVALID_CART",
        error: authConfigurationError
          ? "Hosted merchant authentication is not configured."
          : configurationError
            ? "Cart storage is not configured."
            : catalogError
              ? "Trusted merchant catalog is unavailable."
              : message,
      },
      { status: authConfigurationError || configurationError || catalogError ? 503 : 400 }
    )
  }
}
