import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const DEFAULT_REGISTRY_BASE = "https://vibecart-cloud-uupzkh.v2.appdeploy.ai/api/merchants/"
const REGISTRY_TIMEOUT_MS = 3_000
const MAX_PROFILE_BYTES = 64 * 1024
const MERCHANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/

export interface NetworkMerchant {
  slug: string
  displayName: string
  description: string
  websiteUrl: string
  catalogUrl: string
  published: true
  network: "vibecart"
  updatedAt: string
}

export class MerchantNetworkError extends Error {
  constructor(message: string, public readonly code = "MERCHANT_NETWORK_UNAVAILABLE") {
    super(message)
    this.name = "MerchantNetworkError"
  }
}

export function validMerchantSlug(value: string): boolean {
  return MERCHANT_SLUG_PATTERN.test(value)
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isPrivateIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) {
    const value = address.toLowerCase()
    if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") ||
      value.startsWith("feb") || value.startsWith("ff") || value.startsWith("2001:db8:")) return true
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateIpv4(mapped[1]) : false
  }
  return true
}

async function registryBase(): Promise<URL> {
  const raw = process.env.VIBECART_MERCHANT_REGISTRY_URL?.trim() || DEFAULT_REGISTRY_BASE
  let url: URL
  try {
    url = new URL(raw.endsWith("/") ? raw : `${raw}/`)
  } catch {
    throw new MerchantNetworkError("Merchant registry URL is invalid", "MERCHANT_NETWORK_CONFIG_INVALID")
  }

  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    (url.port && url.port !== "443") || isIP(url.hostname) !== 0 ||
    url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new MerchantNetworkError("Merchant registry must be a public HTTPS origin", "MERCHANT_NETWORK_CONFIG_INVALID")
  }

  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new MerchantNetworkError("Merchant registry host could not be resolved")
  }
  if (addresses.length === 0 || addresses.some(entry => isPrivateIp(entry.address))) {
    throw new MerchantNetworkError("Merchant registry host resolves to a private address", "MERCHANT_NETWORK_CONFIG_INVALID")
  }

  return url
}

function nonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new MerchantNetworkError(`Merchant profile ${field} is invalid`, "MERCHANT_PROFILE_INVALID")
  const text = value.trim()
  if (!text || text.length > max) throw new MerchantNetworkError(`Merchant profile ${field} is invalid`, "MERCHANT_PROFILE_INVALID")
  return text
}

function httpsUrl(value: unknown, field: string): string {
  const raw = nonEmptyString(value, field, 2_000)
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("invalid")
    return url.toString()
  } catch {
    throw new MerchantNetworkError(`Merchant profile ${field} is invalid`, "MERCHANT_PROFILE_INVALID")
  }
}

function parseMerchant(value: unknown, expectedSlug: string): NetworkMerchant {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MerchantNetworkError("Merchant registry returned an invalid profile", "MERCHANT_PROFILE_INVALID")
  }
  const row = value as Record<string, unknown>
  const slug = nonEmptyString(row.slug, "slug", 50).toLowerCase()
  if (slug !== expectedSlug || !validMerchantSlug(slug) || row.published !== true || row.network !== "vibecart") {
    throw new MerchantNetworkError("Merchant registry returned an invalid profile", "MERCHANT_PROFILE_INVALID")
  }
  const catalogUrl = row.catalogUrl === "" ? "" : httpsUrl(row.catalogUrl, "catalogUrl")
  return {
    slug,
    displayName: nonEmptyString(row.displayName, "displayName", 120),
    description: typeof row.description === "string" ? row.description.slice(0, 1_000) : "",
    websiteUrl: httpsUrl(row.websiteUrl, "websiteUrl"),
    catalogUrl,
    published: true,
    network: "vibecart",
    updatedAt: nonEmptyString(row.updatedAt, "updatedAt", 64),
  }
}

export async function getNetworkMerchant(rawSlug: string): Promise<NetworkMerchant | null> {
  const slug = rawSlug.trim().toLowerCase()
  if (!validMerchantSlug(slug)) return null

  const base = await registryBase()
  const url = new URL(encodeURIComponent(slug), base)
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
  } catch {
    throw new MerchantNetworkError("Merchant network could not be reached")
  }

  if (response.status === 404) return null
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new MerchantNetworkError(`Merchant network returned HTTP ${response.status}`)
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROFILE_BYTES) {
    throw new MerchantNetworkError("Merchant profile response is too large", "MERCHANT_PROFILE_INVALID")
  }

  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > MAX_PROFILE_BYTES) {
    throw new MerchantNetworkError("Merchant profile response is too large", "MERCHANT_PROFILE_INVALID")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new MerchantNetworkError("Merchant registry returned invalid JSON", "MERCHANT_PROFILE_INVALID")
  }
  const body = parsed as { merchant?: unknown }
  return parseMerchant(body.merchant, slug)
}
