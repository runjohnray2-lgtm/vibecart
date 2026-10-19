import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
const require = createRequire(import.meta.url)
const ts = require("typescript")
const code = ts.transpileModule(await readFile("lib/merchant-revenue.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exportsObject = {}
new Function("exports", code)(exportsObject)
const { summarizeMerchantRevenue } = exportsObject
const order = (merchantId, checkoutSessionId, amountTotal, currency = "usd", source = "") => ({ merchantId, checkoutSessionId, amountTotal, currency, paymentStatus: "paid", metadata: { source } })
test("revenue is merchant-scoped and idempotent by checkout session", () => {
  assert.deepEqual(summarizeMerchantRevenue("a", [order("a","s1",1000,"USD","mcp:assistant"),order("a","s1",1000,"usd","mcp:assistant"),order("b","s2",9000),order("a","s3",500)]), [{ currency:"usd",paidOrders:2,grossCents:1500,aiAttributedOrders:1,aiAttributedCents:1000 }])
})
test("currencies stay separate and unpaid or invalid totals are excluded", () => {
  const unpaid = {...order("a","s4",100),paymentStatus:"unpaid"}
  assert.deepEqual(summarizeMerchantRevenue("a", [order("a","s1",100,"usd","agent"),order("a","s2",200,"eur"),unpaid,order("a","s5",-5)]), [{currency:"eur",paidOrders:1,grossCents:200,aiAttributedOrders:0,aiAttributedCents:0},{currency:"usd",paidOrders:1,grossCents:100,aiAttributedOrders:1,aiAttributedCents:100}])
})
test("merchant identifier required", () => assert.throws(() => summarizeMerchantRevenue(" ",[])))
