import { mkdir, readFile, writeFile } from "node:fs/promises"
import { Buffer } from "node:buffer"
import ts from "typescript"

const source = await readFile("lib/ucp-order.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "lib/ucp-order.ts",
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
const { mapDurableOrderToUcp, UCP_ORDER_CAPABILITY, UCP_ORDER_VERSION } = await import(moduleUrl)

const checkoutSessionId = "cs_test_ucp_order"
const payload = mapDurableOrderToUcp(
  {
    id: checkoutSessionId,
    orderId: checkoutSessionId,
    eventId: "evt_test_ucp_order",
    checkoutSessionId,
    cartId: "cart_test_ucp_order",
    customerEmail: "buyer@example.com",
    amountSubtotal: 1000,
    amountTotal: 990,
    currency: "usd",
    paymentStatus: "paid",
    status: "paid",
    lines: [
      {
        lineItemId: "li_test_ucp_order",
        productId: "merchant-sku-123",
        description: "VibeCart schema test product",
        quantity: 1,
        unitAmount: 1000,
        amountSubtotal: 1000,
        amountDiscount: 100,
        amountTax: 90,
        amountTotal: 990,
        currency: "usd",
      },
    ],
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  },
  `https://merchant.example/orders/${checkoutSessionId}`
)

function errorPayload(code, content, severity) {
  return {
    ucp: {
      version: UCP_ORDER_VERSION,
      status: "error",
      capabilities: { [UCP_ORDER_CAPABILITY]: [{ version: UCP_ORDER_VERSION }] },
    },
    messages: [{ type: "error", code, severity, content }],
  }
}

const notFound = errorPayload("not_found", "Order not found.", "unrecoverable")
const unauthorized = errorPayload("unauthorized", "Not authorized to access this order.", "unrecoverable")
const unavailable = errorPayload("service_unavailable", "Order service is temporarily unavailable.", "recoverable")

await mkdir("/tmp/vibecart-ucp-payloads", { recursive: true })
await Promise.all([
  writeFile("/tmp/vibecart-ucp-payloads/order.json", `${JSON.stringify(payload, null, 2)}\n`),
  writeFile("/tmp/vibecart-ucp-payloads/order-not-found.json", `${JSON.stringify(notFound, null, 2)}\n`),
  writeFile("/tmp/vibecart-ucp-payloads/order-unauthorized.json", `${JSON.stringify(unauthorized, null, 2)}\n`),
  writeFile("/tmp/vibecart-ucp-payloads/order-unavailable.json", `${JSON.stringify(unavailable, null, 2)}\n`),
])
console.log("Generated UCP order success/error payloads through released contract metadata")
