import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { drainCloudOutbox } from "@/lib/cloud-outbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  if (process.env.VIBECART_CLOUD_OUTBOX_CRON_ENABLED?.trim().toLowerCase() !== "true") {
    return NextResponse.json({ success: true, skipped: true }, { headers: { "cache-control": "no-store" } })
  }

  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    console.error("[vibecart outbox] CRON_SECRET is missing while Cloud outbox cron is enabled")
    return NextResponse.json({ success: false, error: "Cloud outbox retry is not configured." }, { status: 503 })
  }

  const authorization = req.headers.get("authorization")?.trim() ?? ""
  const expected = `Bearer ${secret}`
  if (!secureEqual(authorization, expected)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const result = await drainCloudOutbox(20)
    return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    console.error(
      "[vibecart outbox] Retry drain failed",
      error instanceof Error ? error.message : "unknown"
    )
    return NextResponse.json({ success: false, error: "Cloud outbox retry failed." }, { status: 503 })
  }
}
