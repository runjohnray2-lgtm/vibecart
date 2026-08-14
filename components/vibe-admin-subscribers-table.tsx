"use client"

import { useEffect, useState } from "react"
import { VibeAdminSubscriberRow } from "@/lib/vibe-billing"

interface VibeAdminSubscribersTableProps {
  // Endpoint that returns subscriber data — MUST be gated behind your own
  // admin-only auth check server-side. See app/api/admin/subscribers/route.ts.
  endpoint?: string
}

const STATUS_COLOR: Record<string, string> = {
  active: "text-green-400",
  trialing: "text-blue-400",
  past_due: "text-amber-400",
  canceled: "text-red-400",
  incomplete: "text-neutral-500",
  incomplete_expired: "text-neutral-500",
  unpaid: "text-red-400",
  paused: "text-neutral-500",
}

// Drop-in admin view of all subscribers, read live from Stripe (no database
// required). Renders customer email, plan, status, price, and renewal date.
export function VibeAdminSubscribersTable({ endpoint = "/api/admin/subscribers" }: VibeAdminSubscribersTableProps) {
  const [rows, setRows] = useState<VibeAdminSubscriberRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(endpoint)
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          setError(data.error ?? "Failed to load subscribers")
          return
        }
        setRows(data.subscribers)
      })
      .catch(err => setError(`Network error: ${String(err)}`))
  }, [endpoint])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!rows) return <div className="text-sm text-neutral-500">Loading subscribers…</div>
  if (rows.length === 0) return <div className="text-sm text-neutral-500">No subscribers yet.</div>

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left text-neutral-500 border-b border-neutral-800">
          <th className="py-2 pr-4">Customer</th>
          <th className="py-2 pr-4">Plan</th>
          <th className="py-2 pr-4">Status</th>
          <th className="py-2 pr-4">Price</th>
          <th className="py-2 pr-4">Renews / Ends</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.subscriptionId} className="border-b border-neutral-900">
            <td className="py-2 pr-4">{row.customerEmail}</td>
            <td className="py-2 pr-4">{row.planName}</td>
            <td className={`py-2 pr-4 font-medium ${STATUS_COLOR[row.status] ?? "text-neutral-400"}`}>
              {row.status}{row.cancelAtPeriodEnd ? " (cancels at period end)" : ""}
            </td>
            <td className="py-2 pr-4">${(row.priceCents / 100).toFixed(2)}</td>
            <td className="py-2 pr-4">
              {row.currentPeriodEnd ? new Date(row.currentPeriodEnd).toLocaleDateString() : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
