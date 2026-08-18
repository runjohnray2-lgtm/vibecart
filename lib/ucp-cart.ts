import type { CartLine, VibeCart } from "@/lib/cart-store"

export const UCP_CART_VERSION = "2026-04-08"
export const UCP_CART_CAPABILITY = "dev.ucp.shopping.cart"

export interface UcpCartTotal {
  type: "subtotal" | "total"
  amount: number
}

export interface UcpCartLineItem {
  id: string
  item: {
    id: string
    title: string
    price: number
  }
  quantity: number
  totals: UcpCartTotal[]
}

export interface UcpCart {
  ucp: {
    version: typeof UCP_CART_VERSION
    status: "success"
    capabilities: {
      [UCP_CART_CAPABILITY]: Array<{ version: typeof UCP_CART_VERSION }>
    }
  }
  id: string
  line_items: UcpCartLineItem[]
  currency: string
  totals: UcpCartTotal[]
  expires_at: string
}

function requireMinorUnits(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer in minor currency units`)
  }
  return value
}

function mapLine(line: CartLine): UcpCartLineItem {
  const productId = line.productId.trim()
  if (!productId) throw new Error("Cart line is missing merchant product identity")
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error(`Cart line ${productId} has invalid quantity`)

  const unitPrice = requireMinorUnits(line.unitPriceCents, `Cart line ${productId} unit price`)
  const lineTotal = requireMinorUnits(line.lineTotalCents, `Cart line ${productId} total`)
  if (unitPrice * line.quantity !== lineTotal) throw new Error(`Cart line ${productId} total does not match trusted unit price and quantity`)

  return {
    id: productId,
    item: {
      id: productId,
      title: line.variant ? `${line.name} (${line.variant})` : line.name,
      price: unitPrice,
    },
    quantity: line.quantity,
    totals: [
      { type: "subtotal", amount: lineTotal },
      { type: "total", amount: lineTotal },
    ],
  }
}

export function mapDurableCartToUcp(cart: VibeCart): UcpCart {
  if (cart.status !== "active") throw new Error(`Only active carts can be represented as UCP cart state; received ${cart.status}`)
  if (!cart.id.trim()) throw new Error("Durable cart is missing cart identity")
  if (!cart.currency.trim()) throw new Error("Durable cart is missing currency")
  if (cart.items.length === 0) throw new Error("Durable cart has no line items")

  const expiresAt = new Date(cart.expiresAt)
  if (!Number.isFinite(expiresAt.getTime())) throw new Error("Durable cart has invalid expiration")
  if (expiresAt.getTime() <= Date.now()) throw new Error("Expired durable cart cannot be represented as active UCP cart state")

  const lineItems = cart.items.map(mapLine)
  const subtotal = requireMinorUnits(cart.subtotalCents, "Cart subtotal")
  const calculatedSubtotal = lineItems.reduce((sum, line) => sum + line.totals[line.totals.length - 1].amount, 0)
  if (subtotal !== calculatedSubtotal) throw new Error("Cart subtotal does not match trusted line totals")

  return {
    ucp: {
      version: UCP_CART_VERSION,
      status: "success",
      capabilities: {
        [UCP_CART_CAPABILITY]: [{ version: UCP_CART_VERSION }],
      },
    },
    id: cart.id,
    line_items: lineItems,
    currency: cart.currency.toUpperCase(),
    totals: [
      { type: "subtotal", amount: subtotal },
      { type: "total", amount: subtotal },
    ],
    expires_at: expiresAt.toISOString(),
  }
}
