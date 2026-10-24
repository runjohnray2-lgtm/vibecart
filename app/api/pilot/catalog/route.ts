import { NextResponse } from "next/server"
import { parseCatalogDocument } from "@/lib/catalog-source"
import { configuredMerchantId, merchantRequestAuthorized } from "@/lib/merchant-auth"
import { previewSafetyFailure } from "@/lib/preview-safety"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_SNAPSHOT_BYTES = 48 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" }

// Controlled private snapshot, not Shopify sync. Never publish the source export.
export async function GET(req: Request) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VIBECART_PILOT_CATALOG_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers })
  }
  if (previewSafetyFailure()) return NextResponse.json({ error: "Staging safety is unverified" }, { status: 503, headers })
  try {
    if (!merchantRequestAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers })
    const raw = process.env.VIBECART_PILOT_CATALOG_JSON ?? ""
    if (!raw || Buffer.byteLength(raw, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("Invalid snapshot size")
    const snapshot = JSON.parse(raw)
    if (snapshot.merchantId !== configuredMerchantId()) throw new Error("Snapshot merchant mismatch")
    const capturedAt = typeof snapshot.capturedAt === "string" ? Date.parse(snapshot.capturedAt) : NaN
    const age = Date.now() - capturedAt
    if (!Number.isFinite(age) || age < -30_000 || age > MAX_AGE_MS) throw new Error("Snapshot freshness unverified")
    if (!Array.isArray(snapshot.products) || snapshot.products.length < 1 || snapshot.products.length > 20) throw new Error("Invalid subset")
    const products = parseCatalogDocument(snapshot)
    return NextResponse.json({ products }, { headers })
  } catch {
    return NextResponse.json({ error: "Pilot catalog needs a fresh, valid merchant snapshot" }, { status: 503, headers })
  }
}
