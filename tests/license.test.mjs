import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("VibeCart ships a recognized MIT license", async () => {
  const license = await readFile("LICENSE", "utf8")
  const pkg = JSON.parse(await readFile("package.json", "utf8"))
  const readme = await readFile("README.md", "utf8")

  assert.match(license, /^MIT License/)
  assert.match(license, /VibeCart contributors/)
  assert.equal(pkg.license, "MIT")
  assert.match(readme, /\[MIT\]\(LICENSE\)/)
  assert.doesNotMatch(readme, /MIT-style/)
})
