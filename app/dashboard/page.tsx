// DEMO — customer dashboard page showing subscription status + manage button.
// The "not authenticated" error below is EXPECTED on this demo: the
// getCurrentUserStripeCustomerId() stub in app/api/billing-portal/route.ts
// intentionally returns null until you wire in your own auth. That's the
// fail-closed security pattern working correctly, not a bug.
import { VibeManageSubscriptionButton } from "@/components/vibe-manage-subscription-button"

export default function DashboardDemo() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-lg mx-auto space-y-6">
        <h1 className="text-2xl font-bold">🛒 Customer Dashboard (demo)</h1>
        <div className="bg-amber-500/10 border border-amber-600/40 rounded-xl px-4 py-3 text-sm text-amber-300">
          🧪 This demo has no real auth wired in — clicking below will
          correctly show "not authenticated" (see the comment in{" "}
          <code>app/api/billing-portal/route.ts</code>). That's the intended
          fail-closed behavior, not a bug. Wire in your own session lookup to
          make it work end-to-end.
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-sm">Your Subscription</h2>
          <p className="text-xs text-neutral-500">
            In a real app, this section shows the current plan, status, and
            renewal date — read live from Stripe via{" "}
            <code>getSubscriptionStatus()</code> in{" "}
            <code>lib/vibe-billing.ts</code>. No local database required.
          </p>
          <VibeManageSubscriptionButton />
          <p className="text-xs text-neutral-600">
            Opens Stripe&apos;s own hosted Billing Portal — change plan,
            update card, view invoices, and cancel are all handled by Stripe,
            not custom-built here.
          </p>
        </div>
      </div>
    </main>
  )
}
