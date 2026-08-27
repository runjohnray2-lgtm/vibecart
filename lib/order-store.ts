import { createHash, randomUUID } from "node:crypto"
import { neon } from "@neondatabase/serverless"
import type { NormalizedOrder, NormalizedOrderLine } from "@/lib/orders"

export type FulfillmentStatus = "new" | "packing" | "shipped" | "cancelled" | "refunded"

export interface StoredOrder extends NormalizedOrder {
  id: string
  orderId: string
  merchantId: string
  eventId: string
  status: "paid"
  fulfillmentStatus: FulfillmentStatus
  metadata: Record<string, string>
  createdAt: string
  updatedAt: string
}

type OrderRow = {
  id: string
  merchant_id: string
  event_id: string
  checkout_session_id: string
  cart_id: string
  stripe_payment_intent_id: string
  customer_email: string
  customer_name: string
  customer_phone: string
  shipping_name: string
  shipping_line1: string
  shipping_line2: string
  shipping_city: string
  shipping_state: string
  shipping_postal_code: string
  shipping_country: string
  amount_subtotal: number | null
  amount_shipping: number
  amount_tax: number
  amount_total: number | null
  currency: string
  payment_status: string
  fulfillment_status: FulfillmentStatus
  metadata: Record<string, string> | string
  created_at: string | Date
  updated_at: string | Date
}

type LineRow = {
  line_item_id: string
  product_id: string
  description: string
  quantity: number
  unit_amount: number | null
  amount_subtotal: number
  amount_discount: number
  amount_tax: number
  amount_total: number
  currency: string
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("VibeCart order storage is not configured")
  return value
}

function sql() {
  return neon(databaseUrl())
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function orderId(checkoutSessionId: string): string {
  const digest = createHash("sha256").update(checkoutSessionId, "utf8").digest("hex").slice(0, 24)
  return `ord_${digest}`
}

function mapLine(row: LineRow): NormalizedOrderLine {
  return {
    lineItemId: row.line_item_id,
    productId: row.product_id,
    description: row.description,
    quantity: Number(row.quantity),
    unitAmount: row.unit_amount === null ? null : Number(row.unit_amount),
    amountSubtotal: Number(row.amount_subtotal),
    amountDiscount: Number(row.amount_discount),
    amountTax: Number(row.amount_tax),
    amountTotal: Number(row.amount_total),
    currency: row.currency,
  }
}

function mapOrder(row: OrderRow, lines: NormalizedOrderLine[]): StoredOrder {
  const metadata = typeof row.metadata === "string"
    ? JSON.parse(row.metadata) as Record<string, string>
    : row.metadata
  return {
    id: row.id,
    orderId: row.id,
    merchantId: row.merchant_id,
    eventId: row.event_id,
    status: "paid",
    checkoutSessionId: row.checkout_session_id,
    cartId: row.cart_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    shipping: {
      name: row.shipping_name,
      line1: row.shipping_line1,
      line2: row.shipping_line2,
      city: row.shipping_city,
      state: row.shipping_state,
      postalCode: row.shipping_postal_code,
      country: row.shipping_country,
    },
    amountSubtotal: row.amount_subtotal === null ? null : Number(row.amount_subtotal),
    amountShipping: Number(row.amount_shipping),
    amountTax: Number(row.amount_tax),
    amountTotal: row.amount_total === null ? null : Number(row.amount_total),
    currency: row.currency,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    metadata,
    lines,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

async function linesForOrder(id: string): Promise<NormalizedOrderLine[]> {
  const rows = await sql()`
    SELECT line_item_id, product_id, description, quantity, unit_amount,
           amount_subtotal, amount_discount, amount_tax, amount_total, currency
    FROM vibecart_order_lines
    WHERE order_id = ${id}
    ORDER BY line_item_id
  `
  return rows.map(row => mapLine(row as LineRow))
}

export async function storeVerifiedOrder(input: {
  eventId: string
  merchantId: string
  order: NormalizedOrder
  metadata: Record<string, string>
}): Promise<StoredOrder> {
  const db = sql()
  const { eventId, merchantId, order, metadata } = input
  const id = orderId(order.checkoutSessionId)
  const metadataJson = JSON.stringify(metadata)
  const rows = await db`
    INSERT INTO vibecart_orders (
      id, merchant_id, event_id, checkout_session_id, cart_id, stripe_payment_intent_id,
      customer_email, customer_name, customer_phone,
      shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_state,
      shipping_postal_code, shipping_country, amount_subtotal, amount_shipping, amount_tax,
      amount_total, currency, payment_status, fulfillment_status, metadata
    ) VALUES (
      ${id}, ${merchantId}, ${eventId}, ${order.checkoutSessionId}, ${order.cartId}, ${order.stripePaymentIntentId},
      ${order.customerEmail}, ${order.customerName}, ${order.customerPhone},
      ${order.shipping.name}, ${order.shipping.line1}, ${order.shipping.line2}, ${order.shipping.city}, ${order.shipping.state},
      ${order.shipping.postalCode}, ${order.shipping.country}, ${order.amountSubtotal}, ${order.amountShipping}, ${order.amountTax},
      ${order.amountTotal}, ${order.currency}, ${order.paymentStatus}, 'new', ${metadataJson}::jsonb
    )
    ON CONFLICT (checkout_session_id) DO UPDATE SET
      payment_status = EXCLUDED.payment_status,
      customer_email = EXCLUDED.customer_email,
      customer_name = EXCLUDED.customer_name,
      customer_phone = EXCLUDED.customer_phone,
      shipping_name = EXCLUDED.shipping_name,
      shipping_line1 = EXCLUDED.shipping_line1,
      shipping_line2 = EXCLUDED.shipping_line2,
      shipping_city = EXCLUDED.shipping_city,
      shipping_state = EXCLUDED.shipping_state,
      shipping_postal_code = EXCLUDED.shipping_postal_code,
      shipping_country = EXCLUDED.shipping_country,
      amount_subtotal = EXCLUDED.amount_subtotal,
      amount_shipping = EXCLUDED.amount_shipping,
      amount_tax = EXCLUDED.amount_tax,
      amount_total = EXCLUDED.amount_total,
      metadata = EXCLUDED.metadata,
      updated_at = now()
    RETURNING *
  `
  const stored = rows[0] as OrderRow | undefined
  if (!stored) throw new Error("Durable order could not be stored")

  for (const line of order.lines) {
    await db`
      INSERT INTO vibecart_order_lines (
        order_id, line_item_id, product_id, description, quantity, unit_amount,
        amount_subtotal, amount_discount, amount_tax, amount_total, currency
      ) VALUES (
        ${stored.id}, ${line.lineItemId}, ${line.productId}, ${line.description}, ${line.quantity}, ${line.unitAmount},
        ${line.amountSubtotal}, ${line.amountDiscount}, ${line.amountTax}, ${line.amountTotal}, ${line.currency}
      )
      ON CONFLICT (order_id, line_item_id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        description = EXCLUDED.description,
        quantity = EXCLUDED.quantity,
        unit_amount = EXCLUDED.unit_amount,
        amount_subtotal = EXCLUDED.amount_subtotal,
        amount_discount = EXCLUDED.amount_discount,
        amount_tax = EXCLUDED.amount_tax,
        amount_total = EXCLUDED.amount_total,
        currency = EXCLUDED.currency
    `
  }

  await db`
    INSERT INTO vibecart_order_events (id, order_id, event_type, to_status, source, details)
    VALUES (${eventId}, ${stored.id}, 'payment_verified', 'new', 'stripe', ${JSON.stringify({ checkoutSessionId: order.checkoutSessionId })}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `

  if (order.cartId) {
    await db`
      UPDATE vibecart_carts
      SET status = 'converted', checkout_session_id = ${order.checkoutSessionId}, updated_at = now()
      WHERE id = ${order.cartId}
    `
  }

  return mapOrder(stored, await linesForOrder(stored.id))
}

export async function getStoredOrder(id: string): Promise<StoredOrder | null> {
  const rows = await sql()`SELECT * FROM vibecart_orders WHERE id = ${id} LIMIT 1`
  const row = rows[0] as OrderRow | undefined
  return row ? mapOrder(row, await linesForOrder(row.id)) : null
}

export async function getStoredOrderByCheckoutSession(checkoutSessionId: string): Promise<StoredOrder | null> {
  const rows = await sql()`
    SELECT * FROM vibecart_orders WHERE checkout_session_id = ${checkoutSessionId} LIMIT 1
  `
  const row = rows[0] as OrderRow | undefined
  return row ? mapOrder(row, await linesForOrder(row.id)) : null
}

export async function listStoredOrders(limit = 100, sourcePrefix?: string): Promise<StoredOrder[]> {
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 100
  const db = sql()
  const rows = sourcePrefix
    ? await db`
        SELECT * FROM vibecart_orders
        WHERE metadata->>'source' LIKE ${`${sourcePrefix}%`}
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `
    : await db`SELECT * FROM vibecart_orders ORDER BY created_at DESC LIMIT ${safeLimit}`
  return Promise.all(rows.map(async row => mapOrder(row as OrderRow, await linesForOrder(String(row.id)))))
}

const STATUS_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  new: ["packing", "cancelled", "refunded"],
  packing: ["new", "shipped", "cancelled", "refunded"],
  shipped: ["refunded"],
  cancelled: ["new", "refunded"],
  refunded: [],
}

export async function updateFulfillmentStatus(id: string, next: FulfillmentStatus): Promise<StoredOrder | null> {
  const current = await getStoredOrder(id)
  if (!current) return null
  if (current.fulfillmentStatus === next) return current
  if (!STATUS_TRANSITIONS[current.fulfillmentStatus].includes(next)) {
    throw new Error(`Cannot change order from ${current.fulfillmentStatus} to ${next}`)
  }

  const db = sql()
  const rows = await db`
    UPDATE vibecart_orders
    SET fulfillment_status = ${next}, updated_at = now()
    WHERE id = ${id} AND fulfillment_status = ${current.fulfillmentStatus}
    RETURNING *
  `
  const row = rows[0] as OrderRow | undefined
  if (!row) throw new Error("Order status changed concurrently; refresh and retry")
  await db`
    INSERT INTO vibecart_order_events (id, order_id, event_type, from_status, to_status, source)
    VALUES (${randomUUID()}, ${id}, 'fulfillment_status_changed', ${current.fulfillmentStatus}, ${next}, 'merchant_admin')
  `
  return mapOrder(row, await linesForOrder(id))
}
