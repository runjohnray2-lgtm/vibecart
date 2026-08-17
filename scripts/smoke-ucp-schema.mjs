import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  GetProductResponseSchema,
  LookupResponseSchema,
  SearchResponseSchema,
} = require("@ucp-js/sdk")

const baseUrl = process.env.VIBECART_SMOKE_BASE_URL ?? "http://127.0.0.1:3000"
const platformProfile = "https://raw.githubusercontent.com/runjohnray2-lgtm/vibecart/main/tests/fixtures/ucp/platform-profile.json"

async function callTool(name, catalog) {
  const response = await fetch(`${baseUrl}/ucp/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${name}-schema-smoke`,
      method: "tools/call",
      params: {
        name,
        arguments: {
          meta: { "ucp-agent": { profile: platformProfile } },
          catalog,
        },
      },
    }),
  })

  const body = await response.json()
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}: ${JSON.stringify(body)}`)
  if (body.error) throw new Error(`${name} returned JSON-RPC error: ${JSON.stringify(body.error)}`)
  if (!body.result?.structuredContent) throw new Error(`${name} did not return structuredContent`)
  return body.result.structuredContent
}

function validate(label, schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`${label} failed official UCP schema validation: ${result.error.message}`)
  }
}

const search = await callTool("search_catalog", {
  query: "LED",
  pagination: { limit: 10 },
})
validate("search_catalog", SearchResponseSchema, search)

const lookup = await callTool("lookup_catalog", {
  ids: ["led-plate-frame", "sticker-pack-nw"],
})
validate("lookup_catalog", LookupResponseSchema, lookup)

const product = await callTool("get_product", {
  id: "led-plate-frame",
})
validate("get_product", GetProductResponseSchema, product)

console.log("UCP catalog responses validate against @ucp-js/sdk 0.4.4 (UCP 2026-04-08)")
