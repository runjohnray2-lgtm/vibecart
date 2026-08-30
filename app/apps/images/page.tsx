import Link from "next/link"
import { redirect } from "next/navigation"
import { getAuth } from "@/lib/auth/server"
import { ensureInitialAppTrial, hasAppAccess } from "@/lib/app-library"
import { ImageToolkit } from "@/components/image-toolkit"

export const dynamic = "force-dynamic"

export default async function ImagesAppPage() {
  const { data } = await getAuth().getSession()
  if (!data?.user) redirect("/auth/sign-in?next=/apps/images")

  await ensureInitialAppTrial(data.user.id, "images")
  const allowed = await hasAppAccess(data.user.id, "images")
  if (!allowed) redirect("/apps")

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">VibeCart App Factory</p>
            <h1 className="mt-3 text-4xl font-bold md:text-5xl">Image Toolkit</h1>
            <p className="mt-3 max-w-2xl text-neutral-400">Resize, compress, and convert images in batches. Processing stays in your browser, so your source files are not uploaded to VibeCart.</p>
          </div>
          <div className="text-right text-sm text-neutral-400">
            <p>{data.user.email}</p>
            <Link href="/apps" className="mt-2 inline-block text-cyan-400 hover:text-cyan-300">Back to app library</Link>
          </div>
        </header>
        <ImageToolkit />
      </div>
    </main>
  )
}
