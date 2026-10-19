import { NextRequest, NextResponse } from "next/server"
import { getAuth } from "@/lib/auth/server"
import { ensureInitialAppTrial, hasAppAccess } from "@/lib/app-library"
import { createUptimeMonitor, listUptimeMonitors } from "@/lib/uptime"

const APP_KEY = "uptime"

async function authenticatedAccount(): Promise<string | null> {
  const { data } = await getAuth().getSession()
  return data?.user?.id ? String(data.user.id) : null
}

async function ensureAccess(account: string): Promise<boolean> {
  await ensureInitialAppTrial(account, APP_KEY)
  return hasAppAccess(account, APP_KEY)
}

export async function GET() {
  const account = await authenticatedAccount()
  if (!account) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  if (!(await ensureAccess(account))) {
    return NextResponse.json({ error: "Uptime Monitor entitlement required" }, { status: 403 })
  }

  const monitors = await listUptimeMonitors(account)
  return NextResponse.json({ monitors })
}

export async function POST(req: NextRequest) {
  const account = await authenticatedAccount()
  if (!account) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  if (!(await ensureAccess(account))) {
    return NextResponse.json({ error: "Uptime Monitor entitlement required" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const monitor = await createUptimeMonitor({
      accountKey: account,
      name: String(body.name ?? ""),
      url: String(body.url ?? ""),
      method: body.method == null ? undefined : String(body.method),
      expectedStatus: body.expectedStatus == null ? undefined : Number(body.expectedStatus),
      intervalSeconds: body.intervalSeconds == null ? undefined : Number(body.intervalSeconds),
      timeoutMs: body.timeoutMs == null ? undefined : Number(body.timeoutMs),
    })
    return NextResponse.json({ monitor }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create monitor"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
