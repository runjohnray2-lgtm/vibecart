import { NextResponse } from "next/server"
import { ucpOrderRuntimeConfigured } from "@/lib/ucp-order-service"

export const runtime = "nodejs"

const UCP_VERSION = "2026-04-08"
const ORDER_CAPABILITY = "dev.ucp.shopping.order"

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const orderEnabled = ucpOrderRuntimeConfigured()

  return NextResponse.json(
    {
      ucp: {
        version: UCP_VERSION,
        services: {
          "dev.ucp.shopping": [
            {
              version: UCP_VERSION,
              spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
              transport: "mcp",
              endpoint: `${origin}/ucp/mcp`,
              schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/mcp.openrpc.json`,
            },
          ],
        },
        capabilities: {
          "dev.ucp.shopping.catalog.search": [
            {
              version: UCP_VERSION,
              spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/search`,
              schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`,
            },
          ],
          "dev.ucp.shopping.catalog.lookup": [
            {
              version: UCP_VERSION,
              spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/lookup`,
              schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_lookup.json`,
            },
          ],
          ...(orderEnabled ? {
            [ORDER_CAPABILITY]: [
              {
                version: UCP_VERSION,
                spec: `https://ucp.dev/${UCP_VERSION}/specification/order`,
                schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/order.json`,
              },
            ],
          } : {}),
        },
        payment_handlers: {},
      },
    },
    {
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    }
  )
}
