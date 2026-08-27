import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("short-link redirects record privacy-minimized analytics without blocking redirects", async () => {
  const store = await readFile("lib/app-library.ts", "utf8")
  const route = await readFile("app/r/[slug]/route.ts", "utf8")

  assert.match(store, /INSERT INTO short_link_events/)
  assert.match(store, /country_code, device_type/)
  assert.match(route, /recordShortLinkEvent/)
  assert.match(route, /\.catch\(\(\) =>/)
  assert.match(route, /x-vercel-ip-country/)
  assert.match(route, /referer/)
  assert.match(route, /user-agent/)
  assert.doesNotMatch(route, /x-forwarded-for|x-real-ip/i)
  assert.doesNotMatch(store, /ip_address|raw_ip/i)
})

test("link analytics are entitlement-gated and scoped to the requesting account", async () => {
  const store = await readFile("lib/app-library.ts", "utf8")
  const route = await readFile("app/api/apps/links/[id]/analytics/route.ts", "utf8")

  assert.match(store, /WHERE id = \$\{shortLinkId\} AND account_key = \$\{account\}/)
  assert.match(store, /COUNT\(\*\)::int AS total_clicks/)
  assert.match(store, /GROUP BY country_code/)
  assert.match(store, /GROUP BY device_type/)
  assert.match(route, /hasAppAccess\(account, APP_KEY\)/)
  assert.match(route, /getShortLinkAnalytics\(account, shortLinkId\)/)
  assert.match(route, /status: 403/)
  assert.match(route, /status: 404/)
})

test("link creation supports standard UTM parameters through the shared URL builder", async () => {
  const utm = await readFile("lib/utm.ts", "utf8")
  const route = await readFile("app/api/apps/links/route.ts", "utf8")

  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    assert.match(utm, new RegExp(key))
  }
  assert.match(utm, /url\.searchParams\.set/)
  assert.match(route, /withUtmParameters/)
  assert.match(route, /utmSource/)
  assert.match(route, /utmMedium/)
  assert.match(route, /utmCampaign/)
  assert.match(route, /utmTerm/)
  assert.match(route, /utmContent/)
})
