import { NextRequest, NextResponse } from "next/server"
import { createShortLink, hasAppAccess, listShortLinks } from "@/lib/app-library"
import { withUtmParameters } from "@/lib/utm"

const APP_KEY = "links"

function accountKey(req: NextRequest): string | null {
  const value = req.headers.get("x-vibecart-account")?.trim()
  return value || null
}

export async function GET(req: NextRequest) {
  const account = accountKey(req)
  if (!account) return NextResponse.json({ error: "Missing VibeCart account" }, { status: 401 })
  if (!(await hasAppAccess(account, APP_KEY))) {
    return NextResponse.json({ error: "Link Manager entitlement required" }, { status: 403 })
  }
  const links = await listShortLinks(account)
  return NextResponse.json({ links })
}

export async function POST(req: NextRequest) {
  const account = accountKey(req)
  if (!account) return NextResponse.json({ error: "Missing VibeCart account" }, { status: 401 })
  if (!(await hasAppAccess(account, APP_KEY))) {
    return NextResponse.json({ error: "Link Manager entitlement required" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const destinationUrl = withUtmParameters(String(body.destinationUrl ?? ""), {
      source: body.utmSource == null ? undefined : String(body.utmSource),
      medium: body.utmMedium == null ? undefined : String(body.utmMedium),
      campaign: body.utmCampaign == null ? undefined : String(body.utmCampaign),
      term: body.utmTerm == null ? undefined : String(body.utmTerm),
      content: body.utmContent == null ? undefined : String(body.utmContent),
    })
    const link = await createShortLink({
      accountKey: account,
      slug: String(body.slug ?? ""),
      destinationUrl,
      title: body.title == null ? undefined : String(body.title),
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create short link"
    const duplicate = /unique|duplicate/i.test(message)
    return NextResponse.json({ error: duplicate ? "That short-link slug is already in use" : message }, { status: duplicate ? 409 : 400 })
  }
}
