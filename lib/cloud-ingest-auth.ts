import { timingSafeEqual } from "node:crypto"

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function cloudIntegrationAuthorized(req: Request, integrationId: string): boolean {
  const expectedIntegrationId = process.env.HSN_CLOUD_INTEGRATION_ID?.trim() || "he-said-nothing"
  const expectedKey = process.env.VIBECART_CLOUD_INGEST_KEY?.trim() ?? ""
  const presentedKey = req.headers.get("x-vibecart-key")?.trim() ?? ""
  return integrationId === expectedIntegrationId
    && expectedKey.length >= 32
    && secureEqual(presentedKey, expectedKey)
}
