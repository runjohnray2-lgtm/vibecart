import Link from "next/link"
import { Link2, Sparkles } from "lucide-react"
import { AppFactorySubscribeButton } from "@/components/app-factory-subscribe-button"

const apps = [
  {
    name: "Link + QR + UTM Manager",
    description: "Create editable short links, QR codes, campaign tags, and click analytics from one dashboard.",
    href: "/apps/links",
    status: "Beta",
    icon: Link2,
  },
]

export default function AppLibraryPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-neutral-100 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="max-w-4xl space-y-5">
          <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">VibeCart</Link>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-400">App Factory</p>
            <h1 className="mt-3 text-5xl font-bold leading-tight md:text-6xl">One account. A growing library of useful apps.</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-neutral-400">
              VibeCart App Factory bundles focused web tools behind one shared account and entitlement system. Start with a 7-day first-use trial, then one subscription keeps the whole library unlocked.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold">All-app access</p>
                <p className="mt-1 text-sm text-neutral-400">One Stripe subscription unlocks every current and future App Factory tool included in the plan.</p>
              </div>
              <AppFactorySubscribeButton />
            </div>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {apps.map(app => {
            const Icon = app.icon
            return (
              <Link key={app.name} href={app.href} className="group rounded-2xl border border-neutral-800 bg-neutral-900 p-6 transition hover:border-emerald-500/60 hover:bg-neutral-900/80">
                <div className="flex items-start justify-between gap-4">
                  <div className="rounded-xl bg-emerald-500/15 p-3 text-emerald-400"><Icon size={24} /></div>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">{app.status}</span>
                </div>
                <h2 className="mt-6 text-xl font-semibold group-hover:text-emerald-300">{app.name}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{app.description}</p>
                <p className="mt-6 text-sm font-medium text-emerald-400">Open app →</p>
              </Link>
            )
          })}

          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/40 p-6 text-neutral-500">
            <div className="w-fit rounded-xl bg-neutral-800 p-3 text-neutral-400"><Sparkles size={24} /></div>
            <h2 className="mt-6 text-xl font-semibold text-neutral-300">More apps after usage data</h2>
            <p className="mt-2 text-sm leading-6">The factory expands from evidence instead of filling the library with weak tools.</p>
          </div>
        </section>
      </div>
    </main>
  )
}
