import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("agent discovery files expose canonical machine endpoints", async () => {
  const agents = await readFile("public/agents.md", "utf8")
  assert.match(agents, /\/llms\.txt/)
  assert.match(agents, /\/mcp/)
  assert.match(agents, /\.well-known\/ucp/)
  assert.match(agents, /\/ucp\/mcp/)
  assert.match(agents, /Do not claim/)
})

test("robots points crawlers at the canonical sitemap", async () => {
  const robots = await readFile("app/robots.ts", "utf8")
  assert.match(robots, /sitemap\.xml/)
  assert.match(robots, /vibecart\.vercel\.app/)
})

test("structured metadata stays truthful to shipped capabilities", async () => {
  const layout = await readFile("app/layout.tsx", "utf8")
  assert.match(layout, /SoftwareApplication/)
  assert.match(layout, /Stripe Checkout/)
  assert.match(layout, /MCP/)
  assert.match(layout, /UCP catalog discovery/)
  assert.doesNotMatch(layout, /inventory management/i)
  assert.doesNotMatch(layout, /merchant of record/i)
})
