import Link from "next/link"

const requestSetupUrl =
  "https://github.com/runjohnray2-lgtm/vibecart/issues/new?title=VibeCart%20done-for-you%20setup&body=%23%23%20What%20are%20you%20building%3F%0A%0AWebsite%20or%20app%3A%20%0AWhat%20you%20sell%3A%20%0AWhat%20is%20already%20working%3A%20%0AWhat%20you%20want%20VibeCart%20to%20handle%3A%20%0AStripe%20status%20(if%20known)%3A%20%0ATimeline%3A%20%0A%0A%3E%20Do%20not%20paste%20Stripe%20secret%20keys%2C%20webhook%20secrets%2C%20card%20numbers%2C%20or%20other%20credentials."

const outcomes = [
  "Install VibeCart into your existing AI-built or traditional app",
  "Connect your own Stripe account without moving your business to another storefront",
  "Lock real product pricing to a trusted server-side source",
  "Configure and verify Stripe webhooks",
  "Connect successful payments to access, orders, licenses, notifications, or other business logic",
  "Wire authentication where the purchase flow needs customer identity",
  "Test the complete purchase and post-payment flow before launch",
]

const fit = [
  "You built an app with ChatGPT, Claude, Codex, Cursor, Replit, Lovable, v0, or another AI coding tool",
  "Stripe checkout mostly works, but you are unsure whether pricing, webhooks, auth, or fulfillment are production-safe",
  "You do not want to become the person responsible for debugging payment plumbing",
  "You want to keep your current app, product source, and Stripe account",
]

export default function SetupPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-neutral-100 md:py-20">
      <div className="mx-auto max-w-5xl space-y-14">
        <header className="space-y-6">
          <Link href="/" className="text-sm text-emerald-400 hover:underline">← VibeCart</Link>
          <div className="max-w-4xl space-y-4">
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Done-for-you VibeCart Setup
            </p>
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">
              We make your AI-built payment system actually work in production.
            </h1>
            <p className="max-w-3xl text-xl leading-8 text-neutral-300">
              Keep the app you already built and the Stripe account you already own. We install VibeCart,
              secure the payment path, connect what happens after payment, and test the whole flow with you.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={requestSetupUrl}
              className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400"
            >
              Request a setup quote
            </a>
            <Link
              href="/cloud"
              className="rounded-lg border border-neutral-700 px-5 py-3 font-semibold text-neutral-100 transition hover:border-neutral-500"
            >
              Compare with VibeCart Cloud
            </Link>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">What we do</p>
            <h2 className="mt-3 text-2xl font-bold">From “Buy” to the thing the customer actually paid for.</h2>
            <ul className="mt-6 space-y-3 text-sm leading-6 text-neutral-200">
              {outcomes.map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden="true">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border border-neutral-800 bg-neutral-900 p-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Good fit</p>
            <h2 className="mt-3 text-2xl font-bold">Built with AI is fine. Payment mistakes are not.</h2>
            <ul className="mt-6 space-y-3 text-sm leading-6 text-neutral-300">
              {fit.map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden="true">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-7 md:p-10">
          <h2 className="text-2xl font-bold">How the paid service works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">1 · Review</p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">You show us the app, what you sell, and what should happen after someone pays.</p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">2 · Quote</p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">We scope the installation around your existing app, Stripe setup, auth, and fulfillment needs.</p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">3 · Launch</p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">We wire it, test it end-to-end, and leave you with a production-ready path you understand.</p>
            </div>
          </div>
          <div className="mt-7 border-t border-neutral-800 pt-6 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="font-semibold">Custom one-time setup quote</p>
              <p className="mt-1 text-sm text-neutral-400">No percentage of your sales. Your checkout revenue still settles directly to your Stripe account.</p>
            </div>
            <a
              href={requestSetupUrl}
              className="mt-5 inline-flex rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 hover:bg-emerald-400 md:mt-0"
            >
              Tell us about your app
            </a>
          </div>
        </section>

        <footer className="flex flex-wrap gap-5 border-t border-neutral-800 pt-6 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-200">VibeCart Core</Link>
          <Link href="/cloud" className="hover:text-neutral-200">VibeCart Cloud</Link>
          <Link href="/support" className="hover:text-neutral-200">Support</Link>
        </footer>
      </div>
    </main>
  )
}
