import { NextResponse } from "next/server"
import manifest from "@/integrations/mcp-clients.json"

export const dynamic = "force-static"

export async function GET() {
  return NextResponse.json(manifest, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  })
}
