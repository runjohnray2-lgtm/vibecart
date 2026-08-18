import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("MCP Registry metadata stays publishable", async () => {
  const server = JSON.parse(await readFile("server.json", "utf8"))
  assert.equal(server.name, "io.github.runjohnray2-lgtm/vibecart")
  assert.ok(typeof server.description === "string" && server.description.length > 0)
  assert.ok(server.description.length <= 100, `Registry description is ${server.description.length} characters; maximum is 100`)
  assert.equal(server.remotes?.[0]?.type, "streamable-http")
  assert.equal(server.remotes?.[0]?.url, "https://vibecart.vercel.app/mcp")
})
