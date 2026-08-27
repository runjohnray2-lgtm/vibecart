import { NextResponse } from "next/server"
import { hsnAdminRequestAuthorized } from "@/lib/hsn-admin-auth"
import { updateFulfillmentStatus, type FulfillmentStatus } from "@/lib/order-store"

export const runtime = "nodejs"

const VALID_STATUSES = new Set<FulfillmentStatus>(["new", "packing", "shipped", "cancelled", "refunded"])

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!hsnAdminRequestAuthorized(req)) {
    return NextResponse.redirect(new URL("/he-said-nothing/admin/login", req.url), 303)
  }

  const { id } = await context.params
  const form = await req.formData()
  const status = form.get("status")
  if (typeof status !== "string" || !VALID_STATUSES.has(status as FulfillmentStatus)) {
    return NextResponse.json({ success: false, error: "Invalid fulfillment status." }, { status: 400 })
  }

  try {
    const order = await updateFulfillmentStatus(id, status as FulfillmentStatus)
    if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 })
    return NextResponse.redirect(new URL(`/he-said-nothing/admin/orders/${encodeURIComponent(id)}`, req.url), 303)
  } catch (error) {
    console.error("[he said nothing] Fulfillment status update failed", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Status could not be updated." },
      { status: 409 }
    )
  }
}
