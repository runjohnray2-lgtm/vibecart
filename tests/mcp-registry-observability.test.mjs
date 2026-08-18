import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("registry publisher validates, verifies, and records publication", async () => {
  const workflow = await readFile(".github/workflows/publish-mcp-registry.yml", "utf8")
  assert.match(workflow, /issues: write/)
  assert.match(workflow, /mcp-publisher validate server\.json/)
  assert.match(workflow, /registry\.modelcontextprotocol\.io\/v0\.1\/servers/)
  assert.match(workflow, /Official Registry API verification/)
  assert.match(workflow, /gh issue comment \"\$STATUS_ISSUE\"/)
  assert.match(workflow, /STATUS_ISSUE: \"48\"/)
})
