import { neon } from "@neondatabase/serverless"
import { getCatalogProduct } from "@/lib/catalog-source"
import { configuredMerchantId } from "@/lib/merchant-auth"

const CART_TTL_MS = 24 * 60 * 60 * 1000
const MAX_QUANTITY = 99
const MAX_IDEMPOTENCY_KEY_LENGTH = 200
const MAX_METADATA_ENTRIES = 20
const MAX_METADATA_KEY_LENGTH = 40
const MAX_METADATA_VALUE_LENGTH = 500
const MAX_METADATA_TOTAL_LENGTH = 5_000
const METADATA_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/

export interface CartItemInput {
  productId: string
  quantity: number
}

export interface CartLine {
  productId: string
  name: string
  description: string
  image: string
  variant?: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type CartMetadata = Record<string, string>

export interface VibeCart {
  id: string
  merchantId: string
  status: "active" | "cancelled" | "converted" | "expired"
  currency: string
  items: CartLine[]
  metadata: CartMetadata
  subtotalCents: number
  version: number
  checkoutSessionId?: string
  expiresAt: string
  createdAt: string
  updatedAt: string
}

type CartRow = {
  id: string
  merchant_id: string
  status: VibeCart["status"]
  currency: string
  items: CartLine[] | string
  metadata: CartMetadata | string | null
  subtotal_cents: number
  version: number
  checkout_session_id?: string | null
  expires_at: string | Date
  created_at: string | Date
  updated_at: string | Date
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("VibeCart cart storage is not configured")
  return value
}

function sql() {
  return neon(databaseUrl())
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapRow(row: CartRow): VibeCart {
  const items = typeof row.items === "string" ? JSON.parse(row.items) as CartLine[] : row.items
  const metadata = typeof row.metadata === "string"
    ? JSON.parse(row.metadata) as CartMetadata
    : row.metadata ?? {}
  return {
    id: row.id,
    merchantId: row.merchant_id,
    status: row.status,
    currency: row.currency,
    items,
    metadata,
    subtotalCents: Number(row.subtotal_cents),
    version: Number(row.version),
    ...(row.checkout_session_id ? { checkoutSessionId: row.checkout_session_id } : {}),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export function normalizeCartMetadata(value: unknown): CartMetadata {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cart metadata must be an object")
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw new Error(`Cart metadata cannot exceed ${MAX_METADATA_ENTRIES} entries`)
  }

  const metadata: CartMetadata = {}
  let totalLength = 0
  for (const [key, entryValue] of entries) {
    if (!key || key.length > MAX_METADATA_KEY_LENGTH || !METADATA_KEY_PATTERN.test(key)) {
      throw new Error(`Cart metadata keys must be 1-${MAX_METADATA_KEY_LENGTH} letters, numbers, dots, colons, underscores, or dashes`)
    }
    if (typeof entryValue !== "string" || entryValue.length > MAX_METADATA_VALUE_LENGTH) {
      throw new Error(`Cart metadata values must be strings up to ${MAX_METADATA_VALUE_LENGTH} characters`)
    }
    totalLength += key.length + entryValue.length
    if (totalLength > MAX_METADATA_TOTAL_LENGTH) {
      throw new Error(`Cart metadata cannot exceed ${MAX_METADATA_TOTAL_LENGTH} total characters`)
    }
    metadata[key] = entryValue
  }
  return metadata
}

function normalizeIdempotencyKey(value?: string): string | undefined {
  if (value === undefined) return undefined
  const key = value.trim()
  if (!key) return undefined
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error(`Idempotency key cannot exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
  }
  return key
}

export async function resolveCartItems(input: CartItemInput[]): Promise<CartLine[]> {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Cart requires at least one item")

  const combined = new Map<string, number>()
  for (const item of input) {
    if (!item || typeof item.productId !== "string" || item.productId.length === 0) {
      throw new Error("Each cart item requires productId")
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw new Error(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}`)
    }
    const next = (combined.get(item.productId) ?? 0) + item.quantity
    if (next > MAX_QUANTITY) throw new Error(`Combined quantity for ${item.productId} exceeds ${MAX_QUANTITY}`)
    combined.set(item.productId, next)
  }

  const lines: CartLine[] = []
  for (const [productId, quantity] of combined.entries()) {
    const product = await getCatalogProduct(productId)
    if (!product) throw new Error(`Unknown productId "${productId}"`)
    lines.push({
      productId,
      name: product.name,
      description: product.description,
      image: product.image,
      variant: product.variant,
      quantity,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * quantity,
    })
  }
  return lines
}

export async function createCart(
  itemsInput: CartItemInput[],
  idempotencyKey?: string,
  merchantId = configuredMerchantId(),
  metadataInput: unknown = {}
): Promise<VibeCart> {
  const db = sql()
  const items = await resolveCartItems(itemsInput)
  const subtotal = items.reduce((sum, item) => sum + item.lineTotalCents, 0)
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + CART_TTL_MS).toISOString()
  const itemsJson = JSON.stringify(items)
  const metadataJson = JSON.stringify(normalizeCartMetadata(metadataInput))
  const key = normalizeIdempotencyKey(idempotencyKey)

  if (key) {
    const rows = await db`
      INSERT INTO vibecart_carts (id, merchant_id, status, currency, items, metadata, subtotal_cents, version, idempotency_key, expires_at)
      VALUES (${id}, ${merchantId}, 'active', 'usd', ${itemsJson}::jsonb, ${metadataJson}::jsonb, ${subtotal}, 1, ${key}, ${expiresAt})
      ON CONFLICT (merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *
    `
    if (rows[0]) return mapRow(rows[0] as CartRow)

    const existing = await db`
      SELECT * FROM vibecart_carts
      WHERE merchant_id = ${merchantId} AND idempotency_key = ${key}
      LIMIT 1
    `
    if (existing[0]) return mapRow(existing[0] as CartRow)
    throw new Error("Cart could not be created")
  }

  const rows = await db`
    INSERT INTO vibecart_carts (id, merchant_id, status, currency, items, metadata, subtotal_cents, version, expires_at)
    VALUES (${id}, ${merchantId}, 'active', 'usd', ${itemsJson}::jsonb, ${metadataJson}::jsonb, ${subtotal}, 1, ${expiresAt})
    RETURNING *
  `
  return mapRow(rows[0] as CartRow)
}

export async function getCart(id: string, merchantId = configuredMerchantId()): Promise<VibeCart | null> {
  const db = sql()
  const rows = await db`
    SELECT * FROM vibecart_carts
    WHERE id = ${id} AND merchant_id = ${merchantId}
    LIMIT 1
  `
  if (!rows[0]) return null
  const cart = mapRow(rows[0] as CartRow)
  if (cart.status === "active" && Date.parse(cart.expiresAt) <= Date.now()) {
    const expired = await db`
      UPDATE vibecart_carts
      SET status = 'expired', version = version + 1, updated_at = now()
      WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'active'
      RETURNING *
    `
    if (expired[0]) return mapRow(expired[0] as CartRow)

    const current = await db`
      SELECT * FROM vibecart_carts
      WHERE id = ${id} AND merchant_id = ${merchantId}
      LIMIT 1
    `
    return current[0] ? mapRow(current[0] as CartRow) : null
  }
  return cart
}

export async function replaceCartItems(
  id: string,
  itemsInput: CartItemInput[],
  expectedVersion?: number,
  merchantId = configuredMerchantId()
): Promise<VibeCart | null> {
  const existing = await getCart(id, merchantId)
  if (!existing) return null
  if (existing.status !== "active") throw new Error(`Cart is ${existing.status}`)
  if (expectedVersion !== undefined && existing.version !== expectedVersion) throw new Error("Cart version conflict")

  const items = await resolveCartItems(itemsInput)
  const subtotal = items.reduce((sum, item) => sum + item.lineTotalCents, 0)
  const itemsJson = JSON.stringify(items)
  const db = sql()
  const rows = expectedVersion === undefined
    ? await db`
        UPDATE vibecart_carts
        SET items = ${itemsJson}::jsonb, subtotal_cents = ${subtotal}, version = version + 1, updated_at = now()
        WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'active'
        RETURNING *
      `
    : await db`
        UPDATE vibecart_carts
        SET items = ${itemsJson}::jsonb, subtotal_cents = ${subtotal}, version = version + 1, updated_at = now()
        WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'active' AND version = ${expectedVersion}
        RETURNING *
      `

  if (!rows[0] && expectedVersion !== undefined) throw new Error("Cart version conflict")
  return rows[0] ? mapRow(rows[0] as CartRow) : null
}

export async function cancelCart(id: string, merchantId = configuredMerchantId()): Promise<VibeCart | null> {
  const db = sql()
  const rows = await db`
    UPDATE vibecart_carts
    SET status = 'cancelled', version = version + 1, updated_at = now()
    WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'active' AND expires_at > now()
    RETURNING *
  `
  if (rows[0]) return mapRow(rows[0] as CartRow)
  return getCart(id, merchantId)
}

export async function markCartConverted(
  id: string,
  checkoutSessionId: string,
  merchantId = configuredMerchantId()
): Promise<VibeCart | null> {
  const db = sql()
  const rows = await db`
    UPDATE vibecart_carts
    SET status = 'converted', checkout_session_id = ${checkoutSessionId}, version = version + 1, updated_at = now()
    WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'active' AND expires_at > now()
    RETURNING *
  `
  if (rows[0]) return mapRow(rows[0] as CartRow)
  return getCart(id, merchantId)
}
