import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

const source = await readFile("lib/staging-database-verification.ts", "utf8")
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const settings = {
 VERCEL_ENV: "preview", VIBECART_STAGING_ISOLATION_VERIFIED: "false", VIBECART_HOSTED_MODE: "true",
 VIBECART_MERCHANT_ID: "radiantz-staging", VIBECART_MERCHANT_API_KEY: "a".repeat(32),
 DATABASE_URL: "postgresql://vibecart_pilot_runtime:offline@ep-blue-hill-b46430js-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require",
 VIBECART_STAGING_DATABASE_HOST: "ep-blue-hill-b46430js-pooler.c-6.us-east-2.aws.neon.tech",
 VERCEL_GIT_COMMIT_SHA: "offline-commit", VERCEL_URL: "offline.vercel.app",
}

test("temporary Preview diagnostic authenticates before read-only SQL and preserves the lock", async t => {
 const old = { ...process.env }
 const realNow = Date.now
 Date.now = () => Date.parse("2026-10-19T03:00:00Z")
 let connections = 0, transactions = 0, fail = false
 let identity = { database: "neondb", role: "vibecart_pilot_runtime", transaction_read_only: "on" }
 const sql = {
  query(query) { assert.match(query.trim(), /^SELECT /); assert.doesNotMatch(query, /;\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i); return query },
  async transaction(queries, options) {
   transactions++
   assert.equal(options.readOnly, true)
   assert.equal(options.isolationLevel, "RepeatableRead")
   assert.ok(options.fetchOptions.signal)
   assert.equal(queries.length, 7)
   if (fail) throw Error(settings.DATABASE_URL)
   return [[identity], [{ rolsuper: false }], [], [{ public_create: false }], [], [], []]
  },
 }
 const mod = { exports: {} }
 new Function("require", "exports", "module", code)(name => {
  if (name === "@neondatabase/serverless") return { neon: () => { connections++; return sql } }
  if (name === "@/lib/merchant-auth") return { merchantRequestAuthorized: req => req.headers.get("x-vibecart-merchant-key") === settings.VIBECART_MERCHANT_API_KEY }
  throw Error(name)
 }, mod.exports, mod)
 const request = authorized => new Request("https://offline.vercel.app/api/health?staging-database=verify", {
  headers: authorized ? { "x-vibecart-merchant-key": settings.VIBECART_MERCHANT_API_KEY } : {},
 })
 function reset() {
  for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]
  Object.assign(process.env, old, settings)
  delete process.env.POSTGRES_URL
 }
 try {
  for (const [name, key, value, status] of [
   ["production", "VERCEL_ENV", "production", 404],
   ["already unlocked", "VIBECART_STAGING_ISOLATION_VERIFIED", "true", 404],
   ["wrong merchant", "VIBECART_MERCHANT_ID", "other", 404],
   ["unhosted", "VIBECART_HOSTED_MODE", "false", 404],
   ["wrong host", "DATABASE_URL", settings.DATABASE_URL.replace("ep-blue-hill-b46430js-pooler", "ep-production"), 503],
   ["owner role", "DATABASE_URL", settings.DATABASE_URL.replace("vibecart_pilot_runtime", "neondb_owner"), 503],
   ["different database", "DATABASE_URL", settings.DATABASE_URL.replace("/neondb", "/production"), 503],
   ["endpoint options", "DATABASE_URL", settings.DATABASE_URL + "&options=endpoint%3Dep-production", 503],
   ["TLS downgrade", "DATABASE_URL", settings.DATABASE_URL.replace("sslmode=require", "sslmode=disable"), 503],
   ["fallback URL", "POSTGRES_URL", "postgresql://offline@production.invalid/live", 503],
  ]) await t.test(name + " never connects", async () => {
   reset(); process.env[key] = value
   assert.equal((await mod.exports.verifyStagingDatabase(request(true))).status, status)
   assert.equal(connections, 0)
  })
  await t.test("missing merchant credential never connects", async () => {
   reset(); assert.equal((await mod.exports.verifyStagingDatabase(request(false))).status, 401)
   assert.equal(connections, 0)
  })
  await t.test("expired database never connects", async () => {
   reset(); Date.now = () => Date.parse("2026-10-22T00:00:00Z")
   assert.equal((await mod.exports.verifyStagingDatabase(request(true))).status, 404)
   assert.equal(connections, 0); Date.now = () => Date.parse("2026-10-19T03:00:00Z")
  })
  await t.test("authenticated diagnostic uses a READ ONLY transaction", async () => {
   reset(); const response = await mod.exports.verifyStagingDatabase(request(true))
   assert.equal(response.status, 200)
   const body = await response.json()
   assert.equal(body.identity.role, "vibecart_pilot_runtime")
   assert.equal(body.isolationLock, false)
   assert.equal(body.deployment.commit, "offline-commit")
   assert.equal(process.env.VIBECART_STAGING_ISOLATION_VERIFIED, "false")
   assert.equal(response.headers.get("cache-control"), "no-store")
   assert.doesNotMatch(JSON.stringify(body), /postgresql|offline@|a{32}/)
   assert.equal(transactions, 1)
  })
  await t.test("incorrect PostgreSQL identity is rejected", async () => {
   identity = { ...identity, role: "neondb_owner" }
   assert.equal((await mod.exports.verifyStagingDatabase(request(true))).status, 503)
   identity = { ...identity, role: "vibecart_pilot_runtime" }
  })
  await t.test("private form contains no credential and closes outside locked Preview", async () => {
   const response = mod.exports.stagingVerificationForm()
   assert.equal(response.status, 200)
   assert.match(response.headers.get("content-security-policy"), /form-action 'self'/)
   assert.equal(response.headers.get("referrer-policy"), "same-origin")
   assert.doesNotMatch(await response.text(), /a{32}|postgresql:/)
   process.env.VERCEL_ENV = "production"
   assert.equal(mod.exports.stagingVerificationForm().status, 404)
   process.env.VERCEL_ENV = "preview"
  })
  await t.test("form rejects cross-origin and oversized posts before connecting", async () => {
   const before = connections
   const post = (origin, body) => new Request("https://offline.vercel.app/api/health?staging-database=verify", {
    method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body,
   })
   assert.equal((await mod.exports.submitStagingVerification(post("https://other.invalid", "merchantKey=" + settings.VIBECART_MERCHANT_API_KEY))).status, 403)
   assert.equal((await mod.exports.submitStagingVerification(post("https://offline.vercel.app", "x".repeat(2049)))).status, 413)
   assert.equal((await mod.exports.submitStagingVerification(post("https://offline.vercel.app", "merchantKey=wrong"))).status, 401)
   assert.equal((await mod.exports.submitStagingVerification(post("null", "merchantKey=" + settings.VIBECART_MERCHANT_API_KEY))).status, 403)
   assert.equal(connections, before)
  })
  await t.test("same-origin form credential authorizes only read-only introspection", async () => {
   const response = await mod.exports.submitStagingVerification(new Request("http://localhost:3000/api/health?staging-database=verify", {
    method: "POST", headers: { origin: "https://offline.vercel.app", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ merchantKey: settings.VIBECART_MERCHANT_API_KEY }),
   }))
   assert.equal(response.status, 200)
   assert.equal((await response.json()).isolationLock, false)
  })
  await t.test("driver errors never disclose connection strings", async () => {
   fail = true
   const response = await mod.exports.verifyStagingDatabase(request(true))
   assert.equal(response.status, 503)
   assert.doesNotMatch(await response.text(), /postgresql|offline@/)
  })
 } finally {
  Date.now = realNow
  for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]
  Object.assign(process.env, old)
 }
})
