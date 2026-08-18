const CLOUD_ORDER_TIMEOUT_MS = 5_000

export interface DurableCloudOrderLine {
  lineItemId: string
  productId: string
  description: string
  quantity: number
  unitAmount: number | null
  amountSubtotal: number
  amountDiscount: number
  amountTax: number
  amountTotal: number
  currency: string
}

export interface DurableCloudOrder {
  id: string
  orderId: string
  eventId: string
  checkoutSessionId: string
  cartId: string
  customerEmail: string
  amountSubtotal: number | null
  amountTotal: number | null
  currency: string
  paymentStatus: string
  status: "paid"
  lines: DurableCloudOrderLine[]
  createdAt: string
  updatedAt: string
}

export interface CloudOrderLookupResult {
  configured: boolean
  found: boolean
  retryable: boolean
  order?: DurableCloudOrder
  status?: number
  reason?: "invalid_config" | "invalid_id" | "unauthorized" | "cloud_rejected" | "invalid_response" | "timeout" | "network"
}

interface CloudOrderConfig {
  lookupUrl: string
  key: string
}

function cloudOrderConfig(): CloudOrderConfig | null | "invalid" {
  const rawUrl = process.env.VIBECART_CLOUD_INGEST_URL?.trim() ?? ""
  const key = process.env.VIBECART_CLOUD_INGEST_KEY?.trim() ?? ""

  if (!rawUrl && !key) return null
  if (!rawUrl || !key) return "invalid"

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return "invalid"
    url.pathname = `${url.pathname.replace(/\/$/, "")}/order`
    url.search = ""
    return { lookupUrl: url.toString(), key }
  } catch {
    return "invalid"
  }
}

function validCheckoutSessionId(raw: string): string | null {
  const value = raw.trim()
  return value.length >= 1 && value.length <= 200 ? value : null
}

function isDurableCloudOrder(value: unknown, expectedCheckoutSessionId: string): value is DurableCloudOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const order = value as Record<string, unknown>
  return order.checkoutSessionId === expectedCheckoutSessionId
    && typeof order.orderId === "string"
    && typeof order.currency === "string"
    && typeof order.status === "string"
    && Array.isArray(order.lines)
}

export async function lookupDurableCloudOrder(checkoutSessionIdRaw: string): Promise<CloudOrderLookupResult> {
  const checkoutSessionId = validCheckoutSessionId(checkoutSessionIdRaw)
  if (!checkoutSessionId) return { configured: true, found: false, retryable: false, reason: "invalid_id" }

  const config = cloudOrderConfig()
  if (config === null) return { configured: false, found: false, retryable: false }
  if (config === "invalid") return { configured: true, found: false, retryable: false, reason: "invalid_config" }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLOUD_ORDER_TIMEOUT_MS)

  try {
    const response = await fetch(config.lookupUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "VibeCart-Core/1",
        "x-vibecart-key": config.key,
      },
      body: JSON.stringify({ checkoutSessionId }),
      redirect: "error",
      signal: controller.signal,
    })

    if (response.status === 404) {
      return { configured: true, found: false, retryable: false, status: 404 }
    }

    if (response.status === 401 || response.status === 403) {
      return { configured: true, found: false, retryable: false, status: response.status, reason: "unauthorized" }
    }

    if (!response.ok) {
      return {
        configured: true,
        found: false,
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
        reason: "cloud_rejected",
      }
    }

    const payload = await response.json() as { order?: unknown }
    if (!isDurableCloudOrder(payload.order, checkoutSessionId)) {
      return { configured: true, found: false, retryable: true, status: response.status, reason: "invalid_response" }
    }

    return { configured: true, found: true, retryable: false, status: response.status, order: payload.order }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError"
    return {
      configured: true,
      found: false,
      retryable: true,
      reason: timedOut ? "timeout" : "network",
    }
  } finally {
    clearTimeout(timeout)
  }
}
