import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

async function loadSalesAssistant() {
  const source = await readFile("lib/sales-assistant.ts", "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const testModule = { exports: {} }
  new Function("require", "exports", "module", compiled)(
    name => { throw new Error(`Unexpected runtime import: ${name}`) },
    testModule.exports,
    testModule
  )
  return testModule.exports
}

const fitmentProduct = {
  id: "test-grom-bracket-14-16",
  name: "Test Grom Plate Bracket",
  description: "Synthetic test fixture for grounded motorcycle fitment.",
  priceCents: 9900,
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
    questions: {
      year: "What year is the motorcycle?",
      make: "What make is the motorcycle?",
      model: "What model is the motorcycle?",
    },
    statement: "Test fixture: Honda Grom 2014-2016 only.",
  },
}

const universalProduct = {
  id: "test-universal-sticker",
  name: "Test Universal Sticker",
  description: "Synthetic universal catalog fixture.",
  priceCents: 1200,
  image: "",
  availability: "made_to_order",
  compatibility: {
    mode: "not_required",
    statement: "No vehicle fitment required.",
  },
}

const unknownFitmentProduct = {
  id: "test-unknown-fitment",
  name: "Test Unknown Fitment Light",
  description: "Synthetic fixture with no merchant-supplied fitment data.",
  priceCents: 5000,
  image: "",
  availability: "unknown",
}

test("sales discovery asks trusted fitment questions instead of guessing", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()
  const result = discoverSalesProducts([fitmentProduct, universalProduct], {
    query: "Grom plate bracket",
  })

  assert.equal(result.status, "needs_clarification")
  assert.equal(result.matches.length, 0)
  assert.equal(result.candidates[0].product.id, fitmentProduct.id)
  assert.deepEqual(
    result.clarifyingQuestions.map(question => question.field).sort(),
    ["make", "model", "year"]
  )
  assert.ok(result.clarifyingQuestions.some(question => question.question === "What year is the motorcycle?"))
})

test("sales discovery returns exact product, availability and verified compatibility", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()
  const result = discoverSalesProducts([fitmentProduct, universalProduct], {
    query: "Grom plate bracket",
    compatibility: { make: "honda", model: "GROM", year: "2015" },
  })

  assert.equal(result.status, "matches")
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].product.id, fitmentProduct.id)
  assert.equal(result.matches[0].product.priceCents, 9900)
  assert.equal(result.matches[0].availability, "in_stock")
  assert.equal(result.matches[0].compatibility.status, "verified")
  assert.deepEqual(result.matches[0].compatibility.matched, {
    make: "honda",
    model: "GROM",
    year: "2015",
  })
})

test("incompatible fitment produces a safe no-match result", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()
  const result = discoverSalesProducts([fitmentProduct], {
    query: "Grom plate bracket",
    compatibility: { make: "Honda", model: "Grom", year: "2020" },
  })

  assert.equal(result.status, "no_match")
  assert.deepEqual(result.matches, [])
  assert.match(result.message, /Do not invent/)
})

test("merchant fitment data cannot be inferred when the catalog does not provide it", async () => {
  const { discoverSalesProducts, assertSalesCompatibility } = await loadSalesAssistant()
  const result = discoverSalesProducts([unknownFitmentProduct], {
    query: "fitment light",
    compatibility: { make: "Honda", model: "Grom", year: "2015" },
  })

  assert.equal(result.status, "no_match")
  assert.equal(result.matches.length, 0)
  assert.equal(result.candidates[0].compatibility.status, "unknown")
  assert.match(result.message, /has not provided structured compatibility data/)
  assert.throws(
    () => assertSalesCompatibility(unknownFitmentProduct, { make: "Honda" }),
    /does not have trusted compatibility data/
  )
})

test("not-required compatibility stays explicit and availability is never inferred", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()
  const result = discoverSalesProducts([universalProduct], {
    query: "universal sticker",
    compatibility: { make: "Honda" },
  })

  assert.equal(result.status, "matches")
  assert.equal(result.matches[0].compatibility.status, "not_required")
  assert.equal(result.matches[0].availability, "made_to_order")
})

test("sales cart guard rejects missing or mismatched structured compatibility", async () => {
  const { assertSalesCompatibility } = await loadSalesAssistant()

  assert.throws(
    () => assertSalesCompatibility(fitmentProduct, { make: "Honda" }),
    /requires compatibility fields: model, year/
  )
  assert.throws(
    () => assertSalesCompatibility(fitmentProduct, { make: "Honda", model: "Grom", year: "2022" }),
    /is not compatible/
  )
  assert.equal(
    assertSalesCompatibility(
      fitmentProduct,
      { make: "Honda", model: "Grom", year: "2014" }
    ).status,
    "verified"
  )
})

test("sales input is bounded and malformed compatibility is rejected", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()

  assert.throws(
    () => discoverSalesProducts([universalProduct], { query: "" }),
    /query must be/
  )
  assert.throws(
    () => discoverSalesProducts([universalProduct], {
      query: "sticker",
      compatibility: { "bad key!": "x" },
    }),
    /Compatibility keys/
  )
  assert.throws(
    () => discoverSalesProducts([universalProduct], { query: "sticker", limit: 500 }),
    /limit must be/
  )
})

test("unverified extra fitment attributes never produce a verified match or cart", async () => {
  const { discoverSalesProducts, assertSalesCompatibility } = await loadSalesAssistant()
  const attributes = { make: "Honda", model: "Grom", year: "2015", trim: "unverified-trim" }
  const result = discoverSalesProducts([fitmentProduct], { query: "Grom bracket", compatibility: attributes })
  assert.equal(result.status, "no_match")
  assert.equal(result.matches.length, 0)
  assert.equal(result.candidates[0].compatibility.status, "unknown")
  assert.throws(() => assertSalesCompatibility(fitmentProduct, attributes), /does not have trusted compatibility data/)
})

test("conflicting case variants of a shopper attribute cannot hide a mismatch", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()
  assert.throws(() => discoverSalesProducts([fitmentProduct], {
    query: "Grom bracket", compatibility: { make: "Yamaha", MAKE: "Honda", model: "Grom", year: "2015" },
  }), /duplicate compatibility field/i)
})

test("known out-of-stock matches stay visible as candidates but are not recommended", async () => {
  const { discoverSalesProducts } = await loadSalesAssistant()
  const result = discoverSalesProducts([{ ...fitmentProduct, availability: "out_of_stock" }], {
    query: "Grom bracket", compatibility: { make: "Honda", model: "Grom", year: "2015" },
  })
  assert.equal(result.status, "no_match")
  assert.equal(result.matches.length, 0)
  assert.equal(result.candidates[0].availability, "out_of_stock")
  assert.match(result.message, /out of stock/i)
})
