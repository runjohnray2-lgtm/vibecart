import { NextRequest, NextResponse } from "next/server"
import { getShortLinkAnalytics, hasAppAccess } from "@/lib/app-library"

const APP_KEY = "links"

function accountKey(req: NextRequest): string | null {
  const value = req.headers.get("x-vibecart-account")?.trim()
  return value || null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const account = accountKey(req)
  if (!account) return NextResponse.json({ error: "Missing VibeCart account" }, { status: 401 })
  if (!(await hasAppAccess(account, APP_KEY))) {
    return NextResponse.json({ error: "Link Manager entitlement required" }, { status: 403 })
  }

  const { id } = await params
  const shortLinkId = Number(id)
  if (!Number.isSafeInteger(shortLinkId) || shortLinkId < 1) {
    return NextResponse.json({ error: "Short link not found" }, { status: 404 })
  }

  const analytics = await getShortLinkAnalytics(account, shortLinkId)
  if (!analytics) return NextResponse.json({ error: "Short link not found" }, { status: 404 })

  return NextResponse.json({ analytics })
}
