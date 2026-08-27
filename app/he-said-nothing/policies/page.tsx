import type { Metadata } from "next"
import Link from "next/link"
import { hsnPolicyConfig } from "@/lib/he-said-nothing-config"

export const metadata: Metadata = {
  title: "Shipping, returns, and privacy | He Said Nothing",
  description: "Shipping, return, privacy, and payment information for He Said Nothing mystery gift boxes.",
}

export default function PoliciesPage() {
  const policy = hsnPolicyConfig()
  return (
    <main className="min-h-screen bg-[#f6f1e9] px-5 py-12 text-[#201c19]">
      <article className="mx-auto max-w-3xl rounded-3xl bg-white p-7 shadow-xl sm:p-10">
        <Link href="/he-said-nothing" className="text-sm font-black text-[#b54d35]">← He Said Nothing</Link>
        <h1 className="mt-5 text-4xl font-black">Shipping, returns, and privacy</h1>

        <section className="mt-8 space-y-3">
          <h2 className="text-2xl font-black">Shipping and processing</h2>
          <p className="leading-7 text-black/65">{policy.processingTime}</p>
          <p className="leading-7 text-black/65">The exact shipping charge is shown in Stripe Checkout before payment. Delivery estimates begin after the box is packed and handed to the carrier.</p>
        </section>

        <section className="mt-8 space-y-3 border-t border-black/10 pt-8">
          <h2 className="text-2xl font-black">Returns and refunds</h2>
          <p className="leading-7 text-black/65">{policy.returnPolicy}</p>
          <p className="leading-7 text-black/65">If an order arrives damaged or incorrect, contact us with the order number and photographs so we can make it right.</p>
        </section>

        <section className="mt-8 space-y-3 border-t border-black/10 pt-8">
          <h2 className="text-2xl font-black">Privacy and payments</h2>
          <p className="leading-7 text-black/65">We store the gift clues you submit, order contact information, shipping address, payment status, and fulfillment history so we can prepare and deliver the box. Stripe processes card information; He Said Nothing and VibeCart do not store full card numbers.</p>
          <p className="leading-7 text-black/65">Order data is stored in the VibeCart order database and ordinary request logs may be retained by the hosting provider for security and troubleshooting.</p>
        </section>

        <section className="mt-8 space-y-3 border-t border-black/10 pt-8">
          <h2 className="text-2xl font-black">Contact</h2>
          {policy.supportEmail
            ? <a className="font-black text-[#b54d35] hover:underline" href={`mailto:${policy.supportEmail}`}>{policy.supportEmail}</a>
            : <p className="leading-7 text-black/65">A customer-support address will be published before ordering opens.</p>}
        </section>
      </article>
    </main>
  )
}
