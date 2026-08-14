import Link from "next/link"

const managedSetupUrl =
  "https://github.com/runjohnray2-lgtm/vibecart/issues/new?title=VibeCart%20Cloud%20managed%20setup"

const setupServices = [
  "Install VibeCart into an existing AI-built or traditional website",
  "Connect your own Stripe account",
  "Configure trusted server-side product pricing",
  "Configure and verify Stripe webhooks",
  "Connect purchases to your app or business logic",
  "Help wire authentication where needed",
  "Test the checkout flow end-to-end",
]

const choices = [
  { name: "VibeCart Core", answer: "I want to manage it myself." },
  { name: "Done-for-you Setup", answer: "I want someone to install and connect it correctly." },
  { name: "VibeCart Cloud", answer: "I want ongoing hosting, monitoring, and management." },
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
            VibeCart services
          </p>
          <div className="max-w-3xl space-y-3">
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">VibeCart Cloud</h1>
            <p className="text-xl leading-8 text-neutral-300">
              Get VibeCart set up for you, or let us host and manage it.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-7 md:p-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">Done-for-you VibeCart Setup</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-tight">
            Want VibeCart working on your site without dealing with the setup?
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-neutral-300">
            We install and connect VibeCart correctly, then test the complete payment flow before you launch.
          </p>
          <ul className="mt-6 grid gap-x-8 gap-y-3 text-sm text-neutral-200 md:grid-cols-2">
            {setupServices.map(service => (
              <li key={service} className="flex gap-2">
                <span className="text-emerald-400" aria-hidden="true">✓</span>
                <span>{service}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7 border-t border-emerald-500/20 pt-6 md:flex md:items-end md:justify-between md:gap-8">
            <div>
              <p className="font-semibold">Custom quote</p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">
                Payments go directly to your own Stripe account. VibeCart takes no percentage of your sales.
              </p>
            </div>
            <a
              href={managedSetupUrl}
              className="mt-5 inline-flex shrink-0 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400 md:mt-0"
            >
              Request Done-for-you Setup
            </a>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2" aria-label="Other VibeCart options">
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm font-semibold text-emerald-400">Early access</p>
            <h2 className="mt-2 text-2xl font-bold">VibeCart Cloud</h2>
            <p className="mt-3 leading-7 text-neutral-300">
              Ongoing managed deployment, updates, monitoring, webhook and integration maintenance, and support.
            </p>
            <a
              href={managedSetupUrl}
              className="mt-6 inline-flex rounded-lg border border-emerald-500 px-4 py-2 font-semibold text-emerald-300 hover:bg-emerald-500/10"
            >
              Request VibeCart Cloud
            </a>
          </article>
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm font-semibold text-emerald-400">Free</p>
            <h2 className="mt-2 text-2xl font-bold">VibeCart Core</h2>
            <p className="mt-3 leading-7 text-neutral-300">
              Free to self-host. Best for developers comfortable managing deployment, Stripe, webhooks,
              and their own business logic.
            </p>
            <Link href="/" className="mt-6 inline-flex text-sm font-semibold text-emerald-400 hover:underline">
              Explore VibeCart Core →
            </Link>
          </article>
        </section>

        <section className="space-y-5" aria-labelledby="comparison-heading">
          <div>
            <h2 id="comparison-heading" className="text-2xl font-bold">Which one is for me?</h2>
            <p className="mt-2 text-neutral-400">Choose how much help you want.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {choices.map(choice => (
              <article key={choice.name} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h3 className="font-semibold text-emerald-400">{choice.name}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-300">“{choice.answer}”</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
