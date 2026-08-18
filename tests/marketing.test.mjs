import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const cloudUrl = "https://vibecart-cloud-uupzkh.v2.appdeploy.ai/"

test("homepage sells the shipped agent-commerce platform rather than the old checkout prototype", async () => {
  const source = await readFile("app/page.tsx", "utf8")
  assert.match(source, /Commerce infrastructure for AI-built apps and the agents that use them/)
  assert.match(source, /Durable multi-item cart/)
  assert.match(source, /Official MCP Registry \+ released UCP/)
  assert.match(source, /trusted multi-item checkout/i)
  assert.doesNotMatch(source, /Deliberately not a commerce platform/)
  assert.doesNotMatch(source, /no shared multi-item cart/i)
})

test("homepage links recurring revenue CTA directly to the live Cloud workspace", async () => {
  const source = await readFile("app/page.tsx", "utf8")
  assert.ok(source.includes(cloudUrl))
  assert.match(source, /Start VibeCart Cloud — \$29\/month/)
  assert.match(source, /\$29<span/)
  assert.match(source, /Open Cloud workspace/)
})

test("Cloud sales page separates recurring Cloud from custom done-for-you setup", async () => {
  const source = await readFile("app/cloud/page.tsx", "utf8")
  assert.ok(source.includes(cloudUrl))
  assert.match(source, /\$29<span/)
  assert.match(source, /verified active subscription unlocks\s*live commerce ingestion/i)
  assert.match(source, /Request Done-for-you Setup/)
  assert.match(source, /Custom quote/)
  assert.match(source, /managedSetupUrl/)
  assert.match(source, /Open Cloud workspace/)
})

test("revenue pages preserve merchant-owned Stripe economics and honest product limits", async () => {
  const [home, cloud] = await Promise.all([
    readFile("app/page.tsx", "utf8"),
    readFile("app/cloud/page.tsx", "utf8"),
  ])
  assert.match(home, /VibeCart takes no percentage of merchant sales/)
  assert.match(cloud, /VibeCart takes no percentage of merchant sales/)
  assert.match(home, /inventory, tax, shipping-rate, returns, or fulfillment systems/)
})
