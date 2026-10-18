import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

async function load(path, shims = {}) {
  const source = await readFile(path, "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const testModule = { exports: {} }
  new Function("require", "exports", "module", code)(name => {
    if (name in shims) return shims[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, testModule.exports, testModule)
  return testModule.exports
}
const safety = await load("lib/preview-safety.ts")
const valid = {
  VERCEL_ENV: "preview", VIBECART_STAGING_ISOLATION_VERIFIED: "true",
  DATABASE_URL: "postgresql://staging:offline@ep-staging.neon.tech/test",
  VIBECART_STAGING_DATABASE_HOST: "ep-staging.neon.tech",
  STRIPE_SECRET_KEY: "sk_test_offline", STRIPE_WEBHOOK_SECRET: "whsec_offline",
  VIBECART_HOSTED_MODE: "true", VIBECART_MERCHANT_ID: "staging-merchant",
  VIBECART_MERCHANT_API_KEY: "a".repeat(24), VIBECART_CART_ACCESS_SECRET: "b".repeat(32),
}
test("Preview needs explicit verified staging configuration; production is unchanged", () => {
  assert.equal(safety.previewSafetyFailure({ VERCEL_ENV: "production" }), null)
  assert.equal(safety.previewSafetyFailure({ VERCEL_ENV: "preview" }), "isolation_unverified")
  assert.equal(safety.previewSafetyFailure(valid), null)
  assert.equal(safety.previewSafetyFailure({ ...valid, STRIPE_SECRET_KEY: "rk_test_offline" }), null)
})
for (const [key, value, reason] of [
  ["DATABASE_URL", "postgresql://prod:secret@ep-prod.neon.tech/live", "database_target_unverified"],
  ["DATABASE_URL", "bad credential never echoed", "database_target_unverified"],
  ["POSTGRES_URL", "postgresql://prod:secret@ep-prod.neon.tech/live", "database_fallback_mismatch"],
  ["STRIPE_SECRET_KEY", "sk_live_never_used", "test_payments_unconfigured"],
  ["STRIPE_WEBHOOK_SECRET", "", "test_payments_unconfigured"],
  ["VIBECART_HOSTED_MODE", "false", "merchant_isolation_unconfigured"],
  ["VIBECART_MERCHANT_ID", "default", "merchant_isolation_unconfigured"],
  ["VIBECART_MERCHANT_API_KEY", "short", "merchant_isolation_unconfigured"],
  ["VIBECART_CLOUD_INGEST_URL", "https://external.invalid", "external_delivery_enabled"],
  ["VIBECART_CLOUD_OUTBOX_CRON_ENABLED", "true", "external_delivery_enabled"],
]) test(`Preview rejects unsafe ${key}: ${reason}`, () => {
  assert.equal(safety.previewSafetyFailure({ ...valid, [key]: value }), reason)
})
test("Preview excludes billing, probes, cron, Cloud ingest and other app APIs", () => {
  for (const path of ["/api/billing-portal", "/api/vibecart-founder-checkout", "/api/cron/cloud-outbox", "/api/cloud/ingest/id", "/api/agent-readiness", "/api/auth/sign-in"]) assert.equal(safety.previewRouteAllowed(path), false)
  for (const path of ["/api/cart", "/api/cart/id", "/api/cart/id/checkout", "/api/checkout", "/api/webhook/stripe"]) assert.equal(safety.previewRouteAllowed(path), true)
})
test("Unverified Preview blocks before rate limiter/database access and marks response noindex", async () => {
  const previous = { ...process.env }
  process.env.VERCEL_ENV = "preview"
  delete process.env.VIBECART_STAGING_ISOLATION_VERIFIED
  let limiterCalls = 0
  try {
    const mod = await load("middleware.ts", {
      "@/lib/preview-safety": safety,
      "next/server": { NextResponse: { json: (body, init) => Response.json(body, init), next: () => new Response() } },
      "@/lib/distributed-rate-limit": { consumeRateLimit: () => { limiterCalls += 1; throw new Error("must not touch shared database") } },
    })
    for (const path of ["/api/cart", "/api/checkout", "/api/webhook/stripe", "/mcp", "/ucp/mcp"]) {
      const result = await mod.middleware({ method: "POST", nextUrl: { pathname: path }, headers: new Headers() })
      assert.equal(result.status, 503)
      assert.equal((await result.json()).code, "STAGING_SAFETY_GATE")
      assert.match(result.headers.get("x-robots-tag"), /noindex/)
    }
    assert.equal(limiterCalls, 0)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test("Preview webhook rejects live or unclassified events after signature verification", async () => {
  const previous = { ...process.env }
  process.env.VERCEL_ENV = "preview"
  process.env.STRIPE_SECRET_KEY = "sk_test_offline"
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_offline"
  let persisted = 0
  try {
    class Stripe {
      webhooks = { constructEvent: raw => JSON.parse(raw) }
    }
    const route = await load("app/api/webhook/stripe/route.ts", {
      stripe: { default: Stripe },
      "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
      "@/lib/payment-durability": { persistVerifiedCheckoutEvent: async () => { persisted += 1; return { id: "order" } } },
      "@/lib/cloud-outbox": { attemptCloudOutboxForOrder: async () => null },
    })
    for (const livemode of [true, undefined, false]) {
      const response = await route.POST(new Request("https://staging.invalid/api/webhook/stripe", {
        method: "POST", headers: { "stripe-signature": "verified-by-shim" },
        body: JSON.stringify({ id: "evt_test", type: "checkout.session.completed", livemode, data: { object: { id: "cs_test", payment_status: "paid" } } }),
      }))
      assert.equal(response.status, livemode === false ? 200 : 400)
    }
    assert.equal(persisted, 1)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})
