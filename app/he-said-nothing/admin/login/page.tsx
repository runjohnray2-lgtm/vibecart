import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Merchant sign in | He Said Nothing",
  robots: { index: false, follow: false },
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  return (
    <main className="min-h-screen bg-[#26211e] px-5 py-16 text-white">
      <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-[#201c19] shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[.2em] text-[#b54d35]">He Said Nothing</div>
        <h1 className="mt-2 text-3xl font-black">Merchant orders</h1>
        <p className="mt-3 text-sm leading-6 text-black/60">Sign in to view paid orders and update fulfillment.</p>
        {error ? <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">That password did not match.</p> : null}
        <form action="/api/he-said-nothing/admin/login" method="post" className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-black">Password</span>
            <input name="password" type="password" autoComplete="current-password" required className="w-full rounded-xl border border-black/15 px-4 py-3 outline-none focus:border-[#b54d35]" />
          </label>
          <button className="w-full rounded-xl bg-[#b54d35] px-5 py-3 font-black text-white">Open orders</button>
        </form>
      </div>
    </main>
  )
}
