import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/server"
import { LinkManager } from "@/components/link-manager"

export const dynamic = "force-dynamic"

export default async function LinksAppPage() {
  const { data } = await auth.getSession()
  if (!data?.user) redirect("/auth/sign-in?next=/apps/links")

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">VibeCart App Factory</p>
            <h1 className="mt-3 text-4xl font-bold md:text-5xl">Link + QR + UTM Manager</h1>
            <p className="mt-3 max-w-2xl text-neutral-400">Create editable short links, campaign-tagged destinations, downloadable QR codes, and privacy-minimized click analytics.</p>
          </div>
          <div className="text-right text-sm text-neutral-400">
            <p>{data.user.email}</p>
            <Link href="/" className="mt-2 inline-block text-emerald-400 hover:text-emerald-300">VibeCart home</Link>
          </div>
        </header>
        <LinkManager />
      </div>
    </main>
  )
}
