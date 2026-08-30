"use client"

import { useMemo, useState } from "react"
import { PDFDocument, degrees } from "pdf-lib"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, FilePlus2, Merge, RotateCw, Scissors, Trash2 } from "lucide-react"

type LoadedPdf = {
  id: string
  file: File
  pageCount: number
}

type OrganizedPage = {
  sourceIndex: number
  rotation: number
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function parsePageSelection(value: string, pageCount: number) {
  const selected = new Set<number>()
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim()
    if (!part) continue
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-", 2)
      const start = Number(startRaw)
      const end = Number(endRaw)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) {
        throw new Error(`Invalid page range: ${part}`)
      }
      for (let page = start; page <= end; page += 1) selected.add(page - 1)
    } else {
      const page = Number(part)
      if (!Number.isInteger(page) || page < 1 || page > pageCount) throw new Error(`Invalid page: ${part}`)
      selected.add(page - 1)
    }
  }
  if (selected.size === 0) throw new Error("Choose at least one page.")
  return [...selected]
}

export function PdfToolkit() {
  const [files, setFiles] = useState<LoadedPdf[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [selectedId, setSelectedId] = useState<string>("")
  const [selection, setSelection] = useState("1")
  const [splitIndividual, setSplitIndividual] = useState(false)
  const [organizedPages, setOrganizedPages] = useState<OrganizedPage[]>([])

  const selected = useMemo(() => files.find(file => file.id === selectedId) ?? files[0] ?? null, [files, selectedId])

  async function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return
    setError("")
    const additions: LoadedPdf[] = []
    try {
      for (const file of Array.from(incoming).slice(0, Math.max(0, 10 - files.length))) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) continue
        const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false })
        additions.push({ id: crypto.randomUUID(), file, pageCount: doc.getPageCount() })
      }
      if (!additions.length) throw new Error("Choose one or more readable PDF files.")
      const next = [...files, ...additions]
      setFiles(next)
      if (!selectedId) {
        setSelectedId(next[0].id)
        setSelection(`1-${next[0].pageCount}`)
        setOrganizedPages(Array.from({ length: next[0].pageCount }, (_, sourceIndex) => ({ sourceIndex, rotation: 0 })))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read one of those PDFs.")
    }
  }

  function chooseFile(id: string) {
    const file = files.find(item => item.id === id)
    if (!file) return
    setSelectedId(id)
    setSelection(`1-${file.pageCount}`)
    setOrganizedPages(Array.from({ length: file.pageCount }, (_, sourceIndex) => ({ sourceIndex, rotation: 0 })))
    setError("")
  }

  function moveFile(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= files.length) return
    const next = [...files]
    ;[next[index], next[target]] = [next[target], next[index]]
    setFiles(next)
  }

  function removeFile(id: string) {
    const next = files.filter(item => item.id !== id)
    setFiles(next)
    if (selectedId === id) {
      const first = next[0]
      setSelectedId(first?.id ?? "")
      setSelection(first ? `1-${first.pageCount}` : "1")
      setOrganizedPages(first ? Array.from({ length: first.pageCount }, (_, sourceIndex) => ({ sourceIndex, rotation: 0 })) : [])
    }
  }

  async function mergeFiles() {
    if (files.length < 2) return setError("Add at least two PDFs to merge.")
    setBusy(true)
    setError("")
    try {
      const output = await PDFDocument.create()
      for (const item of files) {
        const source = await PDFDocument.load(await item.file.arrayBuffer())
        const copied = await output.copyPages(source, source.getPageIndices())
        copied.forEach(page => output.addPage(page))
      }
      downloadBytes(await output.save(), "vibecart-merged.pdf")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not merge these PDFs.")
    } finally {
      setBusy(false)
    }
  }

  async function extractPages() {
    if (!selected) return setError("Add a PDF first.")
    setBusy(true)
    setError("")
    try {
      const source = await PDFDocument.load(await selected.file.arrayBuffer())
      const pages = parsePageSelection(selection, selected.pageCount)
      const baseName = selected.file.name.replace(/\.pdf$/i, "")
      if (splitIndividual) {
        for (const pageIndex of pages) {
          const output = await PDFDocument.create()
          const [copied] = await output.copyPages(source, [pageIndex])
          output.addPage(copied)
          downloadBytes(await output.save(), `${baseName}-page-${pageIndex + 1}.pdf`)
        }
      } else {
        const output = await PDFDocument.create()
        const copied = await output.copyPages(source, pages)
        copied.forEach(page => output.addPage(page))
        downloadBytes(await output.save(), `${baseName}-selected-pages.pdf`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not extract those pages.")
    } finally {
      setBusy(false)
    }
  }

  function movePage(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= organizedPages.length) return
    const next = [...organizedPages]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrganizedPages(next)
  }

  function rotatePage(index: number) {
    setOrganizedPages(current => current.map((page, pageIndex) => pageIndex === index ? { ...page, rotation: (page.rotation + 90) % 360 } : page))
  }

  function deletePage(index: number) {
    setOrganizedPages(current => current.filter((_, pageIndex) => pageIndex !== index))
  }

  async function downloadOrganized() {
    if (!selected) return setError("Add a PDF first.")
    if (!organizedPages.length) return setError("Keep at least one page.")
    setBusy(true)
    setError("")
    try {
      const source = await PDFDocument.load(await selected.file.arrayBuffer())
      const output = await PDFDocument.create()
      for (const item of organizedPages) {
        const [copied] = await output.copyPages(source, [item.sourceIndex])
        const existing = copied.getRotation().angle
        copied.setRotation(degrees((existing + item.rotation) % 360))
        output.addPage(copied)
      }
      downloadBytes(await output.save(), `${selected.file.name.replace(/\.pdf$/i, "")}-organized.pdf`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not organize this PDF.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Add PDFs</h2>
            <p className="mt-1 text-sm text-neutral-400">Up to 10 files. Processing happens locally in this browser.</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 font-semibold text-neutral-950 hover:bg-violet-300">
            <FilePlus2 size={18} /> Choose PDFs
            <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={event => void addFiles(event.target.files)} />
          </label>
        </div>
        {files.length > 0 && (
          <div className="mt-5 space-y-2">
            {files.map((item, index) => (
              <div key={item.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${selected?.id === item.id ? "border-violet-500/50 bg-violet-500/10" : "border-neutral-800 bg-neutral-900"}`}>
                <button onClick={() => chooseFile(item.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium">{item.file.name}</p>
                  <p className="text-xs text-neutral-500">{item.pageCount} page{item.pageCount === 1 ? "" : "s"} · {(item.file.size / 1024 / 1024).toFixed(2)} MB</p>
                </button>
                <div className="flex items-center gap-1">
                  <button aria-label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => moveFile(index, -1)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"><ArrowUp size={16} /></button>
                  <button aria-label={`Move ${item.file.name} down`} disabled={index === files.length - 1} onClick={() => moveFile(index, 1)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 disabled:opacity-30"><ArrowDown size={16} /></button>
                  <button aria-label={`Remove ${item.file.name}`} onClick={() => removeFile(item.id)} className="rounded-lg p-2 text-neutral-400 hover:bg-red-500/10 hover:text-red-300"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400"><Merge size={20} /></div><div><h2 className="text-lg font-semibold">Merge PDFs</h2><p className="text-sm text-neutral-500">Combine files in the order shown above.</p></div></div>
          <button disabled={busy || files.length < 2} onClick={() => void mergeFiles()} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 font-semibold text-neutral-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"><Download size={17} /> Merge & download</button>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-400"><Scissors size={20} /></div><div><h2 className="text-lg font-semibold">Extract or split pages</h2><p className="text-sm text-neutral-500">Use ranges like 1-3,5,8.</p></div></div>
          <div className="mt-5 space-y-4">
            <input value={selection} onChange={event => setSelection(event.target.value)} disabled={!selected} aria-label="Pages to extract" className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-500" placeholder="1-3,5" />
            <label className="flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" checked={splitIndividual} onChange={event => setSplitIndividual(event.target.checked)} /> Save each selected page as its own PDF</label>
            <button disabled={busy || !selected} onClick={() => void extractPages()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 font-semibold text-neutral-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"><Download size={17} /> Extract & download</button>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Organize & rotate pages</h2>
            <p className="mt-1 text-sm text-neutral-500">Select a PDF above, move pages left/right, rotate, or remove pages before downloading a new copy.</p>
          </div>
          <button disabled={busy || !selected || organizedPages.length === 0} onClick={() => void downloadOrganized()} className="inline-flex items-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 font-semibold text-neutral-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-40"><Download size={17} /> Download organized PDF</button>
        </div>
        {selected ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {organizedPages.map((page, index) => (
              <div key={`${page.sourceIndex}-${index}`} className="w-36 rounded-xl border border-neutral-700 bg-neutral-950 p-3">
                <p className="text-sm font-semibold">Page {page.sourceIndex + 1}</p>
                <p className="mt-1 text-xs text-neutral-500">Rotation {page.rotation}°</p>
                <div className="mt-3 grid grid-cols-4 gap-1">
                  <button aria-label={`Move page ${page.sourceIndex + 1} left`} disabled={index === 0} onClick={() => movePage(index, -1)} className="rounded-md bg-neutral-800 p-1.5 text-neutral-300 disabled:opacity-30"><ArrowLeft size={14} /></button>
                  <button aria-label={`Move page ${page.sourceIndex + 1} right`} disabled={index === organizedPages.length - 1} onClick={() => movePage(index, 1)} className="rounded-md bg-neutral-800 p-1.5 text-neutral-300 disabled:opacity-30"><ArrowRight size={14} /></button>
                  <button aria-label={`Rotate page ${page.sourceIndex + 1}`} onClick={() => rotatePage(index)} className="rounded-md bg-neutral-800 p-1.5 text-neutral-300"><RotateCw size={14} /></button>
                  <button aria-label={`Delete page ${page.sourceIndex + 1}`} onClick={() => deletePage(index)} className="rounded-md bg-neutral-800 p-1.5 text-red-300"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-6 text-sm text-neutral-500">Add a PDF to organize its pages.</p>}
      </section>

      <p className="text-center text-xs text-neutral-600">VibeCart PDF Toolkit does not upload your source PDFs to VibeCart. Password-protected PDFs may require removal of encryption before processing.</p>
    </div>
  )
}
