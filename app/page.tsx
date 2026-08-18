import Link from "next/link"
import { PRODUCTS } from "@/lib/products"
import { VibeCartButton } from "@/components/vibe-cart-button"

const cloudUrl = "https://vibecart-cloud-uupzkh.v2.appdeploy.ai/"

const promises = [
  "One backend for every agent",
  "Durable multi-item cart",
  "Merchant-owned Stripe account",
  "Official MCP Registry + released UCP",
]

const surfaces = [
  {
    title: "Generic MCP",
    detail: "Four compact tools for trusted catalog lookup and one- or multi-item hosted checkout.",
    endpoint: "/mcp",
  },
  {
    title: "Durable cart",
    detail: "Neon-backed cart state with trusted repricing, idempotency, version checks, expiration, and checkout handoff.",
    endpoint: "/api/cart",
  },
  {
    title: "Released UCP",
    detail: "UCP 2026-04-08 catalog and cart capabilities with runtime negotiation and exact schema validation.",
    endpoint: "/ucp/mcp",
  },
]

export default function Home() {
  const hasStripeKey = Boolean(process.env.STRIPE_SECRET_KEY)

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-16">
      <div className="mx-auto max-w-6xl space-y-16">
        <header className="space-y-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">VibeCart</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/start" className="text-neutral-300 hover:text-white">Quickstart</Link>
              <a href="/agents.md" className="text-neutral-300 hover:text-white">Agent guide</a>
              <Link href="/cloud" className="text-neutral-300 hover:text-white">Cloud</Link>
            </div>
          </div>

          <div className="max-w-5xl space-y-5">
            <h1 className="text-5xl font-bold leading-[1.02] md:text-7xl">
              Commerce infrastructure for AI-built apps and the agents that use them.
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-neutral-400 md:text-xl">
              Give every AI client one trusted commerce backend for catalog, cart, and checkout—without moving the merchant off their existing app or Stripe account.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={cloudUrl}
              className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400"
            >
              Start VibeCart Cloud — $29/month
            </a>
            <Link
              href="/start"
              className="rounded-lg border border-neutral-700 px-5 py-3 font-semibold text-neutral-100 transition hover:border-neutral-500"
            >
              Connect VibeCart Core
            </Link>
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
            <strong>Reference demo:</strong> the public sample catalog is running without a Stripe secret, so its sample checkout buttons simulate checkout and never create a charge.
          </div>
        )}

        <section className="space-y-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-400">One commerce core</p>
            <h2 className="mt-2 text-3xl font-bold">Use the right transport without rebuilding the business logic.</h2>
            <p className="mt-3 leading-7 text-neutral-400">
              Generic MCP clients and UCP-aware platforms reach the same trusted catalog, cart, checkout, and post-payment foundations.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {surfaces.map(surface => (
              <article key={surface.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                <h3 className="text-lg font-semibold">{surface.title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{surface.detail}</p>
                <code className="mt-5 block rounded-md bg-neutral-950 px-3 py-2 text-xs text-emerald-300">{surface.endpoint}</code>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold">Reference catalog</h2>
            <p className="mt-1 text-sm text-neutral-500">
              These fictional products demonstrate trusted catalog pricing. They are not merchandise offered for fulfillment.
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

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-xl font-semibold">Trusted multi-item checkout</h2>
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs leading-6 text-neutral-300">
{String.raw`vibecart.create_checkout
{
  "items": [
    { "productId": "sku-a", "quantity": 2 },
    { "productId": "sku-b", "quantity": 1 }
  ]
}`}
            </pre>
            <p className="text-sm leading-6 text-neutral-400">
              Agents send product IDs and quantities. VibeCart resolves trusted prices on the server before creating hosted Stripe Checkout.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-xl font-semibold">A real cart, without pretending to be everything.</h2>
            <p className="text-sm leading-6 text-neutral-400">
              VibeCart now has durable multi-item cart state and released UCP cart operations. It still does not pretend to provide complete inventory, tax, shipping-rate, returns, or fulfillment systems that are not built yet.
            </p>
            <p className="text-sm leading-6 text-neutral-400">
              Merchants keep their own Stripe account and VibeCart takes no percentage of merchant sales. Stripe fees and the merchant&apos;s Stripe terms still apply.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-7 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300">VibeCart Cloud · Early Access</p>
              <h2 className="mt-3 text-3xl font-bold">Make the infrastructure recurring instead of another thing you babysit.</h2>
              <p className="mt-3 max-w-3xl leading-7 text-neutral-300">
                Cloud adds managed event and order history, signed fulfillment-webhook handoff, retries, alerts, monitoring, updates, and support around the free Core.
              </p>
              <p className="mt-4 text-3xl font-bold">$29<span className="text-base font-normal text-neutral-400"> / month</span></p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={cloudUrl} className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 hover:bg-emerald-400">
                Open Cloud workspace
              </a>
              <Link href="/cloud" className="rounded-lg border border-emerald-500/50 px-5 py-3 font-semibold text-emerald-200 hover:bg-emerald-500/10">
                Compare options
              </Link>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-neutral-800 pt-6 text-sm text-neutral-500">
          <Link className="hover:text-neutral-200" href="/start">Quickstart</Link>
          <Link className="hover:text-neutral-200" href="/cloud">Cloud</Link>
          <Link className="hover:text-neutral-200" href="/privacy">Privacy</Link>
          <Link className="hover:text-neutral-200" href="/terms">Terms</Link>
          <Link className="hover:text-neutral-200" href="/support">Support</Link>
          <a className="hover:text-neutral-200" href="/llms.txt">LLM instructions</a>
          <a className="hover:text-neutral-200" href="/mcp">MCP endpoint</a>
          <a className="hover:text-neutral-200" href="/.well-known/ucp">UCP discovery</a>
        </footer>
      </div>
    </main>
  )
}
