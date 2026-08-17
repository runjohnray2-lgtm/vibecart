import { NextResponse } from "next/server"

export const runtime = "nodejs"

const UCP_VERSION = "2026-04-08"

export async function GET(req: Request) {
  const origin = new URL(req.url).origin

  return NextResponse.json(
    {
      ucp: {
        version: UCP_VERSION,
        services: {
          "dev.ucp.shopping": {
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
            mcp: {
              endpoint: `${origin}/ucp/mcp`,
              schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/mcp.openrpc.json`,
            },
          },
        },
        capabilities: [
          {
            name: "dev.ucp.shopping.catalog.search",
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/search`,
            schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`,
          },
          {
            name: "dev.ucp.shopping.catalog.lookup",
            version: UCP_VERSION,
            spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/lookup`,
            schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_lookup.json`,
          },
        ],
      },
    },
    {
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    }
  )
}
