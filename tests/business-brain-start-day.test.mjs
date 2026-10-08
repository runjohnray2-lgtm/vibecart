import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const read = path => readFileSync(resolve(root, path), "utf8")

test("Start My Day is behind existing authentication and same-origin checks", () => {
  const route = read("app/api/business-brain/route.ts")
  assert.match(route, /if \(!key\) return NextResponse\.json\(\{ error: "Sign in required"/)
  assert.match(route, /if \(!sameOrigin\(req\)\)/)
  assert.match(route, /action === "start-day"/)
  assert.match(route, /startMyDay\(key,/)
})

test("day data is strictly scoped to the signed-in business", () => {
  const code = read("lib/business-brain-day.ts")
  assert.match(code, /WHERE account_key=\$1 AND name=\$2/)
  for (const table of ["business_customers", "business_rules", "business_memories", "source_imports", "business_action_log"]) {
    assert.match(code, new RegExp(table + "[^\\n]*WHERE business_id=\\$1::uuid"))
  }
  assert.match(code, /INSERT INTO business_action_log/)
  assert.match(code, /liveEmailChecked: false/)
  assert.match(code, /liveOrdersChecked: false/)
})

test("dashboard never disguises missing Gmail or order integrations as checked", () => {
  const day = read("lib/business-brain-day.ts")
  const panel = read("components/start-my-day.tsx")
  assert.match(day, /NOT_CONNECTED/)
  assert.match(day, /Live email threads are not connected/)
  assert.match(panel, /Live Gmail and orders have NOT been checked/)
  assert.match(panel, /action:"start-day"/)
  assert.match(panel, /action:"save-memory"/)
})
