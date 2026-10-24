"use client"

import { useState } from "react"
import { evaluateCatalogReadiness, type ReadinessReport } from "@/lib/ai-readiness"

const LEVEL_LABEL: Record<ReadinessReport["level"], string> = {
  not_ready: "Not ready",
  needs_work: "Needs work",
  ready_for_agent_testing: "Ready for agent testing",
}

export function AiReadinessDashboard() {
  const [catalogText, setCatalogText] = useState("")
  const [currency, setCurrency] = useState("")
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(catalogText)
    } catch {
      setReport(null)
      setError("That is not valid JSON.")
      return
    }
    setReport(evaluateCatalogReadiness({ products: parsed, currencyCode: currency }))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">AI Readiness check</h1>
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Manual, offline diagnostic. It is not connected to your store, reads no live data, and cannot verify your endpoints.
        </p>
        <p className="text-sm text-gray-600">
          Paste your catalog JSON and enter its currency. It is checked in your browser and is not uploaded or stored.
        </p>
      </header>

      <div className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="readiness-currency">
          Catalog currency (ISO 4217, required)
        </label>
        <input
          id="readiness-currency"
          className="w-28 rounded border px-2 py-1"
          value={currency}
          placeholder="e.g. USD"
          onChange={event => setCurrency(event.target.value)}
        />
        <label className="block text-sm font-medium" htmlFor="readiness-catalog">
          Catalog JSON
        </label>
        <textarea
          id="readiness-catalog"
          className="h-56 w-full rounded border p-2 font-mono text-xs"
          value={catalogText}
          onChange={event => setCatalogText(event.target.value)}
          placeholder='{ "products": [ { "id": "sku-1", "name": "Example", "priceCents": 1999, "image": "https://example.com/a.jpg", "description": "..." } ] }'
        />
        <button type="button" className="rounded bg-black px-4 py-2 text-sm text-white" onClick={run}>
          Check catalog
        </button>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </div>

      {report ? (
        <section className="space-y-4" aria-live="polite">
          <h2 className="text-xl font-semibold">Result: {LEVEL_LABEL[report.level]}</h2>
          <p className="text-sm">
            {report.totals.exposable} of {report.totals.products} products have no blocking problems.{" "}
            {report.totals.withWarnings} have warnings.
          </p>
          <p className="text-sm">{report.currency.message}</p>
          <p className="text-sm">{report.freshness.message}</p>

          <div>
            <h3 className="font-medium">Endpoints</h3>
            <ul className="list-disc pl-5 text-sm">
              {report.endpoints.map(endpoint => (
                <li key={endpoint.kind}>{endpoint.message}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-medium">What blocks readiness</h3>
            {report.blockers.length === 0 ? (
              <p className="text-sm">No blockers found.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {report.blockers.map(item => (
                  <li key={item.code}>
                    {item.message} ({item.count}{item.examples.length ? "; e.g. " + item.examples.join(", ") : ""})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="font-medium">Warnings</h3>
            {report.warnings.length === 0 ? (
              <p className="text-sm">No warnings.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {report.warnings.map(item => (
                  <li key={item.code}>
                    {item.message} ({item.count})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-gray-600">{report.disclaimer}</p>
        </section>
      ) : null}
    </div>
  )
}
