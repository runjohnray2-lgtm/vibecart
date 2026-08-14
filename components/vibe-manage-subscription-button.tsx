"use client"

import { useState } from "react"

interface VibeManageSubscriptionButtonProps {
  className?: string
  label?: string
  // Endpoint that creates a Billing Portal session for the CURRENT logged-in
  // user server-side (see app/api/billing-portal/route.ts). No customer ID
  // is passed from here — the server resolves it from your own auth session,
  // never from the client. This is intentional; see the security note in
  // that route file before changing it.
  endpoint?: string
}

// Drop-in "Manage Subscription" button. Redirects to Stripe's own hosted
// Billing Portal, where the customer can change plan, update payment method,
// view invoices, and cancel — all handled by Stripe, not custom-built here.
export function VibeManageSubscriptionButton({
  className,
  label = "Manage Subscription",
  endpoint = "/api/billing-portal",
}: VibeManageSubscriptionButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint, { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        setError(data.error ?? "Could not open billing portal")
        return
      }
      window.location.href = data.url
    } catch (err) {
      setError(`Network error: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={className ?? "bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm"}
      >
        {loading ? "Opening…" : label}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 max-w-xs">{error}</p>}
    </div>
  )
}
