import { mkdir, readFile, writeFile } from "node:fs/promises"
import { Buffer } from "node:buffer"
import ts from "typescript"

const source = await readFile("lib/ucp-cart.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "lib/ucp-cart.ts",
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
const { mapDurableCartToUcp } = await import(moduleUrl)

const payload = mapDurableCartToUcp({
  id: "cart_schema_test",
  merchantId: "default",
  status: "active",
  currency: "usd",
  items: [
    {
      productId: "merchant-sku-123",
      name: "VibeCart schema test product",
      description: "Released UCP cart schema test",
      image: "https://example.com/product.png",
      quantity: 2,
      unitPriceCents: 500,
      lineTotalCents: 1000,
    },
  ],
  subtotalCents: 1000,
  version: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
})

await mkdir("/tmp/vibecart-ucp-payloads", { recursive: true })
await writeFile("/tmp/vibecart-ucp-payloads/cart.json", `${JSON.stringify(payload, null, 2)}\n`)
console.log("Generated UCP cart payload through the production cart mapper")
