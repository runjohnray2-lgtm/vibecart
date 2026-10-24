import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import ts from "typescript"

const require = createRequire(import.meta.url)
async function load(path, shims = {}) {
  const code = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const m = { exports: {} }
  new Function("require", "exports", "module", code)(name => name in shims ? shims[name] : require(name), m.exports, m)
  return m.exports
}
const product = { id: "verified-variant", name: "Verified fixture", priceCents: 6599, image: "", availability: "made_to_order" }
const snapshot = () => ({ merchantId: "radiantz-staging", capturedAt: new Date().toISOString(), products: [product] })
const settings = {
  VERCEL_ENV: "preview", VERCEL_URL: "pilot-preview.vercel.app", VERCEL_OIDC_TOKEN: "offline-oidc",
  VIBECART_PILOT_CATALOG_ENABLED: "true", VIBECART_HOSTED_MODE: "true", VIBECART_MERCHANT_ID: "radiantz-staging",
  VIBECART_MERCHANT_API_KEY: "a".repeat(32), VIBECART_CART_ACCESS_SECRET: "b".repeat(32),
  VIBECART_STAGING_ISOLATION_VERIFIED: "true", VIBECART_STAGING_DATABASE_HOST: "ep-staging.neon.tech",
  DATABASE_URL: "postgresql://stage:offline@ep-staging.neon.tech/neondb",
  STRIPE_SECRET_KEY: "sk_test_offline", STRIPE_WEBHOOK_SECRET: "whsec_offline",
}

test("private pilot feed authorization, freshness, validation and same-origin credentials", async t => {
  const previous = { ...process.env }, previousFetch = globalThis.fetch
  Object.assign(process.env, settings)
  for (const key of ["POSTGRES_URL", "VIBECART_CLOUD_INGEST_URL", "VIBECART_CLOUD_INGEST_KEY", "VIBECART_CLOUD_OUTBOX_CRON_ENABLED", "VIBECART_CATALOG_URL", "VIBECART_CATALOG_BEARER_TOKEN"]) delete process.env[key]
  try {
    const catalog = await load("lib/catalog-source.ts", {
      "@/lib/products": { PRODUCTS: [], PRODUCT_AVAILABILITY_STATUSES: ["in_stock", "out_of_stock", "made_to_order", "preorder", "unknown"] },
      "node:dns/promises": { lookup: async () => [{ address: "8.8.8.8", family: 4 }] },
    })
    const auth = await load("lib/merchant-auth.ts")
    const safety = await load("lib/preview-safety.ts")
    const route = await load("app/api/pilot/catalog/route.ts", {
      "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
      "@/lib/catalog-source": catalog, "@/lib/merchant-auth": auth, "@/lib/preview-safety": safety,
    })
    const request = (authorized = true) => new Request("https://pilot-preview.vercel.app/api/pilot/catalog", { headers: authorized ? { "x-vibecart-merchant-key": settings.VIBECART_MERCHANT_API_KEY } : {} })
    process.env.VIBECART_PILOT_CATALOG_JSON = JSON.stringify(snapshot())
    await t.test("production never exposes a snapshot even if the flag is set", async () => {
      process.env.VERCEL_ENV = "production"
      assert.equal((await route.GET(request())).status, 404)
      process.env.VERCEL_ENV = "preview"
    })
    await t.test("unverified staging and absent merchant auth fail closed", async () => {
      process.env.VIBECART_STAGING_ISOLATION_VERIFIED = "false"
      assert.equal((await route.GET(request())).status, 503)
      process.env.VIBECART_STAGING_ISOLATION_VERIFIED = "true"
      assert.equal((await route.GET(request(false))).status, 401)
    })
    for (const [name, value] of [
      ["stale capture", { ...snapshot(), capturedAt: "2020-01-01" }],
      ["wrong merchant", { ...snapshot(), merchantId: "another-merchant" }],
      ["invalid price", { ...snapshot(), products: [{ ...product, priceCents: -1 }] }],
      ["oversized subset", { ...snapshot(), products: Array(21).fill(product) }],
    ]) await t.test(`${name} is rejected without exposing snapshot contents`, async () => {
      process.env.VIBECART_PILOT_CATALOG_JSON = JSON.stringify(value)
      const result = await route.GET(request())
      assert.equal(result.status, 503)
      assert.doesNotMatch(await result.text(), /6599|verified-variant|another-merchant/)
    })
    await t.test("validated feed preserves exact price, stock and unknown fitment", async () => {
      process.env.VIBECART_PILOT_CATALOG_JSON = JSON.stringify(snapshot())
      const result = await route.GET(request())
      assert.equal(result.status, 200)
      assert.equal(result.headers.get("cache-control"), "no-store")
      assert.match(result.headers.get("x-robots-tag"), /noindex/)
      const body = await result.json()
      assert.equal(body.products[0].priceCents, 6599)
      assert.equal(body.products[0].availability, "made_to_order")
      assert.equal(body.products[0].compatibility, undefined)
    })
    await t.test("protected internal HTTP feed uses scoped auth and existing catalog validation", async () => {
      let calls = 0
      globalThis.fetch = async (url, init) => {
        calls++
        assert.equal(url.href, "https://pilot-preview.vercel.app/api/pilot/catalog")
        assert.equal(init.headers["x-vercel-trusted-oidc-idp-token"], "offline-oidc")
        assert.equal(init.headers["x-vibecart-merchant-key"], settings.VIBECART_MERCHANT_API_KEY)
        assert.equal(init.redirect, "manual")
        return route.GET(new Request(url, init))
      }
      const products = await catalog.listCatalogProducts()
      assert.equal(products[0].priceCents, 6599)
      assert.equal(calls, 1)
    })
    await t.test("external catalog never receives Preview OIDC or merchant secrets", async () => {
      process.env.VIBECART_PILOT_CATALOG_ENABLED = "false"
      process.env.VIBECART_CATALOG_URL = "https://external.example/catalog"
      globalThis.fetch = async (_url, init) => {
        assert.equal(init.headers["x-vercel-trusted-oidc-idp-token"], undefined)
        assert.equal(init.headers["x-vibecart-merchant-key"], undefined)
        return Response.json({ products: [product] })
      }
      await catalog.listCatalogProducts()
    })
    await t.test("missing runtime OIDC fails before a protected feed request", async () => {
      process.env.VIBECART_PILOT_CATALOG_ENABLED = "true"
      delete process.env.VERCEL_OIDC_TOKEN
      const fresh = await load("lib/catalog-source.ts", {
        "@/lib/products": { PRODUCTS: [], PRODUCT_AVAILABILITY_STATUSES: ["made_to_order"] },
        "node:dns/promises": { lookup: async () => [{ address: "8.8.8.8", family: 4 }] },
      })
      globalThis.fetch = async () => { throw new Error("Must not fetch without auth") }
      await assert.rejects(fresh.listCatalogProducts(), /authentication is unavailable/)
    })
  } finally {
    globalThis.fetch = previousFetch
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})
