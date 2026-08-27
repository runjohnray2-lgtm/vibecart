import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { HSN_ADMIN_COOKIE, verifyHsnAdminSession } from "@/lib/hsn-admin-auth"
import { getStoredOrder, type FulfillmentStatus } from "@/lib/order-store"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Order | He Said Nothing", robots: { index: false, follow: false } }

const statusLabels: Record<FulfillmentStatus, string> = {
  new: "New",
  packing: "Packing",
  shipped: "Shipped",
  cancelled: "Cancelled",
  refunded: "Refunded in Stripe",
}

function money(cents: number | null, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format((cents ?? 0) / 100)
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-black uppercase tracking-wider text-black/40">{label}</div><div className="mt-1 whitespace-pre-wrap font-semibold">{value || "—"}</div></div>
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  if (!verifyHsnAdminSession(cookieStore.get(HSN_ADMIN_COOKIE)?.value)) {
    redirect("/he-said-nothing/admin/login")
  }
  const { id } = await params
  const order = await getStoredOrder(id)
  if (!order) notFound()

  const address = [order.shipping.name, order.shipping.line1, order.shipping.line2, `${order.shipping.city}, ${order.shipping.state} ${order.shipping.postalCode}`, order.shipping.country]
    .filter(Boolean)
    .join("\n")

  return (
    <main className="min-h-screen bg-[#f6f1e9] px-5 py-10 text-[#201c19]">
      <div className="mx-auto max-w-5xl">
        <Link href="/he-said-nothing/admin" className="text-sm font-black text-[#b54d35]">← All orders</Link>
        <div className="mt-5 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-mono text-xs text-black/45">{order.id}</div>
                <h1 className="mt-1 text-3xl font-black">{order.customerName || "Paid order"}</h1>
              </div>
              <div className="rounded-full bg-[#eadccc] px-3 py-1 text-xs font-black uppercase tracking-wider">{order.fulfillmentStatus}</div>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <Detail label="Email" value={order.customerEmail} />
              <Detail label="Phone" value={order.customerPhone} />
              <Detail label="Ship to" value={address} />
              <Detail label="Payment" value={`${order.paymentStatus} · ${money(order.amountTotal, order.currency)}`} />
            </div>

            <div className="mt-8 border-t border-black/10 pt-6">
              <h2 className="text-xl font-black">Items</h2>
              <div className="mt-4 space-y-3">
                {order.lines.map(line => (
                  <div key={line.lineItemId} className="flex justify-between gap-4 rounded-2xl bg-[#f6f1e9] p-4">
                    <div><div className="font-black">{line.quantity}× {line.description}</div><div className="mt-1 font-mono text-xs text-black/45">{line.productId}</div></div>
                    <div className="font-black">{money(line.amountTotal, line.currency)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 border-t border-black/10 pt-6">
              <h2 className="text-xl font-black">Gift clues</h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {Object.entries(order.metadata).map(([key, value]) => <Detail key={key} label={key.replaceAll("_", " ")} value={value} />)}
              </div>
            </div>
          </section>

          <aside className="h-fit rounded-3xl bg-[#26211e] p-6 text-white shadow-xl">
            <h2 className="text-xl font-black">Fulfillment status</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">Refund the payment in Stripe before marking an order refunded here.</p>
            <form action={`/api/he-said-nothing/admin/orders/${encodeURIComponent(order.id)}/status`} method="post" className="mt-5 space-y-3">
              <select name="status" defaultValue={order.fulfillmentStatus} className="w-full rounded-xl bg-white px-4 py-3 font-black text-[#201c19]">
                {(Object.keys(statusLabels) as FulfillmentStatus[]).map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
              </select>
              <button className="w-full rounded-xl bg-[#b54d35] px-5 py-3 font-black">Update order</button>
            </form>
          </aside>
        </div>
      </div>
    </main>
  )
}
