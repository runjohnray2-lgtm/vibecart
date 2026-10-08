"use client"
import { useState } from "react"

type Item = Record<string, unknown>
type Brief = {
  generatedAt:string
  workspace: {id:string;name:string}|null
  customerCount:number
  activeRules:Item[]
  recentMemories:Item[]
  latestImports:Item[]
  openActions:Item[]
  recentActions:Item[]
  sourceChecks:{name:string;status:string;detail:string}[]
  audit:{status:string;id?:string}
}

export function StartMyDay() {
  const [brief,setBrief] = useState<Brief|null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState("")
  const [note,setNote] = useState("")
  const [noteStatus,setNoteStatus] = useState("")

  async function start() {
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/business-brain",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"start-day",businessName:"SeekPwr Co."}),cache:"no-store",
      })
      const data = await res.json()
      if(!res.ok) throw new Error(data.error || "Could not load report")
      setBrief(data)
    } catch(e) { setError(e instanceof Error ? e.message : "Report failed") }
    finally { setBusy(false) }
  }

  async function saveNote() {
    setBusy(true); setNoteStatus("")
    try {
      const res = await fetch("/api/business-brain", {
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"save-memory",businessName:"SeekPwr Co.",memoryType:"note",content:note.trim()}),
      })
      const data = await res.json()
      if(!res.ok) throw new Error(data.error || "Note not saved")
      setNote(""); setNoteStatus("Customer update saved permanently.")
      await start()
    } catch(e) { setNoteStatus(e instanceof Error ? e.message : "Note not saved") }
    finally { setBusy(false) }
  }

  const items = (rows:Item[], field:string) => rows.map((row,index)=>
    <div key={String(row.id ?? index)} className="rounded-lg border border-neutral-700 p-3 text-sm">
      <p>{String(row[field] ?? "Unknown")}</p>
      {row.status && <p className="text-neutral-400">Status: {String(row.status)}</p>}
    </div>
  )

  return <section className="mb-8 space-y-5 rounded-2xl border border-neutral-700 bg-neutral-900 p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm uppercase tracking-wider text-emerald-400">Business Brain</p>
        <h2 className="mt-1 text-3xl font-semibold">Start My Day</h2>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">Read stored business records, unfinished actions and customer notes. Check sources explicitly before claiming work is complete.</p>
      </div>
      <button type="button" onClick={start} disabled={busy} className="rounded-lg bg-emerald-500 px-6 py-3 font-bold text-black disabled:opacity-50">
        {busy ? "Checking..." : "Start My Day"}
      </button>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">Failed: {error}. No successful check is being claimed.</p>}
    {brief && <>
      <p className="text-sm text-neutral-400">Generated {new Date(brief.generatedAt).toLocaleString()} · Audit: {brief.audit.status}</p>
      {!brief.workspace && <p role="alert" className="text-amber-300">No SeekPwr workspace exists for this sign-in. Create the workspace below, or sign in using the account holding your records.</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-neutral-700 p-4"><p className="text-sm text-neutral-400">Stored customers</p><strong className="text-2xl">{brief.customerCount}</strong></div>
        <div className="rounded-lg border border-neutral-700 p-4"><p className="text-sm text-neutral-400">Outstanding logged actions</p><strong className="text-2xl">{brief.openActions.length}</strong></div>
        <div className="rounded-lg border border-neutral-700 p-4"><p className="text-sm text-neutral-400">Active saved rules (retrieved)</p><strong className="text-2xl">{brief.activeRules.length}</strong></div>
      </div>
      <div className="rounded-lg border border-amber-700 p-4 text-sm">
        <strong>Live Gmail and orders have NOT been checked.</strong>
        <p className="mt-2 text-neutral-300">ChatGPT account connections are separate from this VibeCart application. Until the app connects directly to the services, this report is incomplete. An empty action log does not mean all customer work is done.</p>
      </div>
      <div><h3 className="font-semibold">Source checks</h3>
        <div className="mt-2 space-y-2">{brief.sourceChecks.map(s=><div key={s.name} className="rounded-lg border border-neutral-700 p-3 text-sm"><strong>{s.name}: {s.status.replaceAll("_"," ")}</strong><p className="mt-1 text-neutral-400">{s.detail}</p></div>)}</div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div><h3 className="font-semibold">Pending or failed recorded actions</h3><div className="mt-2 space-y-2">{brief.openActions.length?items(brief.openActions,"action_type"):<p className="text-sm text-neutral-400">Nothing open in this log. Other systems are not yet verified.</p>}</div></div>
        <div><h3 className="font-semibold">Last verified completed actions</h3><div className="mt-2 space-y-2">{brief.recentActions.length?items(brief.recentActions,"action_type"):<p className="text-sm text-neutral-400">No recorded completions.</p>}</div></div>
        <div><h3 className="font-semibold">Stored customer and business notes</h3><div className="mt-2 space-y-2">{brief.recentMemories.length?items(brief.recentMemories,"content"):<p className="text-sm text-neutral-400">No stored notes.</p>}</div></div>
        <div><h3 className="font-semibold">Recent imports</h3><div className="mt-2 space-y-2">{brief.latestImports.length?items(brief.latestImports,"source_name"):<p className="text-sm text-neutral-400">No imports found.</p>}</div></div>
      </div>
      <div>
        <h3 className="font-semibold">Record a phone conversation or customer decision</h3>
        <p className="mt-1 text-sm text-neutral-400">Include the customer, order number, what was agreed, and next action. Saving this note does not change an order.</p>
        <textarea maxLength={4000} value={note} onChange={e=>setNote(e.target.value)} className="mt-3 min-h-24 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3" placeholder="Spoke with customer about order #...; agreed to ..."/>
        <button type="button" disabled={busy||!brief.workspace||!note.trim()} onClick={saveNote} className="mt-2 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50">Save update</button>
        {noteStatus && <p role="status" className="mt-2 text-sm text-neutral-300">{noteStatus}</p>}
      </div>
    </>}
  </section>
}
