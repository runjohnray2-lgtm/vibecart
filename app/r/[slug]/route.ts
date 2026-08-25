import { NextRequest, NextResponse } from "next/server"
import { resolveShortLink } from "@/lib/app-library"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

    // Temporary redirect keeps the destination editable, which is the core
    // value of a managed short link. Analytics can be added without changing
    // the public URL contract.
    return NextResponse.redirect(new URL(link.destinationUrl), 307)
  } catch {
    return NextResponse.json({ error: "Invalid short link" }, { status: 404 })
  }
}
