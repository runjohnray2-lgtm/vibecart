import { CatalogSourceError } from "@/lib/catalog-source"
import { cancelCart, createCart, getCart, replaceCartItems, type CartItemInput } from "@/lib/cart-store"
import { mapDurableCartToUcp, type UcpCart } from "@/lib/ucp-cart"

export type UcpCartServiceResult =
  | { kind: "success"; cart: UcpCart }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string }
  | { kind: "unavailable"; retryable: boolean }

export function ucpCartRuntimeConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)
}

function cartItemsFromUcp(value: unknown): CartItemInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("cart is required")
  const cart = value as Record<string, unknown>
  if (!Array.isArray(cart.line_items) || cart.line_items.length === 0) throw new Error("cart.line_items must contain at least one item")

  return cart.line_items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`cart.line_items[${index}] must be an object`)
    const line = raw as Record<string, unknown>
    const item = line.item
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`cart.line_items[${index}].item is required`)
    const productId = (item as Record<string, unknown>).id
    if (typeof productId !== "string" || productId.trim().length === 0) throw new Error(`cart.line_items[${index}].item.id is required`)
    if (typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
      throw new Error(`cart.line_items[${index}].quantity must be a whole number from 1 to 99`)
    }
    return { productId: productId.trim(), quantity: line.quantity }
  })
}

function classifyFailure(error: unknown): UcpCartServiceResult {
  if (error instanceof CatalogSourceError) {
    return { kind: "unavailable", retryable: error.code !== "CATALOG_CONFIG_INVALID" }
  }
  const message = error instanceof Error ? error.message : "Cart operation failed"
  if (message.includes("storage is not configured")) return { kind: "unavailable", retryable: false }
  if (message.includes("Cart version conflict")) return { kind: "unavailable", retryable: true }
  if (message.startsWith("Cart is ")) return { kind: "not_found" }
  return { kind: "invalid", message }
}

function activeOrNotFound(cart: Awaited<ReturnType<typeof getCart>>) {
  return cart && cart.status === "active" ? cart : null
}

export async function createUcpCart(cartInput: unknown, idempotencyKey?: string): Promise<UcpCartServiceResult> {
  let items: CartItemInput[]
  try { items = cartItemsFromUcp(cartInput) } catch (error) { return classifyFailure(error) }

  try {
    const cart = await createCart(items, idempotencyKey)
    return { kind: "success", cart: mapDurableCartToUcp(cart) }
  } catch (error) {
    return classifyFailure(error)
  }
}

export async function getUcpCart(idRaw: string): Promise<UcpCartServiceResult> {
  const id = idRaw.trim()
  if (!id || id.length > 200) return { kind: "invalid", message: "id must be a non-empty string no longer than 200 characters" }

  try {
    const cart = activeOrNotFound(await getCart(id))
    if (!cart) return { kind: "not_found" }
    return { kind: "success", cart: mapDurableCartToUcp(cart) }
  } catch (error) {
    return classifyFailure(error)
  }
}

export async function updateUcpCart(idRaw: string, cartInput: unknown): Promise<UcpCartServiceResult> {
  const id = idRaw.trim()
  if (!id || id.length > 200) return { kind: "invalid", message: "id must be a non-empty string no longer than 200 characters" }

  let items: CartItemInput[]
  try { items = cartItemsFromUcp(cartInput) } catch (error) { return classifyFailure(error) }

  try {
    const cart = activeOrNotFound(await replaceCartItems(id, items))
    if (!cart) return { kind: "not_found" }
    return { kind: "success", cart: mapDurableCartToUcp(cart) }
  } catch (error) {
    return classifyFailure(error)
  }
}

export async function cancelUcpCart(idRaw: string): Promise<UcpCartServiceResult> {
  const id = idRaw.trim()
  if (!id || id.length > 200) return { kind: "invalid", message: "id must be a non-empty string no longer than 200 characters" }

  try {
    const existing = activeOrNotFound(await getCart(id))
    if (!existing) return { kind: "not_found" }

    const responseCart = mapDurableCartToUcp(existing)
    const cancelled = await cancelCart(id)
    if (!cancelled || cancelled.status !== "cancelled") return { kind: "unavailable", retryable: true }
    return { kind: "success", cart: responseCart }
  } catch (error) {
    return classifyFailure(error)
  }
}
