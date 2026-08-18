import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("quickstart exposes canonical adoption paths", async () => {
  const start = await readFile("app/start/page.tsx", "utf8")
  const home = await readFile("app/page.tsx", "utf8")

  assert.match(start, /https:\/\/vibecart\.vercel\.app\/mcp/)
  assert.match(start, /io\.github\.runjohnray2-lgtm\/vibecart/)
  assert.match(start, /Claude Code/)
  assert.match(start, /VS Code/)
  assert.match(start, /OpenAI Responses API/)
  assert.match(start, /Start Cloud — \$29\/month/)
  assert.match(start, /Self-host Core/)
  assert.match(home, /href="\/start"/)
  assert.match(home, /Official MCP Registry \+ released UCP/)
})
