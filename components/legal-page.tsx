import Link from "next/link"

export function LegalPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-neutral-100">
      <article className="mx-auto max-w-2xl space-y-6">
        <Link href="/" className="text-sm text-emerald-400 hover:underline">
          ← VibeCart
        </Link>
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="space-y-4 text-sm leading-6 text-neutral-300">{children}</div>
      </article>
    </main>
  )
}
