"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import QRCode from "react-qr-code"
import { Copy, Download, ExternalLink, Link2, Plus } from "lucide-react"

type ShortLink = {
  id: number
  slug: string
  destinationUrl: string
  title: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  clickCount: number
  lastClickedAt: string | null
  createdAt: string
}

const emptyForm = {
  title: "",
  slug: "",
  destinationUrl: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
}

export function LinkManager() {
  const [links, setLinks] = useState<ShortLink[]>([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const origin = useMemo(() => typeof window === "undefined" ? "" : window.location.origin, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/apps/links", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load links")
      setLinks(data.links || [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load links")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function update(name: keyof typeof form, value: string) {
    setForm(current => ({ ...current, [name]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/apps/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to create link")
      setForm(emptyForm)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create link")
    } finally {
      setBusy(false)
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value)
  }

  function downloadQr(link: ShortLink) {
    const svg = document.getElementById(`qr-${link.id}`)?.querySelector("svg")
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${link.slug}-qr.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 md:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400"><Plus size={20} /></div>
          <div>
            <h2 className="text-xl font-semibold">Create a tracked link</h2>
            <p className="text-sm text-neutral-400">Short URL, QR code, UTM campaign tags, and click tracking in one place.</p>
          </div>
        </div>

        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <Field label="Title" value={form.title} onChange={value => update("title", value)} placeholder="Summer campaign" />
          <Field label="Short code" value={form.slug} onChange={value => update("slug", value)} placeholder="summer26" required />
          <div className="md:col-span-2"><Field label="Destination URL" value={form.destinationUrl} onChange={value => update("destinationUrl", value)} placeholder="https://example.com/product" required /></div>
          <Field label="UTM source" value={form.utmSource} onChange={value => update("utmSource", value)} placeholder="facebook" />
          <Field label="UTM medium" value={form.utmMedium} onChange={value => update("utmMedium", value)} placeholder="social" />
          <Field label="UTM campaign" value={form.utmCampaign} onChange={value => update("utmCampaign", value)} placeholder="summer_sale" />
          <Field label="UTM term" value={form.utmTerm} onChange={value => update("utmTerm", value)} placeholder="optional" />
          <div className="md:col-span-2"><Field label="UTM content" value={form.utmContent} onChange={value => update("utmContent", value)} placeholder="ad_variant_a" /></div>
          {error && <p className="md:col-span-2 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
          <button disabled={busy} className="md:col-span-2 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50">
            {busy ? "Creating…" : "Create short link + QR"}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Your links</h2>
            <p className="text-sm text-neutral-500">{links.length} tracked {links.length === 1 ? "link" : "links"}</p>
          </div>
          <button onClick={() => void load()} className="text-sm text-emerald-400 hover:text-emerald-300">Refresh analytics</button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">Loading links…</div>
        ) : links.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 p-10 text-center text-neutral-400">
            <Link2 className="mx-auto mb-3" />
            Create your first tracked link above.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {links.map(link => {
              const shortUrl = `${origin}/r/${link.slug}`
              return (
                <article key={link.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <div className="flex gap-4">
                    <div id={`qr-${link.id}`} className="h-fit shrink-0 rounded-lg bg-white p-2">
                      <QRCode value={shortUrl} size={92} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{link.title || link.slug}</h3>
                      <p className="mt-1 truncate text-sm text-emerald-400">{shortUrl}</p>
                      <p className="mt-2 truncate text-xs text-neutral-500">→ {link.destinationUrl}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => void copy(shortUrl)} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs hover:border-neutral-500"><Copy size={13} /> Copy</button>
                        <button onClick={() => downloadQr(link)} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs hover:border-neutral-500"><Download size={13} /> QR SVG</button>
                        <a href={shortUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs hover:border-neutral-500"><ExternalLink size={13} /> Open</a>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-neutral-800 pt-4 text-sm">
                    <div><p className="text-neutral-500">Clicks</p><p className="mt-1 text-2xl font-semibold">{link.clickCount}</p></div>
                    <div><p className="text-neutral-500">Last click</p><p className="mt-1">{link.lastClickedAt ? new Date(link.lastClickedAt).toLocaleString() : "—"}</p></div>
                  </div>
                  {(link.utmSource || link.utmMedium || link.utmCampaign) && (
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-neutral-400">
                      {link.utmSource && <Tag>source: {link.utmSource}</Tag>}
                      {link.utmMedium && <Tag>medium: {link.utmMedium}</Tag>}
                      {link.utmCampaign && <Tag>campaign: {link.utmCampaign}</Tag>}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-300">{label}</span>
      <input required={required} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 outline-none transition placeholder:text-neutral-600 focus:border-emerald-500" />
    </label>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-neutral-700 px-2 py-1">{children}</span>
}
