const ORDER_ID_TOKEN = "{orderId}"
const MAX_TEMPLATE_LENGTH = 2_000

function validTemplate(raw: string | undefined): string | null {
  const template = raw?.trim() ?? ""
  if (!template || template.length > MAX_TEMPLATE_LENGTH) return null
  if (template.split(ORDER_ID_TOKEN).length !== 2) return null

  const withoutToken = template.replace(ORDER_ID_TOKEN, "ORDER_ID_SENTINEL")
  if (withoutToken.includes("{") || withoutToken.includes("}")) return null

  try {
    const url = new URL(withoutToken)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null
    return template
  } catch {
    return null
  }
}

export function orderPermalinkConfigured(): boolean {
  return validTemplate(process.env.VIBECART_ORDER_PERMALINK_TEMPLATE) !== null
}

export function merchantOrderPermalink(orderIdRaw: string): string | null {
  const template = validTemplate(process.env.VIBECART_ORDER_PERMALINK_TEMPLATE)
  if (!template) return null

  const orderId = orderIdRaw.trim()
  if (!orderId || orderId.length > 200) return null

  const value = template.replace(ORDER_ID_TOKEN, encodeURIComponent(orderId))
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}
