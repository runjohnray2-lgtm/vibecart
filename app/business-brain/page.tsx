import { redirect } from "next/navigation"
import { getAuth } from "@/lib/auth/server"
import { BusinessBrainPanel } from "@/components/business-brain-panel"
import { StartMyDay } from "@/components/start-my-day"

export const dynamic = "force-dynamic"

export default async function BusinessBrainPage() {
  const { data } = await getAuth().getSession()
  if (!data?.user) redirect("/auth/sign-in?next=/business-brain")

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
            VibeCart Business Brain
          </p>
          <h1 className="mt-3 text-4xl font-bold">SeekPwr</h1>
          <p className="mt-3 max-w-2xl text-neutral-400">
            Start the day with stored business facts, an action history, and explicit connection status.
          </p>
          <p className="mt-2 text-sm text-neutral-500">Signed in as {data.user.email}</p>
        </header>
        <StartMyDay />
        <BusinessBrainPanel />
      </div>
    </main>
  )
}
