import { NextRequest, NextResponse } from "next/server"
import { recordShortLinkEvent, resolveShortLink } from "@/lib/app-library"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function deviceType(userAgent: string | null): string | null {
  if (!userAgent) return null
  if (/bot|crawler|spider|slurp|preview/i.test(userAgent)) return "bot"
  if (/ipad|tablet/i.test(userAgent)) return "tablet"
  if (/mobile|iphone|android/i.test(userAgent)) return "mobile"
  return "desktop"
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    const link = await resolveShortLink(slug)

    if (!link) {
      return NextResponse.json({ error: "Short link not found" }, { status: 404 })
    }

    const userAgent = request.headers.get("user-agent")
    await recordShortLinkEvent({
      shortLinkId: link.id,
      referrer: request.headers.get("referer"),
      userAgent,
      countryCode: request.headers.get("x-vercel-ip-country"),
      deviceType: deviceType(userAgent),
    }).catch(() => undefined)

    return NextResponse.redirect(new URL(link.destinationUrl), 307)
  } catch {
    return NextResponse.json({ error: "Invalid short link" }, { status: 404 })
  }
}
