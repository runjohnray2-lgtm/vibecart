import Link from "next/link"
import { FileText, Images, Link2, Sparkles } from "lucide-react"

const apps = [
  {
    name: "Link + QR + UTM Manager",
    description: "Create editable short links, QR codes, campaign tags, and click analytics from one dashboard.",
    href: "/apps/links",
    status: "Live",
    icon: Link2,
    accent: "emerald",
  },
  {
    name: "Image Toolkit",
    description: "Resize, compress, and convert up to 30 images at once with private browser-local processing.",
    href: "/apps/images",
    status: "Live",
    icon: Images,
    accent: "cyan",
  },
  {
    name: "PDF Toolkit",
    description: "Merge PDFs, extract or split pages, reorder, rotate, and remove pages without uploading source files.",
    href: "/apps/pdf",
    status: "Beta",
    icon: FileText,
    accent: "violet",
  },
]

const accentClasses = {
  emerald: {
    hover: "hover:border-emerald-500/60",
    icon: "bg-emerald-500/15 text-emerald-400",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    title: "group-hover:text-emerald-300",
    link: "text-emerald-400",
  },
  cyan: {
    hover: "hover:border-cyan-500/60",
    icon: "bg-cyan-500/15 text-cyan-400",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
    title: "group-hover:text-cyan-300",
    link: "text-cyan-400",
  },
  violet: {
    hover: "hover:border-violet-500/60",
    icon: "bg-violet-500/15 text-violet-400",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    title: "group-hover:text-violet-300",
    link: "text-violet-400",
  },
} as const

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
              VibeCart App Factory bundles focused web tools behind one shared account and entitlement system. We launch useful apps first, measure usage, then expand the library.
            </p>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {apps.map(app => {
            const Icon = app.icon
            const accent = accentClasses[app.accent as keyof typeof accentClasses]
            return (
              <Link key={app.name} href={app.href} className={`group rounded-2xl border border-neutral-800 bg-neutral-900 p-6 transition hover:bg-neutral-900/80 ${accent.hover}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className={`rounded-xl p-3 ${accent.icon}`}><Icon size={24} /></div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${accent.badge}`}>{app.status}</span>
                </div>
                <h2 className={`mt-6 text-xl font-semibold ${accent.title}`}>{app.name}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{app.description}</p>
                <p className={`mt-6 text-sm font-medium ${accent.link}`}>Open app →</p>
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
