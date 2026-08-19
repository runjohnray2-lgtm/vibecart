import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const paths = ["README.md", "public/agents.md", "public/llms.txt"]

test("public docs describe the live durable cart and UCP cart surface", async () => {
  for (const path of paths) {
    const source = await readFile(path, "utf8")
    assert.doesNotMatch(source, /NOT a full shopping cart/i, `${path} contains obsolete not-a-cart language`)
    assert.doesNotMatch(source, /no shared multi-item cart/i, `${path} contains obsolete no-cart language`)
    assert.doesNotMatch(source, /durable cart implementation exists but is not yet/i, `${path} says the live cart is not production`)
  }

  const readme = await readFile("README.md", "utf8")
  assert.match(readme, /Neon-backed cart is live in production/i)
  assert.match(readme, /create_cart/)
  assert.match(readme, /get_cart/)
  assert.match(readme, /update_cart/)
  assert.match(readme, /cancel_cart/)

  const agents = await readFile("public/agents.md", "utf8")
  assert.match(agents, /Production currently advertises catalog \+ cart/i)

  const llms = await readFile("public/llms.txt", "utf8")
  assert.match(llms, /durable multi-item cart/i)
  assert.match(llms, /items\[\]/)
})

test("merchant-facing docs no longer require editing TypeScript for a real catalog", async () => {
  for (const path of paths) {
    const source = await readFile(path, "utf8")
    assert.match(source, /VIBECART_CATALOG_URL/, `${path} must document the external merchant catalog`)
    assert.match(source, /fail(?:s)? closed/i, `${path} must document remote catalog fail-closed behavior`)
  }

  const readme = await readFile("README.md", "utf8")
  assert.match(readme, /Normal SKU and price changes therefore do not require editing VibeCart TypeScript/i)
  assert.match(readme, /VIBECART_CATALOG_BEARER_TOKEN/)

  const agents = await readFile("public/agents.md", "utf8")
  assert.match(agents, /fictional demo\/reference data/i)

  const llms = await readFile("public/llms.txt", "utf8")
  assert.match(llms, /fictional reference\/demo data/i)
})
