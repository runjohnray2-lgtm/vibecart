import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("public discovery metadata describes the supported commerce capabilities", async () => {
  const metadata = JSON.parse(await readFile("public/.well-known/vibecart.json", "utf8"))
  assert.equal(metadata.name, "VibeCart")
  assert.deepEqual(metadata.capabilities, [
    "list_products",
    "get_product",
    "get_integration_instructions",
    "create_checkout",
    "durable_multi_item_cart",
    "trusted_server_side_repricing",
    "released_ucp_catalog_and_cart",
    "grounded_ai_salesperson",
  ])
  assert.equal(metadata.payments.platform_fee, false)
  assert.equal(metadata.payments.merchant_of_record, false)
})

test("plugin package contains no fabricated OpenAI identifier", async () => {
  const manifest = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"))
  assert.equal(manifest.name, "vibecart")
  assert.equal(manifest.mcpServers.vibecart.url, "https://vibecart.vercel.app/mcp")
  assert.equal("appId" in manifest, false)
  assert.equal("pluginId" in manifest, false)
})
