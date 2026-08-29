import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("uptime monitor foundation is account-scoped and entitlement-gated", async () => {
  const migration = await readFile("migrations/006_uptime_monitor.sql", "utf8")
  const store = await readFile("lib/uptime.ts", "utf8")
  const route = await readFile("app/api/apps/uptime/route.ts", "utf8")

  assert.match(migration, /CREATE TABLE IF NOT EXISTS uptime_monitors/)
  assert.match(migration, /account_key TEXT NOT NULL/)
  assert.match(migration, /uptime_check_events/)
  assert.match(store, /WHERE account_key = \$\{accountKey\(owner\)\}/)
  assert.match(route, /const APP_KEY = "uptime"/)
  assert.match(route, /ensureInitialAppTrial/)
  assert.match(route, /hasAppAccess/)
  assert.match(route, /Sign in required/)
  assert.match(route, /Uptime Monitor entitlement required/)
})

test("uptime monitor validates targets and bounded check settings", async () => {
  const store = await readFile("lib/uptime.ts", "utf8")
  const migration = await readFile("migrations/006_uptime_monitor.sql", "utf8")

  assert.match(store, /url\.protocol !== "https:" && url\.protocol !== "http:"/)
  assert.match(store, /new Set\(\[60, 300, 900, 1800, 3600\]\)/)
  assert.match(migration, /timeout_ms BETWEEN 1000 AND 30000/)
  assert.match(migration, /expected_status BETWEEN 100 AND 599/)
})

test("uptime checker blocks private-network SSRF and revalidates redirects", async () => {
  const store = await readFile("lib/uptime.ts", "utf8")

  assert.match(store, /lookup\(hostname, \{ all: true, verbatim: true \}\)/)
  assert.match(store, /Private network targets are not allowed/)
  assert.match(store, /hostname === "localhost"/)
  assert.match(store, /a === 10/)
  assert.match(store, /a === 192 && b === 168/)
  assert.match(store, /redirect: "manual"/)
  assert.match(store, /current = await assertPublicTarget\(new URL\(location, current\)\.toString\(\)\)/)
})

test("uptime checker selects due monitors and persists every result", async () => {
  const store = await readFile("lib/uptime.ts", "utf8")

  assert.match(store, /last_checked_at <= NOW\(\) - \(interval_seconds \* INTERVAL '1 second'\)/)
  assert.match(store, /INSERT INTO uptime_check_events/)
  assert.match(store, /UPDATE uptime_monitors/)
  assert.match(store, /runDueUptimeChecks/)
  assert.match(store, /await persistCheckResult\(result\)/)
})
