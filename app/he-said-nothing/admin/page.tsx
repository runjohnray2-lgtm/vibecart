import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { HSN_ADMIN_COOKIE, verifyHsnAdminSession } from "@/lib/hsn-admin-auth"
import { listStoredOrders } from "@/lib/order-store"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Orders | He Said Nothing", robots: { index: false, follow: false } }

function money(cents: number | null, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format((cents ?? 0) / 100)
}

export default async function OrdersPage() {
  const cookieStore = await cookies()
  if (!verifyHsnAdminSession(cookieStore.get(HSN_ADMIN_COOKIE)?.value)) {
    redirect("/he-said-nothing/admin/login")
  }
  const orders = await listStoredOrders(100, "he-said-nothing")

  return (
    <main className="min-h-screen bg-[#f6f1e9] px-5 py-10 text-[#201c19]">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#b54d35]">He Said Nothing</div>
            <h1 className="mt-1 text-4xl font-black">Orders</h1>
          </div>
          <form action="/api/he-said-nothing/admin/logout" method="post">
            <button className="rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-black">Sign out</button>
          </form>
        </header>

        <div className="mt-8 overflow-hidden rounded-3xl border border-black/10 bg-white shadow-xl">
          {orders.length === 0 ? (
            <p className="p-8 text-black/60">No paid orders yet.</p>
          ) : (
            <div className="divide-y divide-black/10">
              {orders.map(order => (
                <Link key={order.id} href={`/he-said-nothing/admin/orders/${order.id}`} className="grid gap-3 p-5 transition hover:bg-[#fff6f0] sm:grid-cols-[1.2fr_1fr_.7fr_.7fr] sm:items-center">
                  <div>
                    <div className="font-mono text-xs text-black/45">{order.id}</div>
                    <div className="mt-1 font-black">{order.customerName || order.customerEmail || "Customer"}</div>
                  </div>
                  <div className="text-sm text-black/65">{order.lines.map(line => `${line.quantity}× ${line.description}`).join(", ")}</div>
                  <div className="font-black">{money(order.amountTotal, order.currency)}</div>
                  <div className="justify-self-start rounded-full bg-[#eadccc] px-3 py-1 text-xs font-black uppercase tracking-wider">{order.fulfillmentStatus}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
