"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"

interface Monitor {
  id: number
  name: string
  url: string
  method: "GET" | "HEAD"
  expectedStatus: number
  intervalSeconds: number
  isActive: boolean
  lastCheckedAt: string | null
  lastStatus: number | null
  lastLatencyMs: number | null
  lastError: string | null
}

export function UptimeMonitorManager() {
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [intervalSeconds, setIntervalSeconds] = useState(300)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/apps/uptime", { cache: "no-store" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Unable to load monitors")
      setMonitors(body.monitors ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load monitors")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function createMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/apps/uptime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, url, intervalSeconds }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Unable to create monitor")
      setName("")
      setUrl("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create monitor")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-xl font-semibold">Add monitor</h2>
        <p className="mt-2 text-sm text-neutral-400">Check a public website on a recurring schedule and track its latest response.</p>
        <form onSubmit={createMonitor} className="mt-6 space-y-4">
          <label className="block text-sm text-neutral-300">Name
            <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Storefront" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500" />
          </label>
          <label className="block text-sm text-neutral-300">URL
            <input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500" />
          </label>
          <label className="block text-sm text-neutral-300">Check interval
            <select value={intervalSeconds} onChange={e => setIntervalSeconds(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100">
              <option value={60}>Every minute</option>
              <option value={300}>Every 5 minutes</option>
              <option value={900}>Every 15 minutes</option>
              <option value={1800}>Every 30 minutes</option>
              <option value={3600}>Every hour</option>
            </select>
          </label>
          <button disabled={saving} className="w-full rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-neutral-950 disabled:opacity-50">{saving ? "Adding…" : "Add monitor"}</button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Your monitors</h2>
            <p className="mt-1 text-sm text-neutral-400">Latest status and response time from the monitoring runner.</p>
          </div>
          <button onClick={() => void load()} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-500">Refresh</button>
        </div>
        {error && <div className="mb-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{error}</div>}
        {loading ? <p className="text-neutral-400">Loading monitors…</p> : monitors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-700 p-10 text-center text-neutral-400">No monitors yet. Add your first site to begin tracking uptime.</div>
        ) : (
          <div className="space-y-3">
            {monitors.map(monitor => {
              const hasCheck = monitor.lastCheckedAt !== null
              const up = hasCheck && monitor.lastStatus === monitor.expectedStatus && !monitor.lastError
              return <article key={monitor.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${!hasCheck ? "bg-neutral-500" : up ? "bg-emerald-400" : "bg-red-400"}`} />
                      <h3 className="font-semibold">{monitor.name}</h3>
                    </div>
                    <p className="mt-2 truncate text-sm text-neutral-400">{monitor.url}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className={up ? "text-emerald-400" : hasCheck ? "text-red-300" : "text-neutral-400"}>{!hasCheck ? "Awaiting first check" : up ? "Up" : "Down"}</p>
                    <p className="mt-1 text-neutral-500">{monitor.lastStatus ?? "—"} · {monitor.lastLatencyMs == null ? "—" : `${monitor.lastLatencyMs} ms`}</p>
                  </div>
                </div>
                {monitor.lastError && <p className="mt-3 text-sm text-red-300">{monitor.lastError}</p>}
                <p className="mt-4 text-xs text-neutral-500">Checks every {Math.round(monitor.intervalSeconds / 60)} min{monitor.lastCheckedAt ? ` · Last checked ${new Date(monitor.lastCheckedAt).toLocaleString()}` : ""}</p>
              </article>
            })}
          </div>
        )}
      </section>
    </div>
  )
}
