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

type RuleRow = { id:string; rule_text?:string|null; source?:string|null }
type MemoryRow = { id:string; memory_type?:string|null; content?:string|null; source?:string|null }
type Snapshot = {
  workspace: null | { id:string; name:string; accountKey:string }
  customers: CustomerRow[]
  imports: ImportRow[]
  rules: RuleRow[]
  memories: MemoryRow[]
}

export function BusinessBrainPanel() {
  const [snapshot,setSnapshot] = useState<Snapshot | null>(null)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState("")
  const [ruleText,setRuleText] = useState("")
  const [memoryText,setMemoryText] = useState("")
  const [memoryType,setMemoryType] = useState("fact")

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

  async function save(action:"save-rule"|"save-memory") {
    setBusy(true); setMessage("")
    try {
      const body = action === "save-rule"
        ? {action,businessName:"SeekPwr Co.",ruleText}
        : {action,businessName:"SeekPwr Co.",memoryType,content:memoryText}
      const res = await fetch("/api/business-brain", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Save failed")
      if (action === "save-rule") setRuleText(""); else setMemoryText("")
      setMessage(action === "save-rule" ? "Business rule saved permanently." : "Business memory saved permanently.")
      await refresh()
    } catch(e) { setMessage(e instanceof Error ? e.message : "Save failed") } finally { setBusy(false) }
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
      <p className="text-sm uppercase tracking-wider text-emerald-400">Permanent knowledge</p>
      <h2 className="mt-1 text-2xl font-semibold">Business rules & memory</h2>
      <p className="mt-2 text-sm text-neutral-400">Store operating rules and durable facts that Business Brain should keep using.</p>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div><label className="text-sm font-medium">Permanent business rule</label><textarea value={ruleText} onChange={e=>setRuleText(e.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3" placeholder="Example: Never send dealer outreach unless Ray explicitly approves it."/><button disabled={busy || !ruleText.trim() || !snapshot?.workspace} onClick={()=>save("save-rule")} className="mt-2 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50">Save rule</button></div>
        <div><label className="text-sm font-medium">Business memory</label><select value={memoryType} onChange={e=>setMemoryType(e.target.value)} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3"><option value="fact">Fact</option><option value="decision">Decision</option><option value="preference">Preference</option><option value="note">Note</option></select><textarea value={memoryText} onChange={e=>setMemoryText(e.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3" placeholder="Example: SeekPwr is the motorcycle-kit brand."/><button disabled={busy || !memoryText.trim() || !snapshot?.workspace} onClick={()=>save("save-memory")} className="mt-2 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50">Save memory</button></div>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2"><div><h3 className="font-semibold">Active rules</h3><div className="mt-3 space-y-2">{(snapshot?.rules ?? []).map(r=><div key={r.id} className="rounded-lg border border-neutral-800 p-3 text-sm">{String(r.rule_text ?? "")}</div>)}</div></div><div><h3 className="font-semibold">Saved memories</h3><div className="mt-3 space-y-2">{(snapshot?.memories ?? []).map(m=><div key={m.id} className="rounded-lg border border-neutral-800 p-3 text-sm"><span className="mr-2 uppercase text-neutral-500">{String(m.memory_type ?? "")}</span>{String(m.content ?? "")}</div>)}</div></div></div>
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