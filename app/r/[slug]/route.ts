import { NextRequest, NextResponse } from "next/server"
import { recordShortLinkEvent, resolveShortLink } from "@/lib/app-library"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function classifyDevice(userAgent: string | null): string | null {
  if (!userAgent) return null
  const ua = userAgent.toLowerCase()
  if (/bot|crawler|spider|slurp|bingpreview/.test(ua)) return "bot"
  if (/ipad|tablet/.test(ua)) return "tablet"
  if (/mobile|android|iphone|ipod/.test(ua)) return "mobile"
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
    void recordShortLinkEvent({
      shortLinkId: link.id,
      referrer: request.headers.get("referer"),
      userAgent,
      countryCode: request.headers.get("x-vercel-ip-country"),
      deviceType: classifyDevice(userAgent),
    }).catch(() => {
      // Analytics must never break a valid redirect.
    })

    return NextResponse.redirect(new URL(link.destinationUrl), 307)
  } catch {
    return NextResponse.json({ error: "Invalid short link" }, { status: 404 })
  }
}
