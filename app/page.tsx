import Link from "next/link"
import { PRODUCTS } from "@/lib/products"
import { VibeCartButton } from "@/components/vibe-cart-button"

const promises = [
  "One component + one API route",
  "Merchant-owned Stripe account",
  "No platform cut",
  "Server-side trusted pricing",
]

export default function Home() {
  const hasStripeKey = Boolean(process.env.STRIPE_SECRET_KEY)

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-16">
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="space-y-6">
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">VibeCart</p>
          <div className="max-w-4xl space-y-4">
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">
              A lightweight Stripe Checkout primitive for AI-built and vibe-coded apps.
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-neutral-400">
              Give an agent one clear integration path: a button component posts a trusted product ID
              to one server route, then redirects to Stripe&apos;s hosted Checkout in the merchant&apos;s own account.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {promises.map(item => (
              <div key={item} className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm">
                <span className="mr-2 text-emerald-400">✓</span>{item}
              </div>
            ))}
          </div>
        </header>

        {!hasStripeKey && (
          <div className="rounded-xl border border-amber-600/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <strong>Demo mode:</strong> no Stripe key is configured. The sample buttons describe a simulated
            checkout and never create a charge.
          </div>
        )}

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Integration examples</h2>
            <p className="mt-1 text-sm text-neutral-500">
              These fictional sample catalog entries demonstrate the component only. They are not merchandise offered for fulfillment.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {PRODUCTS.map(product => (
              <div key={product.id} className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                <img src={product.image} alt="" className="w-full rounded-lg" />
                <div>
                  <h3 className="text-sm font-semibold">{product.name}</h3>
                  <p className="mt-1 text-xs text-neutral-500">{product.description}</p>
                </div>
                <VibeCartButton product={product} showQuantityStepper={product.id === "shirt-custom-dtf"} />
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="font-semibold">The entire app-facing API</h2>
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
{String.raw`<VibeCartButton product={product} />

POST /api/checkout
{ items: [{ productId, quantity }] }`}
            </pre>
            <p className="text-sm leading-6 text-neutral-400">
              Production catalog prices are resolved on the server. Client-supplied prices are an explicitly unsafe demo-only escape hatch.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="font-semibold">Deliberately not a commerce platform</h2>
            <p className="text-sm leading-6 text-neutral-400">
              VibeCart is not a Shopify or Snipcart replacement. It has no shared multi-item cart,
              inventory system, order fulfillment, or platform payment account. The merchant must
              implement authenticated business logic and webhook fulfillment for their own app.
            </p>
            <p className="text-sm leading-6 text-neutral-400">
              VibeCart currently takes no platform cut. Stripe&apos;s fees and the merchant&apos;s Stripe terms still apply.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-7 md:flex md:items-center md:justify-between md:gap-8 md:p-9">
          <div>
            <h2 className="text-2xl font-bold">Built your app with AI and don&apos;t want to wire payments yourself?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">
              We can install VibeCart, connect your Stripe account, configure the webhook, and test the flow for you.
            </p>
          </div>
          <Link
            href="/cloud"
            className="mt-5 inline-flex shrink-0 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400 md:mt-0"
          >
            Get VibeCart Set Up For Me
          </Link>
        </section>

        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-neutral-800 pt-6 text-sm text-neutral-500">
          <Link className="hover:text-neutral-200" href="/cloud">Cloud</Link>
          <Link className="hover:text-neutral-200" href="/privacy">Privacy</Link>
          <Link className="hover:text-neutral-200" href="/terms">Terms</Link>
          <Link className="hover:text-neutral-200" href="/support">Support</Link>
          <Link className="hover:text-neutral-200" href="/llms.txt">LLM instructions</Link>
          <Link className="hover:text-neutral-200" href="/mcp">MCP endpoint</Link>
        </footer>
      </div>
    </main>
  )
}
