import Link from "next/link"
import { redirect } from "next/navigation"
import { getAuth } from "@/lib/auth/server"
import { ensureInitialAppTrial, hasAppAccess } from "@/lib/app-library"
import { PdfToolkit } from "@/components/pdf-toolkit"

export const dynamic = "force-dynamic"

export default async function PdfAppPage() {
  const { data } = await getAuth().getSession()
  if (!data?.user) redirect("/auth/sign-in?next=/apps/pdf")

  await ensureInitialAppTrial(data.user.id, "pdf")
  const allowed = await hasAppAccess(data.user.id, "pdf")
  if (!allowed) redirect("/apps")

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-violet-400">VibeCart App Factory</p>
            <h1 className="mt-3 text-4xl font-bold md:text-5xl">PDF Toolkit</h1>
            <p className="mt-3 max-w-2xl text-neutral-400">Merge PDFs, extract or split pages, reorder pages, rotate pages, and remove pages. Source PDFs stay in your browser and are not uploaded to VibeCart.</p>
          </div>
          <div className="text-right text-sm text-neutral-400">
            <p>{data.user.email}</p>
            <Link href="/apps" className="mt-2 inline-block text-violet-400 hover:text-violet-300">Back to app library</Link>
          </div>
        </header>
        <PdfToolkit />
      </div>
    </main>
  )
}
