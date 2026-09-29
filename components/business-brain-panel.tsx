"use client"
import { useEffect, useState } from "react"

type CustomerRow = {
  id: string
  display_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
  source_system?: string | null
  source_name?: string | null
}

type ImportRow = {
  id: string
  source_system?: string | null
  source_name?: string | null
  status?: string | null
  accepted_count?: number | string | null
  rejected_count?: number | string | null
}

type Snapshot = {
  workspace: null | { id:string; name:string; accountKey:string }
  customers: CustomerRow[]
  imports: ImportRow[]
}

export function BusinessBrainPanel() {
  const [snapshot,setSnapshot] = useState<Snapshot | null>(null)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState("")

  async function refresh() {
    const res = await fetch("/api/business-brain", { cache:"no-store" })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Unable to load Business Brain")
    setSnapshot(data)
  }

  useEffect(() => { refresh().catch(e => setMessage(e.message)) }, [])

  async function ensure() {
    setBusy(true); setMessage("")
    try {
      const res = await fetch("/api/business-brain", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"ensure-workspace",businessName:"SeekPwr Co."}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Unable to create workspace")
      setMessage("SeekPwr workspace ready.")
      await refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed") } finally { setBusy(false) }
  }

  async function importFile(file: File) {
    setBusy(true); setMessage("")
    try {
      const csvText = await file.text()
      const res = await fetch("/api/business-brain", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"import-customers",businessName:"SeekPwr Co.",sourceSystem:"seekpwr_csv",sourceName:file.name,csvText}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Import failed")
      setMessage(data.idempotentReplay ? "This exact file was already imported; no duplicates were created." : `Imported ${data.acceptedCount} customers; ${data.rejectedCount} rows rejected.`)
      await refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : "Import failed") } finally { setBusy(false) }
  }

  return <div className="space-y-8">
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm uppercase tracking-wider text-emerald-400">Workspace</p><h2 className="mt-1 text-2xl font-semibold">{snapshot?.workspace?.name ?? "SeekPwr Co."}</h2></div>
        {!snapshot?.workspace && <button disabled={busy} onClick={ensure} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50">Create SeekPwr workspace</button>}
      </div>
      {snapshot?.workspace && <p className="mt-3 text-sm text-neutral-400">Persistent workspace ID: {snapshot.workspace.id}</p>}
    </section>
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <p className="text-sm uppercase tracking-wider text-emerald-400">Customer CSV</p>
      <h2 className="mt-1 text-2xl font-semibold">Import customers</h2>
      <p className="mt-2 text-sm text-neutral-400">Re-importing the same file is idempotent. Existing source records update instead of duplicating customers.</p>
      <input className="mt-4 block w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const f=e.target.files?.[0]; if (f) importFile(f) }} />
      {message && <p className="mt-4 text-sm text-neutral-300">{message}</p>}
    </section>
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="flex justify-between gap-4"><div><p className="text-sm uppercase tracking-wider text-emerald-400">Customers</p><h2 className="mt-1 text-2xl font-semibold">{snapshot?.customers?.length ?? 0} loaded</h2></div><button onClick={() => refresh().catch(e=>setMessage(e.message))} className="text-sm text-emerald-400">Refresh</button></div>
      <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-neutral-500"><tr><th className="pb-3">Name</th><th className="pb-3">Company</th><th className="pb-3">Email</th><th className="pb-3">Phone</th><th className="pb-3">Source</th></tr></thead><tbody>
        {(snapshot?.customers ?? []).map((c:CustomerRow) => <tr key={String(c.id)} className="border-t border-neutral-800"><td className="py-3">{String(c.display_name ?? "")}</td><td>{String(c.company_name ?? "")}</td><td>{String(c.email ?? "")}</td><td>{String(c.phone ?? "")}</td><td>{String(c.source_name ?? c.source_system ?? "")}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <p className="text-sm uppercase tracking-wider text-emerald-400">Source history</p>
      <div className="mt-4 space-y-3">{(snapshot?.imports ?? []).map((i:ImportRow) => <div key={String(i.id)} className="rounded-lg border border-neutral-800 p-3 text-sm"><div className="font-medium">{String(i.source_name ?? i.source_system)}</div><div className="mt-1 text-neutral-400">{String(i.status)} · {Number(i.accepted_count ?? 0)} accepted · {Number(i.rejected_count ?? 0)} rejected</div></div>)}</div>
    </section>
  </div>
}