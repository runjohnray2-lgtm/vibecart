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
