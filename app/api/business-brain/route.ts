import { NextRequest, NextResponse } from "next/server"
import { getAuth } from "@/lib/auth/server"
import { startMyDay } from "@/lib/business-brain-day"
import { ensureWorkspace, getWorkspaceSnapshot, importCustomerCsv, saveBusinessMemory, saveBusinessRule } from "@/lib/business-brain"

async function account() {
  const { data } = await getAuth().getSession()
  return data?.user?.id ? String(data.user.id) : null
}

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin")
  if (!origin) return true
  try {
    return new URL(origin).host === req.nextUrl.host
  } catch {
    return false
  }
}

export async function GET() {
  const key = await account()
  if (!key) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  return NextResponse.json(await getWorkspaceSnapshot(key))
}

export async function POST(req: NextRequest) {
  const key = await account()
  if (!key) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })

  try {
    const body = await req.json()
    const action = String(body.action ?? "")
    if (action === "start-day") {
      // Signed-in, same-origin request; no external emails or orders are modified.
      const result = await startMyDay(key, String(body.businessName ?? "SeekPwr Co."))
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    }
    if (action === "ensure-workspace") {
      const workspace = await ensureWorkspace(key, String(body.businessName ?? "SeekPwr Co."))
      return NextResponse.json({ workspace }, { status: 201 })
    }
    if (action === "import-customers") {
      const result = await importCustomerCsv({
        accountKey: key,
        businessName: String(body.businessName ?? "SeekPwr Co."),
        sourceSystem: String(body.sourceSystem ?? "csv"),
        sourceName: String(body.sourceName ?? "customer-import.csv"),
        csvText: String(body.csvText ?? ""),
      })
      return NextResponse.json(result, { status: 201 })
    }
    if (action === "save-rule") {
      const result = await saveBusinessRule({ accountKey:key, businessName:String(body.businessName ?? "SeekPwr Co."), ruleText:String(body.ruleText ?? ""), source:"manual" })
      return NextResponse.json(result, { status:201 })
    }
    if (action === "save-memory") {
      const result = await saveBusinessMemory({ accountKey:key, businessName:String(body.businessName ?? "SeekPwr Co."), memoryType:String(body.memoryType ?? "fact"), content:String(body.content ?? ""), source:"manual" })
      return NextResponse.json(result, { status:201 })
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Business Brain request failed" },
      { status: 400 },
    )
  }
}
