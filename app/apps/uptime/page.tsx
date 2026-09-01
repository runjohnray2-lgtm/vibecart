import Link from "next/link"
import { redirect } from "next/navigation"
import { getAuth } from "@/lib/auth/server"
import { UptimeMonitorManager } from "@/components/uptime-monitor-manager"

export const dynamic = "force-dynamic"

export default async function UptimeAppPage() {
  const { data } = await getAuth().getSession()
  if (!data?.user) redirect("/auth/sign-in?next=/apps/uptime")

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">VibeCart App Factory</p>
            <h1 className="mt-3 text-4xl font-bold md:text-5xl">Uptime Monitor</h1>
            <p className="mt-3 max-w-2xl text-neutral-400">Monitor public websites on a recurring schedule and see the latest status, latency, and error without exposing private-network targets.</p>
          </div>
          <div className="text-right text-sm text-neutral-400">
            <p>{data.user.email}</p>
            <Link href="/apps" className="mt-2 inline-block text-emerald-400 hover:text-emerald-300">All VibeCart apps</Link>
          </div>
        </header>
        <UptimeMonitorManager />
      </div>
    </main>
  )
}
