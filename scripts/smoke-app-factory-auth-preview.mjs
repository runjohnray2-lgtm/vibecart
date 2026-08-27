import { randomBytes } from "node:crypto"

// Exercises the deployed preview through the same VibeCart auth endpoint used by the browser form.
const baseUrl = process.env.VIBECART_SMOKE_BASE_URL
if (!baseUrl) throw new Error("VIBECART_SMOKE_BASE_URL is required")
const origin = new URL(baseUrl).origin
const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`
const email = `appfactory-preview-${stamp}@example.com`
const password = `VibeCart-${randomBytes(18).toString("base64url")}!9`
const slug = `preview-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`
const cookies = new Map()

function absorb(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean)
  for (const value of values) {
    const pair = value.split(";", 1)[0]
    const i = pair.indexOf("=")
    if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1))
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "))
  if (options.method && options.method !== "GET" && options.method !== "HEAD") {
    headers.set("origin", origin)
    headers.set("referer", `${origin}/`)
  }
  const response = await fetch(new URL(path, baseUrl), { ...options, headers, redirect: options.redirect || "manual" })
  absorb(response)
  return response
}

async function json(response, label) {
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, 1000)}`)
  return body
}

console.log(`Testing App Factory auth hotfix at ${baseUrl}`)
const signup = await request("/api/apps/auth", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "sign-up", email, password, name: "App Factory Preview Smoke" }),
})
await json(signup, "server-side signup")
console.log("✓ server-side signup accepted")

const session = await json(await request("/api/auth/get-session"), "session lookup")
if (!session?.user?.id || session.user.email !== email) throw new Error(`no authenticated session after signup: ${JSON.stringify(session)}`)
console.log("✓ signup established browser session")

const created = await json(await request("/api/apps/links", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "Auth hotfix preview smoke",
    slug,
    destinationUrl: `${baseUrl}/apps?smoke=1`,
    utmSource: "vibecart",
    utmMedium: "qa",
    utmCampaign: "auth-hotfix",
  }),
}), "link creation")
if (created?.link?.slug !== slug) throw new Error("link creation returned wrong slug")
console.log("✓ authenticated API granted entitlement and created link")

const app = await request("/apps/links")
if (app.status !== 200 || !(await app.text()).includes("Link + QR + UTM Manager")) throw new Error(`authenticated app page failed: ${app.status}`)
console.log("✓ authenticated app page renders")

const redirect = await fetch(`${baseUrl}/r/${slug}`, { redirect: "manual" })
if (redirect.status !== 307) throw new Error(`redirect returned ${redirect.status}`)
const location = new URL(redirect.headers.get("location"))
if (location.searchParams.get("smoke") !== "1" || location.searchParams.get("utm_source") !== "vibecart" || location.searchParams.get("utm_medium") !== "qa" || location.searchParams.get("utm_campaign") !== "auth-hotfix") {
  throw new Error(`UTM redirect mismatch: ${location}`)
}
console.log("✓ redirect and UTM merge work")

const listed = await json(await request("/api/apps/links"), "analytics list")
const link = listed.links?.find(item => item.slug === slug)
if (!link || Number(link.clickCount) < 1 || !link.lastClickedAt) throw new Error(`analytics missing: ${JSON.stringify(link)}`)
console.log("✓ click analytics updated")
console.log(JSON.stringify({ ok: true, email, slug }, null, 2))
