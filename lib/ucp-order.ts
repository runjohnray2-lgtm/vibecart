import type { DurableCloudOrder, DurableCloudOrderLine } from "@/lib/cloud-orders"

export const UCP_ORDER_VERSION = "2026-04-08"

export interface UcpOrderTotal {
  type: "subtotal" | "items_discount" | "tax" | "total"
  amount: number
  display_text?: string
}

export interface UcpOrderLineItem {
  id: string
  item: {
    id: string
    title: string
    price: number
  }
  quantity: {
    original: number
    total: number
    fulfilled: number
  }
  totals: UcpOrderTotal[]
  status: "processing"
}

export interface UcpOrder {
  ucp: {
    version: typeof UCP_ORDER_VERSION
    status: "success"
    capabilities: Record<string, never[]>
  }
  id: string
  checkout_id: string
  permalink_url: string
  line_items: UcpOrderLineItem[]
  fulfillment: {
    expectations: never[]
    events: never[]
  }
  currency: string
  totals: UcpOrderTotal[]
}

function requireHttpsPermalink(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("UCP order permalink must be a public HTTPS URL without credentials or fragment")
  }
  return url.toString()
}

function requireMinorUnits(value: number | null, name: string): number {
  if (!Number.isSafeInteger(value) || value === null || value < 0) {
    throw new Error(`${name} must be a nonnegative integer in minor currency units`)
  }
  return value
}

function lineTotals(line: DurableCloudOrderLine): UcpOrderTotal[] {
  const subtotal = requireMinorUnits(line.amountSubtotal, "line subtotal")
  const discount = requireMinorUnits(line.amountDiscount, "line discount")
  const tax = requireMinorUnits(line.amountTax, "line tax")
  const total = requireMinorUnits(line.amountTotal, "line total")
  const expected = subtotal - discount + tax
  if (expected !== total) {
    throw new Error(`Line ${line.lineItemId} has an unexplained total delta; fulfillment/fee data is required before UCP exposure`)
  }

  const totals: UcpOrderTotal[] = [{ type: "subtotal", amount: subtotal }]
  if (discount > 0) totals.push({ type: "items_discount", amount: -discount })
  if (tax > 0) totals.push({ type: "tax", amount: tax })
  totals.push({ type: "total", amount: total })
  return totals
}

function mapLine(line: DurableCloudOrderLine): UcpOrderLineItem {
  const productId = line.productId.trim()
  if (!productId) throw new Error(`Line ${line.lineItemId} is missing merchant product identity`)
  const unitAmount = requireMinorUnits(line.unitAmount, "line unit amount")
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new Error(`Line ${line.lineItemId} has invalid quantity`)
  }

  return {
    id: line.lineItemId,
    item: {
      id: productId,
      title: line.description || productId,
      price: unitAmount,
    },
    quantity: {
      original: line.quantity,
      total: line.quantity,
      fulfilled: 0,
    },
    totals: lineTotals(line),
    status: "processing",
  }
}

export function mapDurableOrderToUcp(order: DurableCloudOrder, permalinkUrl: string): UcpOrder {
  if (!order.orderId.trim()) throw new Error("Durable order is missing order identity")
  if (!order.checkoutSessionId.trim()) throw new Error("Durable order is missing checkout identity")
  if (!order.currency.trim()) throw new Error("Durable order is missing currency")
  if (order.lines.length === 0) throw new Error("Durable order has no line items")

  const permalink = requireHttpsPermalink(permalinkUrl)
  const subtotal = requireMinorUnits(order.amountSubtotal, "order subtotal")
  const total = requireMinorUnits(order.amountTotal, "order total")
  const discount = order.lines.reduce((sum, line) => sum + requireMinorUnits(line.amountDiscount, "line discount"), 0)
  const tax = order.lines.reduce((sum, line) => sum + requireMinorUnits(line.amountTax, "line tax"), 0)
  const expected = subtotal - discount + tax
  if (expected !== total) {
    throw new Error("Order total contains fulfillment, fee, or other amounts that are not yet represented by trusted UCP source data")
  }

  const totals: UcpOrderTotal[] = [{ type: "subtotal", amount: subtotal }]
  if (discount > 0) totals.push({ type: "items_discount", amount: -discount })
  if (tax > 0) totals.push({ type: "tax", amount: tax })
  totals.push({ type: "total", amount: total })

  return {
    ucp: {
      version: UCP_ORDER_VERSION,
      status: "success",
      capabilities: {},
    },
    id: order.orderId,
    checkout_id: order.checkoutSessionId,
    permalink_url: permalink,
    line_items: order.lines.map(mapLine),
    fulfillment: {
      expectations: [],
      events: [],
    },
    currency: order.currency.toUpperCase(),
    totals,
  }
}
