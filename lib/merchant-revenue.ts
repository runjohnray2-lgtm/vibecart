/** Merchant-scoped revenue calculations. Call only after authorization and tenant filtering. */
export interface RevenueOrder {
  checkoutSessionId: string
  merchantId: string
  amountTotal: number | null
  currency: string
  paymentStatus: string
  metadata?: Record<string, string>
}
export interface CurrencyRevenue {
  currency: string
  paidOrders: number
  grossCents: number
  aiAttributedOrders: number
  aiAttributedCents: number
}
export function summarizeMerchantRevenue(merchantId: string, orders: readonly RevenueOrder[]): CurrencyRevenue[] {
  if (!merchantId.trim()) throw new Error("Merchant ID is required")
  const byCurrency = new Map<string, CurrencyRevenue>()
  const seen = new Set<string>()
  for (const order of orders) {
    if (order.merchantId !== merchantId || order.paymentStatus !== "paid") continue
    if (!Number.isSafeInteger(order.amountTotal) || order.amountTotal === null || order.amountTotal < 0) continue
    const currency = order.currency.toLowerCase()
    if (!/^[a-z]{3}$/.test(currency) || !order.checkoutSessionId) continue
    const identity = currency + ":" + order.checkoutSessionId
    if (seen.has(identity)) continue
    seen.add(identity)
    const row = byCurrency.get(currency) ?? { currency, paidOrders: 0, grossCents: 0, aiAttributedOrders: 0, aiAttributedCents: 0 }
    row.paidOrders += 1
    row.grossCents += order.amountTotal
    const source = order.metadata?.source?.toLowerCase() ?? ""
    if (source === "ai" || source === "agent" || source.startsWith("mcp:") || source.startsWith("ucp:")) {
      row.aiAttributedOrders += 1
      row.aiAttributedCents += order.amountTotal
    }
    byCurrency.set(currency, row)
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}
