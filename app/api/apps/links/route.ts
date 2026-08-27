import { NextRequest, NextResponse } from "next/server"
import { getAuth } from "@/lib/auth/server"
import { createShortLink, ensureInitialAppTrial, hasAppAccess, listShortLinks } from "@/lib/app-library"

const APP_KEY = "links"

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
    return NextResponse.json({ error: "Link Manager entitlement required" }, { status: 403 })
  }
  const links = await listShortLinks(account)
  return NextResponse.json({ links })
}

export async function POST(req: NextRequest) {
  const account = await authenticatedAccount()
  if (!account) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  if (!(await ensureAccess(account))) {
    return NextResponse.json({ error: "Link Manager entitlement required" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const link = await createShortLink({
      accountKey: account,
      slug: String(body.slug ?? ""),
      destinationUrl: String(body.destinationUrl ?? ""),
      title: body.title == null ? undefined : String(body.title),
      utmSource: body.utmSource == null ? undefined : String(body.utmSource),
      utmMedium: body.utmMedium == null ? undefined : String(body.utmMedium),
      utmCampaign: body.utmCampaign == null ? undefined : String(body.utmCampaign),
      utmTerm: body.utmTerm == null ? undefined : String(body.utmTerm),
      utmContent: body.utmContent == null ? undefined : String(body.utmContent),
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create short link"
    const duplicate = /unique|duplicate/i.test(message)
    return NextResponse.json({ error: duplicate ? "That short-link slug is already in use" : message }, { status: duplicate ? 409 : 400 })
  }
}
