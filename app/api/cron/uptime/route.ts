import { NextRequest, NextResponse } from "next/server"
import { runDueUptimeChecks } from "@/lib/uptime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 25)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 25
  const results = await runDueUptimeChecks(limit)

  return NextResponse.json({
    checked: results.length,
    up: results.filter(result => result.ok).length,
    down: results.filter(result => !result.ok).length,
    results,
  })
}
