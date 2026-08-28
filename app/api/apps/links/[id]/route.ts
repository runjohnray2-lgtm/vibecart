import { NextRequest, NextResponse } from "next/server"
import { hasAppAccess, updateShortLink } from "@/lib/app-library"
import { withUtmParameters } from "@/lib/utm"

const APP_KEY = "links"

function accountKey(req: NextRequest): string | null {
  const value = req.headers.get("x-vibecart-account")?.trim()
  return value || null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const account = accountKey(req)
  if (!account) return NextResponse.json({ error: "Missing VibeCart account" }, { status: 401 })
  if (!(await hasAppAccess(account, APP_KEY))) {
    return NextResponse.json({ error: "Link Manager entitlement required" }, { status: 403 })
  }

  try {
    const { id } = await params
    const shortLinkId = Number(id)
    const body = await req.json()

    const hasDestination = body.destinationUrl !== undefined
    const destinationUrl = hasDestination
      ? withUtmParameters(String(body.destinationUrl ?? ""), {
          source: body.utmSource == null ? undefined : String(body.utmSource),
          medium: body.utmMedium == null ? undefined : String(body.utmMedium),
          campaign: body.utmCampaign == null ? undefined : String(body.utmCampaign),
          term: body.utmTerm == null ? undefined : String(body.utmTerm),
          content: body.utmContent == null ? undefined : String(body.utmContent),
        })
      : undefined

    const link = await updateShortLink({
      accountKey: account,
      id: shortLinkId,
      destinationUrl,
      title: body.title === undefined ? undefined : body.title == null ? null : String(body.title),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive),
    })

    if (!link) return NextResponse.json({ error: "Short link not found" }, { status: 404 })
    return NextResponse.json({ link })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update short link"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
