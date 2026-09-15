import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const library = fs.readFileSync("app/apps/page.tsx", "utf8")
const button = fs.readFileSync("components/app-factory-subscribe-button.tsx", "utf8")

test("App Factory library exposes the all-app subscription entry point", () => {
  assert.match(library, /AppFactorySubscribeButton/)
  assert.match(library, /All-app subscription/)
  assert.match(library, /Unlock the App Factory with one subscription/)
})

test("subscription CTA starts authenticated checkout and handles sign-in", () => {
  assert.match(button, /fetch\("\/api\/apps\/subscribe", \{ method: "POST" \}\)/)
  assert.match(button, /res\.status === 401/)
  assert.match(button, /\/auth\/sign-in\?next=\/apps/)
  assert.match(button, /window\.location\.href = body\.url/)
})
