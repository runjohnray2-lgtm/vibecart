import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

async function transpile(path) {
  const source = await readFile(path, "utf8")
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
}

function evaluate(code, shims) {
  const testModule = { exports: {} }
  const shimRequire = name => {
    if (name === "node:crypto") return require("node:crypto")
    if (name in shims) return shims[name]
    throw new Error(`Unexpected runtime import: ${name}`)
  }
  new Function("require", "exports", "module", code)(shimRequire, testModule.exports, testModule)
  return testModule.exports
}

const salesAssistant = evaluate(await transpile("lib/sales-assistant.ts"), {})

const fitmentProduct = {
  id: "test-fitment",
  name: "Test Fitment Part",
  description: "Synthetic fixture.",
  priceCents: 1000,
  image: "",
  availability: "in_stock",
  compatibility: {
    mode: "structured",
    required: ["make", "model", "year"],
    attributes: {
      make: ["Honda"],
      model: ["Grom"],
      year: ["2014", "2015", "2016"],
    },
  },
}

const outOfStockProduct = {
  id: "test-out",
  name: "Test Out Product",
  description: "Synthetic fixture.",
  priceCents: 1000,
  image: "",
  availability: "out_of_stock",
  compatibility: { mode: "not_required" },
}

const unknownProduct = {
  id: "test-unknown",
  name: "Test Unknown Product",
  description: "Synthetic fixture.",
  priceCents: 1000,
  image: "",
  availability: "unknown",
}

async function loadSalesCart(products = new Map()) {
  const createCalls = []
  const salesCartModule = evaluate(await transpile("lib/sales-cart.ts"), {
    "@/lib/cart-store": {
      createCart: async (items, key, merchantId, metadata) => {
        createCalls.push({ items, key, merchantId, metadata })
        return {
          id: "cart_test_1",
          merchantId: "merchant_test",
          status: "active",
          currency: "usd",
          items: [],
          metadata,
          subtotalCents: 1000,
          version: 1,
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-10-17T00:00:00.000Z",
          updatedAt: "2026-10-17T00:00:00.000Z",
        }
      },
    },
    "@/lib/catalog-source": {
      getCatalogProduct: async id => products.get(id) ?? null,
    },
    "@/lib/merchant-auth": {
      issueCartAccessToken: id => `token_${id}`,
    },
    "@/lib/sales-assistant": salesAssistant,
  })
  return { module: salesCartModule, createCalls }
}

const originalEnabled = process.env.VIBECART_AI_SALESPERSON_ENABLED
test.after(() => {
  if (originalEnabled === undefined) delete process.env.VIBECART_AI_SALESPERSON_ENABLED
  else process.env.VIBECART_AI_SALESPERSON_ENABLED = originalEnabled
})

test("sales cart is disabled by default", async () => {
  delete process.env.VIBECART_AI_SALESPERSON_ENABLED
  const { module, createCalls } = await loadSalesCart(new Map([[fitmentProduct.id, fitmentProduct]]))

  await assert.rejects(
    () => module.createAttributedSalesCart({
      items: [{ productId: fitmentProduct.id, quantity: 1 }],
      idempotencyKey: "sales-test-key",
      salesSessionId: module.newSalesSessionId(),
      compatibility: { make: "Honda", model: "Grom", year: "2015" },
    }),
    /AI salesperson is not enabled/
  )
  assert.equal(createCalls.length, 0)
})

test("verified fitment creates a server-priced cart with durable AI attribution", async () => {
  process.env.VIBECART_AI_SALESPERSON_ENABLED = "true"
  const { module, createCalls } = await loadSalesCart(new Map([[fitmentProduct.id, fitmentProduct]]))
  const salesSessionId = module.newSalesSessionId()

  const result = await module.createAttributedSalesCart({
    items: [{ productId: fitmentProduct.id, quantity: 1 }],
    idempotencyKey: "sales-test-key",
    salesSessionId,
    channel: "mcp",
    query: "Grom bracket",
    compatibility: { make: "Honda", model: "Grom", year: "2015" },
  })

  assert.equal(createCalls.length, 1)
  assert.deepEqual(createCalls[0].items, [{ productId: fitmentProduct.id, quantity: 1 }])
  assert.equal(createCalls[0].key, "sales-test-key")
  assert.equal(createCalls[0].metadata["vibecart.sales.source"], "ai-salesperson")
  assert.equal(createCalls[0].metadata["vibecart.sales.session"], salesSessionId)
  assert.equal(createCalls[0].metadata["vibecart.sales.channel"], "mcp")
  assert.equal(createCalls[0].metadata["vibecart.sales.query"], "Grom bracket")
  assert.match(createCalls[0].metadata["vibecart.sales.compatibility"], /"year":"2015"/)
  assert.equal(result.cart.id, "cart_test_1")
  assert.equal(result.cartAccessToken, "token_cart_test_1")
})

test("sales cart cannot bypass required fitment questions", async () => {
  process.env.VIBECART_AI_SALESPERSON_ENABLED = "true"
  const { module, createCalls } = await loadSalesCart(new Map([[fitmentProduct.id, fitmentProduct]]))

  await assert.rejects(
    () => module.createAttributedSalesCart({
      items: [{ productId: fitmentProduct.id, quantity: 1 }],
      idempotencyKey: "sales-test-key",
      salesSessionId: module.newSalesSessionId(),
      compatibility: { make: "Honda" },
    }),
    /requires compatibility fields/
  )
  assert.equal(createCalls.length, 0)
})

test("known out-of-stock product cannot enter an AI sales cart", async () => {
  process.env.VIBECART_AI_SALESPERSON_ENABLED = "true"
  const { module, createCalls } = await loadSalesCart(new Map([[outOfStockProduct.id, outOfStockProduct]]))

  await assert.rejects(
    () => module.createAttributedSalesCart({
      items: [{ productId: outOfStockProduct.id, quantity: 1 }],
      idempotencyKey: "sales-test-key",
      salesSessionId: module.newSalesSessionId(),
    }),
    /out of stock/
  )
  assert.equal(createCalls.length, 0)
})

test("fitment request cannot use a product with unknown merchant compatibility data", async () => {
  process.env.VIBECART_AI_SALESPERSON_ENABLED = "true"
  const { module, createCalls } = await loadSalesCart(new Map([[unknownProduct.id, unknownProduct]]))

  await assert.rejects(
    () => module.createAttributedSalesCart({
      items: [{ productId: unknownProduct.id, quantity: 1 }],
      idempotencyKey: "sales-test-key",
      salesSessionId: module.newSalesSessionId(),
      compatibility: { make: "Honda" },
    }),
    /does not have trusted compatibility data/
  )
  assert.equal(createCalls.length, 0)
})

test("sales cart requires bounded server-format session and idempotency identifiers", async () => {
  process.env.VIBECART_AI_SALESPERSON_ENABLED = "true"
  const { module } = await loadSalesCart(new Map([[unknownProduct.id, unknownProduct]]))

  await assert.rejects(
    () => module.createAttributedSalesCart({
      items: [{ productId: unknownProduct.id, quantity: 1 }],
      idempotencyKey: "tiny",
      salesSessionId: "made-up",
    }),
    /salesSessionId/
  )
})
