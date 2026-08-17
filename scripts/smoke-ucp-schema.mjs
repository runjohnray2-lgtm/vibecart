import { mkdir, writeFile } from "node:fs/promises"

const baseUrl = process.env.VIBECART_SMOKE_BASE_URL ?? "http://127.0.0.1:3000"
const outputDir = process.env.VIBECART_UCP_PAYLOAD_DIR ?? "/tmp/vibecart-ucp-payloads"
const platformProfile = "https://raw.githubusercontent.com/runjohnray2-lgtm/vibecart/main/tests/fixtures/ucp/platform-profile.json"

await mkdir(outputDir, { recursive: true })

async function save(name, value) {
  await writeFile(`${outputDir}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

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

const discoveryResponse = await fetch(`${baseUrl}/.well-known/ucp`)
if (!discoveryResponse.ok) throw new Error(`UCP discovery returned HTTP ${discoveryResponse.status}`)
await save("discovery", await discoveryResponse.json())

await save("search", await callTool("search_catalog", {
  query: "LED",
  pagination: { limit: 10 },
}))

await save("lookup", await callTool("lookup_catalog", {
  ids: ["led-plate-frame", "sticker-pack-nw"],
}))

await save("get-product", await callTool("get_product", {
  id: "led-plate-frame",
}))

console.log(`Captured live UCP discovery and catalog payloads in ${outputDir}`)
