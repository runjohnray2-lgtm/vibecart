import { createHmac, timingSafeEqual } from "node:crypto"

const MERCHANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const MIN_MERCHANT_KEY_LENGTH = 24
const MIN_CART_SECRET_LENGTH = 32

export class MerchantAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MerchantAuthConfigurationError"
  }
}

export function hostedModeEnabled(): boolean {
  return process.env.VIBECART_HOSTED_MODE?.trim().toLowerCase() === "true"
}

export function configuredMerchantId(): string {
  const value = process.env.VIBECART_MERCHANT_ID?.trim() || "default"
  if (!MERCHANT_ID_PATTERN.test(value)) {
    throw new MerchantAuthConfigurationError("VibeCart merchant identity is invalid")
  }
  if (hostedModeEnabled() && value === "default") {
    throw new MerchantAuthConfigurationError("Hosted VibeCart requires an explicit VIBECART_MERCHANT_ID")
  }
  return value
}

function merchantApiKey(): string | null {
  const value = process.env.VIBECART_MERCHANT_API_KEY?.trim()
  if (!hostedModeEnabled()) return value || null
  if (!value || value.length < MIN_MERCHANT_KEY_LENGTH) {
    throw new MerchantAuthConfigurationError(
      `Hosted VibeCart requires VIBECART_MERCHANT_API_KEY with at least ${MIN_MERCHANT_KEY_LENGTH} characters`
    )
  }
  return value
}

function cartSigningSecret(): string | null {
  const value = process.env.VIBECART_CART_ACCESS_SECRET?.trim()
  if (!hostedModeEnabled()) return value || null
  if (!value || value.length < MIN_CART_SECRET_LENGTH) {
    throw new MerchantAuthConfigurationError(
      `Hosted VibeCart requires VIBECART_CART_ACCESS_SECRET with at least ${MIN_CART_SECRET_LENGTH} characters`
    )
  }
  return value
}

export function hostedMerchantAuthConfigured(): boolean {
  if (!hostedModeEnabled()) return true
  try {
    configuredMerchantId()
    merchantApiKey()
    cartSigningSecret()
    return true
  } catch {
    return false
  }
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function merchantRequestAuthorized(req: Request): boolean {
  if (!hostedModeEnabled()) return true
  const expected = merchantApiKey()
  const presented = req.headers.get("x-vibecart-merchant-key")?.trim()
  return Boolean(expected && presented && secureEqual(presented, expected))
}

function cartTokenDigest(cartId: string, merchantId: string): string {
  const secret = cartSigningSecret()
  if (!secret) throw new MerchantAuthConfigurationError("Cart access signing secret is not configured")
  return createHmac("sha256", secret)
    .update(`v1\n${merchantId}\n${cartId}`, "utf8")
    .digest("base64url")
}

export function issueCartAccessToken(cartId: string, merchantId = configuredMerchantId()): string | null {
  if (!hostedModeEnabled()) return null
  return `v1.${cartTokenDigest(cartId, merchantId)}`
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization")?.trim()
  if (!authorization) return null
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1] ?? null
}

export function cartRequestAuthorized(req: Request, cartId: string, merchantId = configuredMerchantId()): boolean {
  if (!hostedModeEnabled()) return true
  if (merchantRequestAuthorized(req)) return true

  const presented = bearerToken(req)
  if (!presented) return false
  const expected = issueCartAccessToken(cartId, merchantId)
  return Boolean(expected && secureEqual(presented, expected))
}
