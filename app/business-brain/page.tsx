import { redirect } from "next/navigation"
import { getAuth } from "@/lib/auth/server"
import { BusinessBrainPanel } from "@/components/business-brain-panel"

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
            Persistent business workspace, customer imports, and source history.
          </p>
          <p className="mt-2 text-sm text-neutral-500">Signed in as {data.user.email}</p>
        </header>
        <BusinessBrainPanel />
      </div>
    </main>
  )
}
