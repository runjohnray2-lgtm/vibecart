"use client"

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react"
import { Download, FileImage, ImageDown, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react"

type OutputFormat = "image/jpeg" | "image/png" | "image/webp"
type ResizeMode = "original" | "width" | "height" | "percent"

type SourceImage = {
  id: string
  file: File
  previewUrl: string
  width: number
  height: number
}

type ProcessedImage = {
  id: string
  sourceName: string
  url: string
  blob: Blob
  width: number
  height: number
  bytesBefore: number
  bytesAfter: number
}

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function humanBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function extensionFor(format: OutputFormat) {
  if (format === "image/jpeg") return "jpg"
  if (format === "image/webp") return "webp"
  return "png"
}

function safeBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image"
}

async function dimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const result = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return result
}

export function ImageToolkit() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<SourceImage[]>([])
  const [results, setResults] = useState<ProcessedImage[]>([])
  const [resizeMode, setResizeMode] = useState<ResizeMode>("original")
  const [resizeValue, setResizeValue] = useState(1200)
  const [format, setFormat] = useState<OutputFormat>("image/webp")
  const [quality, setQuality] = useState(82)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalBefore = useMemo(() => sources.reduce((sum, item) => sum + item.file.size, 0), [sources])
  const totalAfter = useMemo(() => results.reduce((sum, item) => sum + item.bytesAfter, 0), [results])

  async function addFiles(files: FileList | File[]) {
    setError(null)
    const chosen = Array.from(files).filter(file => file.type.startsWith("image/"))
    if (!chosen.length) {
      setError("Choose JPG, PNG, WebP, GIF, BMP, or another browser-readable image file.")
      return
    }
    if (sources.length + chosen.length > 30) {
      setError("This first release supports up to 30 images in one batch.")
      return
    }

    const loaded: SourceImage[] = []
    for (const file of chosen) {
      try {
        const size = await dimensions(file)
        loaded.push({ id: uid(), file, previewUrl: URL.createObjectURL(file), ...size })
      } catch {
        setError(`Could not read ${file.name}. The other compatible files were kept.`)
      }
    }
    setSources(current => [...current, ...loaded])
    clearResults()
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files)
    event.target.value = ""
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files)
  }

  function clearResults() {
    setResults(current => {
      current.forEach(item => URL.revokeObjectURL(item.url))
      return []
    })
  }

  function removeSource(id: string) {
    setSources(current => {
      const match = current.find(item => item.id === id)
      if (match) URL.revokeObjectURL(match.previewUrl)
      return current.filter(item => item.id !== id)
    })
    clearResults()
  }

  function clearAll() {
    sources.forEach(item => URL.revokeObjectURL(item.previewUrl))
    results.forEach(item => URL.revokeObjectURL(item.url))
    setSources([])
    setResults([])
    setError(null)
  }

  function targetSize(width: number, height: number) {
    if (resizeMode === "width") {
      const targetWidth = Math.max(1, Math.min(12000, Math.trunc(resizeValue)))
      return { width: targetWidth, height: Math.max(1, Math.round(height * targetWidth / width)) }
    }
    if (resizeMode === "height") {
      const targetHeight = Math.max(1, Math.min(12000, Math.trunc(resizeValue)))
      return { width: Math.max(1, Math.round(width * targetHeight / height)), height: targetHeight }
    }
    if (resizeMode === "percent") {
      const ratio = Math.max(1, Math.min(400, resizeValue)) / 100
      return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
    }
    return { width, height }
  }

  async function processAll() {
    if (!sources.length || processing) return
    setProcessing(true)
    setError(null)
    clearResults()
    const finished: ProcessedImage[] = []

    try {
      for (const source of sources) {
        const bitmap = await createImageBitmap(source.file)
        const target = targetSize(bitmap.width, bitmap.height)
        const canvas = document.createElement("canvas")
        canvas.width = target.width
        canvas.height = target.height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Your browser could not start the image processor.")

        if (format === "image/jpeg") {
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, target.width, target.height)
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(bitmap, 0, 0, target.width, target.height)
        bitmap.close()

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error(`Could not export ${source.file.name}.`)), format, quality / 100)
        })
        finished.push({
          id: source.id,
          sourceName: source.file.name,
          url: URL.createObjectURL(blob),
          blob,
          width: target.width,
          height: target.height,
          bytesBefore: source.file.size,
          bytesAfter: blob.size,
        })
      }
      setResults(finished)
    } catch (cause) {
      finished.forEach(item => URL.revokeObjectURL(item.url))
      setError(cause instanceof Error ? cause.message : "Image processing failed.")
    } finally {
      setProcessing(false)
    }
  }

  function download(result: ProcessedImage) {
    const anchor = document.createElement("a")
    anchor.href = result.url
    anchor.download = `${safeBaseName(result.sourceName)}-vibecart.${extensionFor(format)}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  function downloadAll() {
    results.forEach((result, index) => window.setTimeout(() => download(result), index * 120))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
      <section className="space-y-5">
        <div
          onDragOver={event => event.preventDefault()}
          onDrop={onDrop}
          className="rounded-3xl border border-dashed border-neutral-700 bg-neutral-900/70 p-8 text-center transition hover:border-cyan-500/70"
        >
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileInput} />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300"><Upload size={27} /></div>
          <h2 className="mt-5 text-xl font-semibold">Drop images here</h2>
          <p className="mt-2 text-sm text-neutral-400">Batch up to 30 images. Nothing is uploaded to our servers.</p>
          <button onClick={() => inputRef.current?.click()} className="mt-5 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-cyan-300">Choose images</button>
        </div>

        {sources.length > 0 && (
          <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div><h2 className="font-semibold">Source files</h2><p className="text-sm text-neutral-500">{sources.length} image{sources.length === 1 ? "" : "s"} · {humanBytes(totalBefore)}</p></div>
              <button onClick={clearAll} className="flex items-center gap-2 text-sm text-neutral-400 hover:text-red-300"><Trash2 size={15} /> Clear</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {sources.map(source => (
                <div key={source.id} className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.previewUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{source.file.name}</p><p className="text-xs text-neutral-500">{source.width}×{source.height} · {humanBytes(source.file.size)}</p></div>
                  <button onClick={() => removeSource(source.id)} aria-label={`Remove ${source.file.name}`} className="text-neutral-600 hover:text-red-300"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-5">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-300"><ImageDown size={20} /></div><div><h2 className="font-semibold">Output settings</h2><p className="text-xs text-neutral-500">One set of settings for the whole batch</p></div></div>

          <div className="mt-6 space-y-5">
            <label className="block"><span className="mb-2 block text-sm font-medium">Resize</span><select value={resizeMode} onChange={event => setResizeMode(event.target.value as ResizeMode)} className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm"><option value="original">Keep original dimensions</option><option value="width">Set width, keep aspect ratio</option><option value="height">Set height, keep aspect ratio</option><option value="percent">Scale by percent</option></select></label>
            {resizeMode !== "original" && <label className="block"><span className="mb-2 block text-sm font-medium">{resizeMode === "percent" ? "Scale percent" : `${resizeMode[0].toUpperCase()}${resizeMode.slice(1)} in pixels`}</span><input type="number" min="1" max={resizeMode === "percent" ? 400 : 12000} value={resizeValue} onChange={event => setResizeValue(Number(event.target.value))} className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm" /></label>}
            <label className="block"><span className="mb-2 block text-sm font-medium">Convert to</span><select value={format} onChange={event => setFormat(event.target.value as OutputFormat)} className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm"><option value="image/webp">WebP — smallest modern format</option><option value="image/jpeg">JPG — universal compatibility</option><option value="image/png">PNG — lossless / transparency</option></select></label>
            {format !== "image/png" && <label className="block"><span className="mb-2 flex justify-between text-sm font-medium"><span>Quality</span><span className="text-neutral-400">{quality}%</span></span><input type="range" min="30" max="100" value={quality} onChange={event => setQuality(Number(event.target.value))} className="w-full accent-cyan-400" /></label>}
          </div>

          <button disabled={!sources.length || processing} onClick={processAll} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-neutral-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">{processing ? <><Loader2 className="animate-spin" size={18} /> Processing locally…</> : <><FileImage size={18} /> Process {sources.length || ""} image{sources.length === 1 ? "" : "s"}</>}</button>

          <div className="mt-5 flex gap-3 rounded-2xl border border-emerald-900/50 bg-emerald-950/30 p-4 text-sm text-emerald-200"><ShieldCheck className="mt-0.5 shrink-0" size={18} /><p><strong>Private by design.</strong> Source images stay on your device; browser Canvas does the resize, compression, and conversion work.</p></div>
        </div>

        {error && <div className="rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{error}</div>}

        {results.length > 0 && (
          <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Ready to download</h2><p className="text-sm text-neutral-500">{humanBytes(totalBefore)} → {humanBytes(totalAfter)} · {totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0}% size change</p></div><button onClick={downloadAll} className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20"><Download size={16} /> Download all</button></div>
            <div className="mt-4 space-y-3">{results.map(result => <div key={result.id} className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 text-cyan-300"><FileImage size={19} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{safeBaseName(result.sourceName)}-vibecart.{extensionFor(format)}</p><p className="text-xs text-neutral-500">{result.width}×{result.height} · {humanBytes(result.bytesAfter)}</p></div><button onClick={() => download(result)} className="rounded-lg p-2 text-cyan-300 hover:bg-cyan-500/10" aria-label={`Download ${result.sourceName}`}><Download size={18} /></button></div>)}</div>
          </div>
        )}
      </section>
    </div>
  )
}
