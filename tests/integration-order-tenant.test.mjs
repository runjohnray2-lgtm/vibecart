import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { PGlite } from "@electric-sql/pglite"

const localRequire = createRequire(import.meta.url)
const ts = localRequire("typescript")

test("authenticated integration A cannot retrieve B orders: actual route and PostgreSQL", async () => {
 const pg = new PGlite()
 const env = { DATABASE_URL: "postgresql://offline.invalid/test", VIBECART_MERCHANT_ID: "merchant_a",
  VIBECART_HOSTED_MODE: "true", HSN_CLOUD_INTEGRATION_ID: "integration_a", VIBECART_CLOUD_INGEST_KEY: "k".repeat(32) }
 const observed = []
 const db = async (parts, ...values) => {
  const sql = parts.reduce((s, p, i) => s + p + (i < values.length ? "$" + (i + 1) : ""), "")
  observed.push({ sql, values })
  return (await pg.query(sql, values)).rows
 }
 async function load(path, shims = {}) {
  const code = ts.transpileModule(await readFile(path, "utf8"), {
   compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const m = { exports: {} }
  new vm.Script(code).runInNewContext({
   require: name => {
    if (name in shims) return shims[name]
    if (name === "@neondatabase/serverless") return { neon: () => db }
    if (name === "node:crypto") return localRequire(name)
    throw Error("Unexpected dependency: " + name)
   }, exports: m.exports, module: m, process: { env }, Buffer, Request, Response, Headers, URL,
   console: { error() {} },
  })
  return m.exports
 }
 try {
  await pg.exec(await readFile("migrations/005_durable_orders.sql", "utf8"))
  await pg.exec(`INSERT INTO vibecart_orders(id,merchant_id,event_id,checkout_session_id) VALUES
   ('ord_a','merchant_a','evt_a','cs_a'), ('ord_b','merchant_b','evt_b','cs_b');
   INSERT INTO vibecart_order_lines(order_id,line_item_id,product_id,description,quantity,amount_subtotal,amount_total)
   VALUES ('ord_b','line_b','private_b','Synthetic B line',1,1,1);`)
  const orders = await load("lib/order-store.ts")
  const merchant = await load("lib/merchant-auth.ts")
  const integration = await load("lib/cloud-ingest-auth.ts")
  const route = await load("app/api/cloud/ingest/[integrationId]/order/route.ts", {
   "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
   "@/lib/order-store": orders, "@/lib/merchant-auth": merchant, "@/lib/cloud-ingest-auth": integration,
  })
  async function lookup(session, key = env.VIBECART_CLOUD_INGEST_KEY) {
   return route.POST(new Request("https://offline.invalid/api/cloud/ingest/integration_a/order", {
    method: "POST", headers: { "content-type": "application/json", "x-vibecart-key": key },
    body: JSON.stringify({ checkoutSessionId: session }),
   }), { params: Promise.resolve({ integrationId: "integration_a" }) })
  }
  const before = observed.length
  assert.equal((await lookup("cs_b", "invalid")).status, 401)
  assert.equal(observed.length, before)
  const foreign = await lookup("cs_b")
  assert.equal(foreign.status, 404)
  assert.doesNotMatch(await foreign.text(), /merchant_b|private_b|Synthetic B/)
  assert.ok(observed.some(q => q.sql.includes("AND merchant_id = $2") && q.values[1] === "merchant_a"))
  assert.ok(!observed.some(q => q.sql.includes("vibecart_order_lines")))
  const own = await lookup("cs_a")
  assert.equal(own.status, 200)
  assert.equal((await own.json()).order.merchantId, "merchant_a")
  assert.equal((await lookup("cs_missing")).status, 404)
  const guarded = await load("app/api/cloud/ingest/[integrationId]/order/route.ts", {
   "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
   "@/lib/order-store": { getStoredOrderByCheckoutSession: async () => ({ merchantId: "merchant_b" }) },
   "@/lib/merchant-auth": merchant, "@/lib/cloud-ingest-auth": integration,
  })
  const defense = await guarded.POST(new Request("https://offline.invalid", {
   method: "POST", headers: { "x-vibecart-key": env.VIBECART_CLOUD_INGEST_KEY },
   body: JSON.stringify({ checkoutSessionId: "cs_b" }),
  }), { params: Promise.resolve({ integrationId: "integration_a" }) })
  assert.equal(defense.status, 404)
 } finally { await pg.close() }
})
