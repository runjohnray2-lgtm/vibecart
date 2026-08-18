import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("merchant catalog docs define a no-redeploy trusted JSON contract", async () => {
  const docs = await readFile("docs/merchant-catalog.md", "utf8")
  assert.match(docs, /VIBECART_CATALOG_URL/)
  assert.match(docs, /VIBECART_CATALOG_BEARER_TOKEN/)
  assert.match(docs, /priceCents/)
  assert.match(docs, /cached for 30 seconds/)
  assert.match(docs, /does not fall back to the fictional demo catalog/)
  assert.match(docs, /without editing VibeCart source or redeploying/)
})
