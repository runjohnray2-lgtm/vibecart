"use client"

import { useState } from "react"

export function AppFactorySubscribeButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function subscribe() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/apps/subscribe", { method: "POST" })
      if (res.status === 401) {
        window.location.href = "/auth/sign-in?next=/apps"
        return
      }
      const body = await res.json()
      if (!res.ok || !body.url) throw new Error(body.error || "Unable to start checkout")
      window.location.href = body.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout")
      setBusy(false)
    }
  }

  return (
    <div>
      <button onClick={subscribe} disabled={busy} className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 disabled:opacity-50">
        {busy ? "Opening checkout…" : "Get all-app access"}
      </button>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  )
}
