import { randomBytes } from "node:crypto"

// This script intentionally exercises the deployed production app, not a preview.
const baseUrl = process.env.VIBECART_SMOKE_BASE_URL || "https://vibecart.vercel.app"
const origin = new URL(baseUrl).origin
const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`
const email = `appfactory-smoke-${stamp}@example.com`
const password = `VibeCart-${randomBytes(18).toString("base64url")}!9`
const slug = `smoke-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`

const cookieJar = new Map()

function absorbCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean)

  for (const value of values) {
    const first = value.split(";", 1)[0]
    const index = first.indexOf("=")
    if (index <= 0) continue
    cookieJar.set(first.slice(0, index), first.slice(index + 1))
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ")
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (cookieJar.size) headers.set("cookie", cookieHeader())
  if (options.method && options.method !== "GET" && options.method !== "HEAD") {
    headers.set("origin", origin)
    headers.set("referer", `${origin}/`)
  }
  const response = await fetch(new URL(path, baseUrl), { ...options, headers })
  absorbCookies(response)
  return response
}

async function expectJson(response, label) {
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, 800)}`)
  return data
}

console.log(`Smoke testing ${baseUrl}`)

const signupResponse = await request("/api/auth/sign-up/email", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, name: "App Factory Production Smoke" }),
  redirect: "manual",
})
await expectJson(signupResponse, "account creation")

const sessionResponse = await request("/api/auth/get-session", { redirect: "manual" })
const session = await expectJson(sessionResponse, "session lookup")
if (!session?.user?.id || session.user.email !== email) {
  throw new Error(`signup did not establish the expected authenticated session: ${JSON.stringify(session).slice(0, 800)}`)
}
console.log("✓ account created and authenticated session established")

const createResponse = await request("/api/apps/links", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "Production smoke test",
    slug,
    destinationUrl: `${baseUrl}/apps?smoke=1`,
    utmSource: "vibecart",
    utmMedium: "qa",
    utmCampaign: "first-app-launch",
    utmContent: "production-smoke",
  }),
  redirect: "manual",
})
const created = await expectJson(createResponse, "tracked-link creation")
if (created?.link?.slug !== slug) throw new Error("created link did not match requested slug")
console.log("✓ first-use entitlement granted and tracked link created")

const appPage = await request("/apps/links", { redirect: "manual" })
if (appPage.status !== 200) throw new Error(`authenticated app page returned ${appPage.status}`)
const appHtml = await appPage.text()
if (!appHtml.includes("Link + QR + UTM Manager")) throw new Error("authenticated app page did not render Link Manager shell")
console.log("✓ authenticated Link Manager page renders")

const redirectResponse = await fetch(`${baseUrl}/r/${slug}`, { redirect: "manual" })
if (redirectResponse.status !== 307) throw new Error(`short link returned ${redirectResponse.status}, expected 307`)
const location = redirectResponse.headers.get("location")
if (!location) throw new Error("short link did not return a Location header")
const destination = new URL(location)
const expected = {
  smoke: "1",
  utm_source: "vibecart",
  utm_medium: "qa",
  utm_campaign: "first-app-launch",
  utm_content: "production-smoke",
}
for (const [key, value] of Object.entries(expected)) {
  if (destination.searchParams.get(key) !== value) {
    throw new Error(`redirect lost ${key}; got ${destination.toString()}`)
  }
}
console.log(`✓ short redirect preserved destination query and merged UTM tags: ${destination}`)

const listResponse = await request("/api/apps/links", { cache: "no-store", redirect: "manual" })
const listed = await expectJson(listResponse, "analytics lookup")
const link = listed.links?.find(item => item.slug === slug)
if (!link) throw new Error("created link missing from authenticated link list")
if (Number(link.clickCount) < 1 || !link.lastClickedAt) {
  throw new Error(`click analytics did not update: ${JSON.stringify(link)}`)
}
console.log(`✓ click analytics updated (${link.clickCount} click; last ${link.lastClickedAt})`)

console.log(JSON.stringify({
  ok: true,
  accountCreated: true,
  authenticated: true,
  appPageRendered: true,
  linkCreated: true,
  redirectVerified: true,
  utmVerified: true,
  analyticsVerified: true,
  slug,
}, null, 2))
