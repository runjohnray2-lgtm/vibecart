import Link from "next/link"

const cloudUrl = "https://vibecart-cloud-uupzkh.v2.appdeploy.ai/"
const managedSetupUrl =
  "https://github.com/runjohnray2-lgtm/vibecart/issues/new?title=VibeCart%20done-for-you%20setup"

const cloudFeatures = [
  "Managed deployment, updates, and monitoring",
  "Verified Stripe event history and status",
  "Durable paid-order records and order history",
  "Signed fulfillment-webhook handoff",
  "Automatic retry and delivery history",
  "Optional payment alerts",
  "Setup guidance and support",
]

const setupServices = [
  "Install VibeCart into an existing AI-built or traditional website",
  "Connect the merchant's own Stripe account",
  "Configure trusted server-side product pricing",
  "Configure and verify Stripe webhooks",
  "Connect purchases to the merchant's app or business logic",
  "Help wire authentication where needed",
  "Test the checkout flow end-to-end",
]

const choices = [
  { name: "VibeCart Core", price: "Free", answer: "I want to run the commerce infrastructure myself." },
  { name: "VibeCart Cloud", price: "$29/month", answer: "I want the recurring plumbing managed for me." },
  { name: "Done-for-you Setup", price: "Custom quote", answer: "I want someone to install and connect my app correctly." },
]

export default function CloudPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-neutral-100 md:py-20">
      <div className="mx-auto max-w-5xl space-y-14">
        <header className="space-y-5">
          <Link href="/" className="text-sm text-emerald-400 hover:underline">
            ← VibeCart
          </Link>
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
            VibeCart Cloud
          </p>
          <div className="max-w-4xl space-y-4">
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">
              Keep VibeCart Core free—or pay to stop babysitting the plumbing.
            </h1>
            <p className="max-w-3xl text-xl leading-8 text-neutral-300">
              Cloud is the managed recurring layer around VibeCart Core: verified commerce events, durable orders,
              fulfillment handoff, retries, monitoring, alerts, updates, and support.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-7 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Early access</p>
              <h2 className="mt-3 text-3xl font-bold">VibeCart Cloud</h2>
              <p className="mt-4 max-w-3xl leading-7 text-neutral-300">
                Use the workspace for demo/test events before subscribing. A verified active subscription unlocks
                live commerce ingestion and signed merchant-webhook delivery.
              </p>
              <ul className="mt-6 grid gap-x-8 gap-y-3 text-sm text-neutral-200 md:grid-cols-2">
                {cloudFeatures.map(feature => (
                  <li key={feature} className="flex gap-2">
                    <span className="text-emerald-400" aria-hidden="true">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 border-t border-emerald-500/20 pt-5">
                <p className="text-3xl font-bold">$29<span className="text-base font-normal text-neutral-400"> / month</span></p>
                <p className="mt-2 text-sm leading-6 text-neutral-300">
                  Cancel anytime. Merchant checkout revenue still settles directly to the merchant&apos;s own Stripe account.
                  VibeCart takes no percentage of merchant sales.
                </p>
              </div>
            </div>
            <a
              href={cloudUrl}
              className="inline-flex shrink-0 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400"
            >
              Open Cloud workspace
            </a>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-7 md:p-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">Done-for-you setup</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-tight">
            Want VibeCart installed and connected without doing the setup yourself?
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-neutral-300">
            This is separate from the $29/month Cloud subscription. We can install VibeCart into an existing app,
            connect the merchant&apos;s systems, and test the complete commerce flow as a custom setup engagement.
          </p>
          <ul className="mt-6 grid gap-x-8 gap-y-3 text-sm text-neutral-200 md:grid-cols-2">
            {setupServices.map(service => (
              <li key={service} className="flex gap-2">
                <span className="text-emerald-400" aria-hidden="true">✓</span>
                <span>{service}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7 border-t border-neutral-800 pt-6 md:flex md:items-end md:justify-between md:gap-8">
            <div>
              <p className="font-semibold">Custom quote</p>
              <p className="mt-2 text-sm leading-6 text-neutral-400">
                Scope depends on the existing app, Stripe setup, authentication, and business-logic handoff.
              </p>
            </div>
            <a
              href={managedSetupUrl}
              className="mt-5 inline-flex shrink-0 rounded-lg border border-emerald-500 px-5 py-3 font-semibold text-emerald-300 transition hover:bg-emerald-500/10 md:mt-0"
            >
              Request Done-for-you Setup
            </a>
          </div>
        </section>

        <section className="space-y-5" aria-labelledby="comparison-heading">
          <div>
            <h2 id="comparison-heading" className="text-2xl font-bold">Choose how much you want VibeCart to handle.</h2>
            <p className="mt-2 text-neutral-400">Core, recurring management, and custom installation stay separate so the offer is clear.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {choices.map(choice => (
              <article key={choice.name} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{choice.price}</p>
                <h3 className="mt-2 font-semibold text-emerald-400">{choice.name}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-300">“{choice.answer}”</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap gap-5 border-t border-neutral-800 pt-6 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-200">VibeCart Core</Link>
          <a href={cloudUrl} className="hover:text-neutral-200">Cloud workspace</a>
          <Link href="/support" className="hover:text-neutral-200">Support</Link>
        </footer>
      </div>
    </main>
  )
}
