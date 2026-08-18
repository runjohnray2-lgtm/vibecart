import Stripe from "stripe"

export interface NormalizedOrderLine {
  lineItemId: string
  productId: string
  description: string
  quantity: number
  unitAmount: number | null
  amountSubtotal: number
  amountDiscount: number
  amountTax: number
  amountTotal: number
  currency: string
}

export interface NormalizedOrder {
  checkoutSessionId: string
  cartId: string
  customerEmail: string
  amountSubtotal: number | null
  amountTotal: number | null
  currency: string
  paymentStatus: string
  lines: NormalizedOrderLine[]
}

function stripeProductId(line: Stripe.LineItem): string {
  const product = line.price?.product
  if (!product) return ""
  if (typeof product === "string") return product

  if (!("deleted" in product)) {
    const trustedProductId = product.metadata?.vibecart_catalog_source === "trusted"
      ? product.metadata.vibecart_product_id?.trim()
      : ""
    if (trustedProductId) return trustedProductId
  }

  return product.id
}

async function listAllLineItems(stripe: Stripe, checkoutSessionId: string): Promise<Stripe.LineItem[]> {
  const items: Stripe.LineItem[] = []
  let startingAfter: string | undefined

  while (true) {
    const page = await stripe.checkout.sessions.listLineItems(checkoutSessionId, {
      limit: 100,
      expand: ["data.price.product"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    items.push(...page.data)
    if (!page.has_more) break

    const last = page.data[page.data.length - 1]
    if (!last) throw new Error("Stripe line-item pagination returned has_more without a cursor")
    startingAfter = last.id
  }

  return items
}

export async function buildNormalizedOrder(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<NormalizedOrder> {
  const lineItems = await listAllLineItems(stripe, session.id)
  if (lineItems.length === 0) throw new Error(`Checkout Session ${session.id} has no line items`)

  return {
    checkoutSessionId: session.id,
    cartId: session.client_reference_id ?? session.metadata?.vibecart_cart_id ?? "",
    customerEmail: session.customer_details?.email ?? session.customer_email ?? "",
    amountSubtotal: session.amount_subtotal,
    amountTotal: session.amount_total,
    currency: session.currency ?? lineItems[0]?.currency ?? "",
    paymentStatus: session.payment_status,
    lines: lineItems.map(line => ({
      lineItemId: line.id,
      productId: stripeProductId(line),
      description: line.description ?? "",
      quantity: line.quantity ?? 1,
      unitAmount: line.price?.unit_amount ?? null,
      amountSubtotal: line.amount_subtotal,
      amountDiscount: line.amount_discount,
      amountTax: line.amount_tax,
      amountTotal: line.amount_total,
      currency: line.currency,
    })),
  }
}
