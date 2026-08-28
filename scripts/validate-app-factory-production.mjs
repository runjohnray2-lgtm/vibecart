import { randomBytes } from "node:crypto"

// Production launch gate for the first App Factory product.
const baseUrl = "https://vibecart.vercel.app"
const origin = new URL(baseUrl).origin
const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`
const email = `appfactory-live-${stamp}@example.com`
const password = `VibeCart-${randomBytes(18).toString("base64url")}!9`
const slug = `live-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`
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

console.log(`Validating production App Factory at ${baseUrl}`)

const signup = await request("/api/apps/auth", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "sign-up", email, password, name: "App Factory Production Validation" }),
})
await json(signup, "account creation")
console.log("PASS account creation")

const session = await json(await request("/api/auth/get-session"), "session lookup")
if (!session?.user?.id || session.user.email !== email) throw new Error(`session not established: ${JSON.stringify(session)}`)
console.log("PASS authenticated session")

const created = await json(await request("/api/apps/links", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "Production validation link",
    slug,
    destinationUrl: `${baseUrl}/apps?validation=1`,
    utmSource: "vibecart",
    utmMedium: "production-test",
    utmCampaign: "first-app-launch",
  }),
}), "link creation")
if (created?.link?.slug !== slug) throw new Error(`wrong created slug: ${JSON.stringify(created)}`)
console.log("PASS create tracked link")

const app = await request("/apps/links")
const appHtml = await app.text()
if (app.status !== 200 || !appHtml.includes("Link + QR + UTM Manager")) throw new Error(`authenticated app page failed (${app.status})`)
console.log("PASS authenticated app page")

const redirect = await fetch(`${baseUrl}/r/${slug}`, { redirect: "manual" })
if (redirect.status !== 307) throw new Error(`redirect returned ${redirect.status}`)
const locationHeader = redirect.headers.get("location")
if (!locationHeader) throw new Error("redirect missing location")
const location = new URL(locationHeader)
if (location.searchParams.get("validation") !== "1" || location.searchParams.get("utm_source") !== "vibecart" || location.searchParams.get("utm_medium") !== "production-test" || location.searchParams.get("utm_campaign") !== "first-app-launch") {
  throw new Error(`UTM redirect mismatch: ${location}`)
}
console.log("PASS redirect and UTM merge")

await new Promise(resolve => setTimeout(resolve, 800))
const listed = await json(await request("/api/apps/links"), "analytics list")
const link = listed.links?.find(item => item.slug === slug)
if (!link || Number(link.clickCount) < 1 || !link.lastClickedAt) throw new Error(`click analytics missing: ${JSON.stringify(link)}`)
console.log("PASS click analytics")

console.log(JSON.stringify({ ok: true, email, slug, destination: location.toString() }, null, 2))
