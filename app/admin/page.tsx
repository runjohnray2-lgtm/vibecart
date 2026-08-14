// DEMO — admin subscribers view. The "not authorized" result below is
// EXPECTED: isCurrentUserAdmin() in app/api/admin/subscribers/route.ts
// intentionally returns false until you wire in your own admin check.
import { VibeAdminSubscribersTable } from "@/components/vibe-admin-subscribers-table"

export default function AdminDemo() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">🛒 Admin — Subscribers (demo)</h1>
        <div className="bg-amber-500/10 border border-amber-600/40 rounded-xl px-4 py-3 text-sm text-amber-300">
          🧪 This demo has no real admin check wired in — the table below
          will correctly show "Not authorized" (see the comment in{" "}
          <code>app/api/admin/subscribers/route.ts</code>). That&apos;s the
          intended fail-closed behavior, not a bug. Add your own admin check
          to make it work end-to-end.
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <VibeAdminSubscribersTable />
        </div>

        <p className="text-xs text-neutral-600">
          Data is read live from Stripe on every load — no database required,
          and no VibeCart-managed copy of subscription state to keep in sync.
        </p>
      </div>
    </main>
  )
}
