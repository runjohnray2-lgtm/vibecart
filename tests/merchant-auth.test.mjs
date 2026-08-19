import assert from "node:assert/strict"
import { readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import ts from "typescript"

async function loadMerchantAuth() {
  const source = await readFile("lib/merchant-auth.ts", "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const path = join(tmpdir(), `vibecart-merchant-auth-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
  await writeFile(path, compiled, "utf8")
  const authModule = await import(`${pathToFileURL(path).href}?t=${Date.now()}`)
  return { authModule, cleanup: () => rm(path, { force: true }) }
}

function withEnv(values, fn) {
  const keys = [
    "VIBECART_HOSTED_MODE",
    "VIBECART_MERCHANT_ID",
    "VIBECART_MERCHANT_API_KEY",
    "VIBECART_CART_ACCESS_SECRET",
  ]
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  for (const [key, value] of Object.entries(values)) process.env[key] = value
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of keys) {
        const value = previous[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
}

function request(headers = {}) {
  return new Request("https://merchant.example/api/cart/cart-1", { headers })
}

test("self-host mode remains low-friction and defaults to one merchant", async () => {
  const { authModule, cleanup } = await loadMerchantAuth()
  try {
    await withEnv({}, async () => {
      assert.equal(authModule.hostedModeEnabled(), false)
      assert.equal(authModule.configuredMerchantId(), "default")
      assert.equal(authModule.merchantRequestAuthorized(request()), true)
      assert.equal(authModule.cartRequestAuthorized(request(), "cart-1"), true)
      assert.equal(authModule.issueCartAccessToken("cart-1"), null)
    })
  } finally {
    await cleanup()
  }
})

test("hosted mode fails closed when merchant identity or secrets are missing", async () => {
  const { authModule, cleanup } = await loadMerchantAuth()
  try {
    await withEnv({ VIBECART_HOSTED_MODE: "true" }, async () => {
      assert.equal(authModule.hostedMerchantAuthConfigured(), false)
      assert.throws(() => authModule.configuredMerchantId(), /explicit VIBECART_MERCHANT_ID/)
    })
  } finally {
    await cleanup()
  }
})

test("hosted merchant and cart access are authenticated with separate scoped credentials", async () => {
  const { authModule, cleanup } = await loadMerchantAuth()
  try {
    await withEnv({
      VIBECART_HOSTED_MODE: "true",
      VIBECART_MERCHANT_ID: "radiantz",
      VIBECART_MERCHANT_API_KEY: "merchant-key-abcdefghijklmnopqrstuvwxyz",
      VIBECART_CART_ACCESS_SECRET: "cart-secret-abcdefghijklmnopqrstuvwxyz-1234567890",
    }, async () => {
      assert.equal(authModule.hostedMerchantAuthConfigured(), true)
      assert.equal(authModule.configuredMerchantId(), "radiantz")
      assert.equal(authModule.merchantRequestAuthorized(request()), false)
      assert.equal(authModule.merchantRequestAuthorized(request({ "x-vibecart-merchant-key": "wrong" })), false)
      assert.equal(authModule.merchantRequestAuthorized(request({ "x-vibecart-merchant-key": "merchant-key-abcdefghijklmnopqrstuvwxyz" })), true)

      const token = authModule.issueCartAccessToken("cart-1")
      assert.match(token, /^v1\.[A-Za-z0-9_-]+$/)
      assert.equal(authModule.cartRequestAuthorized(request({ authorization: `Bearer ${token}` }), "cart-1"), true)
      assert.equal(authModule.cartRequestAuthorized(request({ authorization: `Bearer ${token}` }), "cart-2"), false)
      assert.equal(authModule.cartRequestAuthorized(request({ authorization: "Bearer v1.invalid" }), "cart-1"), false)
      assert.equal(
        authModule.cartRequestAuthorized(
          request({ "x-vibecart-merchant-key": "merchant-key-abcdefghijklmnopqrstuvwxyz" }),
          "cart-1"
        ),
        true
      )
    })
  } finally {
    await cleanup()
  }
})

test("cart capability tokens are bound to both merchant and cart identity", async () => {
  const { authModule, cleanup } = await loadMerchantAuth()
  try {
    await withEnv({
      VIBECART_HOSTED_MODE: "true",
      VIBECART_MERCHANT_ID: "merchant-a",
      VIBECART_MERCHANT_API_KEY: "merchant-key-abcdefghijklmnopqrstuvwxyz",
      VIBECART_CART_ACCESS_SECRET: "cart-secret-abcdefghijklmnopqrstuvwxyz-1234567890",
    }, async () => {
      const a1 = authModule.issueCartAccessToken("cart-1", "merchant-a")
      const a2 = authModule.issueCartAccessToken("cart-2", "merchant-a")
      const b1 = authModule.issueCartAccessToken("cart-1", "merchant-b")
      assert.notEqual(a1, a2)
      assert.notEqual(a1, b1)
    })
  } finally {
    await cleanup()
  }
})

test("durable cart queries stay tenant-scoped", async () => {
  const source = await readFile("lib/cart-store.ts", "utf8")
  assert.match(source, /WHERE id = \$\{id\} AND merchant_id = \$\{merchantId\}/)
  assert.match(source, /WHERE id = \$\{id\} AND merchant_id = \$\{merchantId\} AND status = 'active'/)
  assert.match(source, /configuredMerchantId\(\)/)
})

test("hosted REST cart routes require merchant or cart authorization", async () => {
  const createRoute = await readFile("app/api/cart/route.ts", "utf8")
  const cartRoute = await readFile("app/api/cart/[id]/route.ts", "utf8")
  const checkoutRoute = await readFile("app/api/cart/[id]/checkout/route.ts", "utf8")
  assert.match(createRoute, /merchantRequestAuthorized\(req\)/)
  assert.match(createRoute, /cartAccessToken/)
  assert.match(cartRoute, /cartRequestAuthorized\(req, id\)/)
  assert.match(checkoutRoute, /cartRequestAuthorized\(req, id\)/)
})

test("hosted middleware gates MCP, UCP, direct checkout and cart creation", async () => {
  const middleware = await readFile("middleware.ts", "utf8")
  assert.match(middleware, /"\/mcp"/)
  assert.match(middleware, /"\/ucp\/mcp"/)
  assert.match(middleware, /"\/api\/checkout"/)
  assert.match(middleware, /"\/api\/cart"/)
  assert.match(middleware, /x-vibecart-merchant-key/)
  assert.match(middleware, /MERCHANT_AUTH_NOT_CONFIGURED/)
  assert.match(middleware, /UNAUTHORIZED/)
})
