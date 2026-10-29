import { randomUUID } from "node:crypto"
import { createCart, type CartItemInput, type VibeCart } from "@/lib/cart-store"
import { getCatalogProduct } from "@/lib/catalog-source"
import { issueCartAccessToken } from "@/lib/merchant-auth"
import { assertSalesCompatibility, SalesAssistantInputError } from "@/lib/sales-assistant"

const MAX_SESSION_ID = 120
const MAX_CHANNEL = 80
const MAX_QUERY = 500
const SESSION_ID_PATTERN = /^sales_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class SalespersonDisabledError extends Error {
  constructor() {
    super("AI salesperson is not enabled for this merchant")
    this.name = "SalespersonDisabledError"
  }
}

export interface SalesCartInput {
  items: CartItemInput[]
  idempotencyKey: string
  salesSessionId: string
  channel?: string
  query?: string
  compatibility?: Record<string, string>
}

export interface SalesCartResult {
  cart: VibeCart
  cartAccessToken: string | null
}

export function aiSalespersonEnabled(): boolean {
  return process.env.VIBECART_AI_SALESPERSON_ENABLED?.trim().toLowerCase() === "true"
}

export function newSalesSessionId(): string {
  return `sales_${randomUUID()}`
}

export function normalizeSalesSessionId(value: unknown): string {
  if (typeof value !== "string") throw new SalesAssistantInputError("salesSessionId is required")
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_SESSION_ID || !SESSION_ID_PATTERN.test(normalized)) {
    throw new SalesAssistantInputError("salesSessionId must be a VibeCart sales session identifier")
  }
  return normalized
}

function boundedString(value: unknown, name: string, max: number, fallback = ""): string {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value !== "string") throw new SalesAssistantInputError(`${name} must be a string`)
  const normalized = value.trim()
  if (!normalized || normalized.length > max) {
    throw new SalesAssistantInputError(`${name} must be 1-${max} characters`)
  }
  return normalized
}

function idempotencyKey(value: unknown): string {
  const normalized = boundedString(value, "idempotencyKey", 200)
  if (normalized.length < 8) throw new SalesAssistantInputError("idempotencyKey must be at least 8 characters")
  return normalized
}

function attributionMetadata(input: {
  salesSessionId: string
  channel: string
  query: string
  compatibility: Record<string, string>
}) {
  const metadata: Record<string, string> = {
    "vibecart.sales.source": "ai-salesperson",
    "vibecart.sales.session": input.salesSessionId,
    "vibecart.sales.channel": input.channel,
  }
  if (input.query) metadata["vibecart.sales.query"] = input.query
  const compatibility = JSON.stringify(input.compatibility)
  if (compatibility !== "{}" && compatibility.length <= 500) {
    metadata["vibecart.sales.compatibility"] = compatibility
  }
  return metadata
}

export async function createAttributedSalesCart(input: SalesCartInput): Promise<SalesCartResult> {
  if (!aiSalespersonEnabled()) throw new SalespersonDisabledError()

  const salesSessionId = normalizeSalesSessionId(input.salesSessionId)
  const key = idempotencyKey(input.idempotencyKey)
  const channel = boundedString(input.channel, "channel", MAX_CHANNEL, "mcp")
  const query = boundedString(input.query, "query", MAX_QUERY, "")
  const compatibility = input.compatibility ?? {}

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new SalesAssistantInputError("items must contain at least one trusted product")
  }

  for (const line of input.items) {
    if (!line || typeof line.productId !== "string" || !line.productId.trim()) {
      throw new SalesAssistantInputError("Each sales cart item requires productId")
    }
    const product = await getCatalogProduct(line.productId.trim())
    if (!product) throw new SalesAssistantInputError(`Unknown productId "${line.productId}"`)
    if (product.availability === "out_of_stock") {
      throw new SalesAssistantInputError(`Product ${product.id} is out of stock`)
    }
    assertSalesCompatibility(product, compatibility)
  }

  const cart = await createCart(
    input.items,
    key,
    undefined,
    attributionMetadata({ salesSessionId, channel, query, compatibility })
  )

  return {
    cart,
    cartAccessToken: issueCartAccessToken(cart.id, cart.merchantId),
  }
}
