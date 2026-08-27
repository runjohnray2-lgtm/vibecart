import type { Metadata } from "next"
import Link from "next/link"
import { getStoredOrderByCheckoutSession } from "@/lib/order-store"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Order received | He Said Nothing", robots: { index: false, follow: false } }

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id: sessionId } = await searchParams
  const order = sessionId && sessionId.length <= 200
    ? await getStoredOrderByCheckoutSession(sessionId).catch(() => null)
    : null

  return (
    <main className="min-h-screen bg-[#f6f1e9] px-5 py-16 text-[#201c19]">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-2xl sm:p-12">
        <div className="text-xs font-black uppercase tracking-[.2em] text-[#b54d35]">He Said Nothing</div>
        <h1 className="mt-3 text-4xl font-black">{order ? "Your Nothing is officially something." : "Your payment is being confirmed."}</h1>
        <p className="mx-auto mt-5 max-w-xl leading-7 text-black/60">
          {order
            ? `Order ${order.id} is paid and in our fulfillment queue. We’ll use the clues you gave us to prepare his box.`
            : "Stripe sent you back successfully. The durable order normally appears within a few seconds; refresh this page if confirmation is still processing."}
        </p>
        <Link href="/he-said-nothing" className="mt-8 inline-flex rounded-xl bg-[#b54d35] px-6 py-3 font-black text-white">Back to He Said Nothing</Link>
      </div>
    </main>
  )
}
