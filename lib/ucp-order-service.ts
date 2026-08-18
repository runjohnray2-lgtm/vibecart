import { cloudOrderLookupConfigured, lookupDurableCloudOrder } from "@/lib/cloud-orders"
import { merchantOrderPermalink, orderPermalinkConfigured } from "@/lib/order-permalink"
import { mapDurableOrderToUcp, type UcpOrder } from "@/lib/ucp-order"

export type UcpOrderServiceResult =
  | { kind: "success"; order: UcpOrder }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "invalid_id" }
  | { kind: "unavailable"; retryable: boolean }

export function ucpOrderRuntimeConfigured(): boolean {
  return cloudOrderLookupConfigured() && orderPermalinkConfigured()
}

export async function getUcpOrder(orderId: string): Promise<UcpOrderServiceResult> {
  const lookup = await lookupDurableCloudOrder(orderId)

  if (!lookup.configured) return { kind: "unavailable", retryable: false }
  if (lookup.reason === "invalid_id") return { kind: "invalid_id" }
  if (lookup.reason === "unauthorized") return { kind: "unauthorized" }
  if (!lookup.found) {
    if (lookup.status === 404) return { kind: "not_found" }
    return { kind: "unavailable", retryable: lookup.retryable }
  }
  if (!lookup.order) return { kind: "unavailable", retryable: true }

  const permalink = merchantOrderPermalink(lookup.order.orderId)
  if (!permalink) return { kind: "unavailable", retryable: false }

  try {
    return { kind: "success", order: mapDurableOrderToUcp(lookup.order, permalink) }
  } catch (error) {
    console.warn("[vibecart ucp order] Durable order cannot be mapped safely", error)
    return { kind: "unavailable", retryable: false }
  }
}
