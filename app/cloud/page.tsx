import Link from "next/link"

const managedSetupUrl =
  "https://github.com/runjohnray2-lgtm/vibecart/issues/new?title=VibeCart%20Cloud%20managed%20setup"

const options = [
  {
    name: "VibeCart Core",
    type: "Free",
    description: "Self-hosted",
    detail: "For developers who want to manage everything themselves.",
    price: "Free",
  },
  {
    name: "VibeCart Cloud",
    type: "Managed",
    description: "We host, update, monitor, and support the VibeCart integration.",
    detail: "A simple managed option for businesses that want us to take care of it.",
    price: "Contact us / Early access",
  },
  {
    name: "Done-for-you Setup",
    type: "Custom",
    description: "We install VibeCart into your existing site and connect your Stripe integration.",
    detail: "Managed setup and custom integration are available separately.",
    price: "Custom quote",
  },
]

export default function CloudPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-neutral-100 md:py-20">
      <div className="mx-auto max-w-5xl space-y-14">
        <header className="space-y-6">
          <Link href="/" className="text-sm text-emerald-400 hover:underline">
            ← VibeCart
          </Link>
          <div className="max-w-3xl space-y-4">
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Managed hosting
            </p>
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">VibeCart Cloud</h1>
            <p className="text-xl leading-8 text-neutral-300">We host and manage VibeCart for you.</p>
            <p className="max-w-2xl leading-7 text-neutral-400">
              VibeCart Core is free to self-host. VibeCart Cloud is for businesses that do not want
              to manage deployment, updates, Stripe webhook monitoring, or integration maintenance.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-neutral-300 sm:grid-cols-2">
            <p className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              Payments still go directly to your own Stripe account.
            </p>
            <p className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              VibeCart does not take a percentage of your sales.
            </p>
          </div>
        </header>

        <section className="space-y-5" aria-labelledby="options-heading">
          <div>
            <h2 id="options-heading" className="text-2xl font-semibold">Choose the help you need</h2>
            <p className="mt-2 text-neutral-400">Start on your own, let us manage it, or ask us to set it up.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {options.map(option => (
              <article key={option.name} className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                <p className="text-sm font-semibold text-emerald-400">{option.type}</p>
                <h3 className="mt-2 text-xl font-bold">{option.name}</h3>
                <p className="mt-4 font-medium text-neutral-200">{option.description}</p>
                <p className="mt-2 flex-1 text-sm leading-6 text-neutral-400">{option.detail}</p>
                <p className="mt-6 border-t border-neutral-800 pt-4 font-semibold">{option.price}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-7 text-center md:p-10">
          <h2 className="text-2xl font-bold">Want VibeCart managed for you?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-neutral-300">
            Tell us about your site and whether you need managed hosting, a done-for-you setup, or both.
          </p>
          <a
            href={managedSetupUrl}
            className="mt-6 inline-flex rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400"
          >
            Request early access
          </a>
        </section>
      </div>
    </main>
  )
}
