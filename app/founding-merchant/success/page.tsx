import Link from "next/link"

export default function FoundingMerchantSuccessPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-16 text-neutral-100">
      <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 md:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300">VibeCart Founding Merchant</p>
        <h1 className="mt-3 text-4xl font-bold">Payment received.</h1>
        <p className="mt-5 leading-7 text-neutral-300">
          Your Founding Merchant setup is in the queue. Use the support page to send the storefront URL, catalog source, and the best technical contact so the integration can be started.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/support" className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 hover:bg-emerald-400">
            Send setup details
          </Link>
          <Link href="/start" className="rounded-lg border border-neutral-700 px-5 py-3 font-semibold hover:border-neutral-500">
            View technical quickstart
          </Link>
        </div>
      </div>
    </main>
  )
}
