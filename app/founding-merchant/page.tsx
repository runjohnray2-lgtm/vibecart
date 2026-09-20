import Link from "next/link"

const included = [
  "Connect one existing product catalog to VibeCart's trusted server-side catalog layer",
  "Expose agent-ready MCP and UCP commerce endpoints for the store",
  "Connect the merchant's existing Stripe account for hosted checkout",
  "Validate catalog → cart → checkout in production before launch",
  "Provide agent/client connection instructions for supported MCP clients",
  "Keep the merchant's Stripe account and customer revenue under the merchant's control",
]

const monthly = [
  "Managed commerce event and order plumbing",
  "Signed fulfillment-webhook delivery with bounded retries",
  "Monitoring and operational updates",
  "Ongoing support for the VibeCart integration",
]

export default async function FoundingMerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const params = await searchParams
  const state = params.checkout

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-16">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
            VibeCart
          </Link>
          <Link href="/start" className="text-sm text-neutral-400 hover:text-white">
            Technical quickstart
          </Link>
        </div>

        <section className="grid gap-10 lg:grid-cols-[1.25fr_.75fr] lg:items-start">
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-400">Founding Merchant Program</p>
              <h1 className="mt-3 text-4xl font-bold leading-tight md:text-6xl">
                Make a custom or AI-built storefront ready for agent commerce.
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-neutral-400">
                VibeCart is for merchants and builders who already have products and Stripe, but do not want to build a separate commerce backend for every AI client. We connect one trusted catalog and checkout flow to agent-ready MCP/UCP surfaces.
              </p>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
              <h2 className="text-xl font-semibold">What the $199 setup includes</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-neutral-300">
                {included.map(item => (
                  <li key={item} className="flex gap-3">
                    <span className="text-emerald-400">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
              <h2 className="text-xl font-semibold">Then $29/month for VibeCart Cloud</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-neutral-300">
                {monthly.map(item => (
                  <li key={item} className="flex gap-3">
                    <span className="text-emerald-400">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm leading-6 text-neutral-500">
                Merchant sales continue to settle directly to the merchant's Stripe account. VibeCart does not take a percentage of the merchant's customer sales.
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
              <strong>Best fit:</strong> custom, Next.js, or AI-built storefronts using Stripe. Shopify is building native agent-commerce capabilities, so VibeCart is not positioned as a replacement for Shopify's own stack.
            </div>
          </div>

          <aside className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-7 lg:sticky lg:top-8">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300">Founding price</p>
            <div className="mt-3">
              <span className="text-5xl font-bold">$199</span>
              <span className="ml-2 text-neutral-400">setup</span>
            </div>
            <p className="mt-2 text-xl font-semibold">$29/month after setup</p>
            <p className="mt-4 text-sm leading-6 text-neutral-300">
              One storefront. One trusted catalog. Production checkout validation. Managed VibeCart Cloud after launch.
            </p>

            {state === "cancelled" && (
              <p className="mt-5 rounded-lg border border-neutral-700 bg-neutral-950/60 p-3 text-sm text-neutral-300">
                Checkout was cancelled. Nothing was charged.
              </p>
            )}
            {(state === "error" || state === "unavailable") && (
              <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                Checkout is temporarily unavailable. Use the support link below and we can complete setup directly.
              </p>
            )}

            <form action="/api/vibecart-founder-checkout" method="post" className="mt-6">
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400"
              >
                Become a Founding Merchant
              </button>
            </form>

            <p className="mt-3 text-xs leading-5 text-neutral-500">
              Checkout is hosted by Stripe. The initial checkout includes the $199 setup fee and starts the $29/month VibeCart Cloud subscription.
            </p>

            <div className="mt-6 border-t border-emerald-500/20 pt-5 text-sm">
              <Link href="/support" className="text-emerald-300 hover:text-emerald-200">
                Questions before buying? Contact support →
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
