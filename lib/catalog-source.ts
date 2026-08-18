import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { PRODUCTS, type VibeProduct } from "@/lib/products"

const MAX_CATALOG_BYTES = 5 * 1024 * 1024
const MAX_PRODUCTS = 10_000
const CATALOG_TIMEOUT_MS = 4_000
const CACHE_TTL_MS = 30_000

export class CatalogSourceError extends Error {
  constructor(message: string, public readonly code = "CATALOG_UNAVAILABLE") {
    super(message)
    this.name = "CatalogSourceError"
  }
}

type CacheEntry = {
  url: string
  expiresAt: number
  products: VibeProduct[]
}

let cache: CacheEntry | null = null

export function catalogSourceMode(): "reference" | "remote" {
  return process.env.VIBECART_CATALOG_URL?.trim() ? "remote" : "reference"
}

export function configuredMerchantName(): string {
  return process.env.VIBECART_MERCHANT_NAME?.trim() || "VibeCart Demo Merchant"
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function isPrivateIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) {
    const value = address.toLowerCase()
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") ||
      value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")
  }
  return true
}

async function validatedCatalogUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CatalogSourceError("VIBECART_CATALOG_URL is invalid", "CATALOG_CONFIG_INVALID")
  }

  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new CatalogSourceError("VIBECART_CATALOG_URL must be a public HTTPS URL", "CATALOG_CONFIG_INVALID")
  }

  if (isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) {
      throw new CatalogSourceError("VIBECART_CATALOG_URL cannot target a private address", "CATALOG_CONFIG_INVALID")
    }
  } else {
    let addresses: { address: string; family: number }[]
    try {
      addresses = await lookup(url.hostname, { all: true, verbatim: true })
    } catch {
      throw new CatalogSourceError("Merchant catalog host could not be resolved")
    }
    if (addresses.length === 0 || addresses.some(entry => isPrivateIp(entry.address))) {
      throw new CatalogSourceError("Merchant catalog host resolves to a private address", "CATALOG_CONFIG_INVALID")
    }
  }

  return url
}

function nonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new CatalogSourceError(`Catalog product ${field} must be a string`, "CATALOG_INVALID")
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new CatalogSourceError(`Catalog product ${field} must be 1-${maxLength} characters`, "CATALOG_INVALID")
  }
  return normalized
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  return nonEmptyString(value, field, maxLength)
}

function imageUrl(value: unknown): string {
  if (value === undefined || value === null || value === "") return ""
  const raw = nonEmptyString(value, "image", 2_000)
  let url: URL
  try { url = new URL(raw) } catch { throw new CatalogSourceError("Catalog product image must be an absolute HTTPS URL", "CATALOG_INVALID") }
  if (url.protocol !== "https:") throw new CatalogSourceError("Catalog product image must use HTTPS", "CATALOG_INVALID")
  return url.toString()
}

function parseProduct(value: unknown): VibeProduct {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogSourceError("Each catalog product must be an object", "CATALOG_INVALID")
  }
  const item = value as Record<string, unknown>
  if (!Number.isSafeInteger(item.priceCents) || (item.priceCents as number) < 0) {
    throw new CatalogSourceError("Catalog product priceCents must be a non-negative integer", "CATALOG_INVALID")
  }
  return {
    id: nonEmptyString(item.id, "id", 200),
    name: nonEmptyString(item.name, "name", 500),
    description: typeof item.description === "string" ? item.description.slice(0, 5_000) : "",
    priceCents: item.priceCents as number,
    image: imageUrl(item.image),
    variant: optionalString(item.variant, "variant", 500),
  }
}

function parseCatalogDocument(value: unknown): VibeProduct[] {
  const rawProducts = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).products)
      ? (value as Record<string, unknown>).products as unknown[]
      : null

  if (!rawProducts) throw new CatalogSourceError("Catalog response must be an array or { products: [...] }", "CATALOG_INVALID")
  if (rawProducts.length > MAX_PRODUCTS) throw new CatalogSourceError(`Catalog cannot exceed ${MAX_PRODUCTS} products`, "CATALOG_INVALID")

  const products = rawProducts.map(parseProduct)
  const seen = new Set<string>()
  for (const product of products) {
    if (seen.has(product.id)) throw new CatalogSourceError(`Duplicate catalog product id: ${product.id}`, "CATALOG_INVALID")
    seen.add(product.id)
  }
  return products
}

async function fetchRemoteCatalog(rawUrl: string): Promise<VibeProduct[]> {
  const url = await validatedCatalogUrl(rawUrl)
  const headers: Record<string, string> = { accept: "application/json" }
  const bearer = process.env.VIBECART_CATALOG_BEARER_TOKEN?.trim()
  if (bearer) headers.authorization = `Bearer ${bearer}`

  let response: Response
  try {
    response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch {
    throw new CatalogSourceError("Merchant catalog could not be reached")
  }

  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new CatalogSourceError(`Merchant catalog returned HTTP ${response.status}`)
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
    throw new CatalogSourceError("Merchant catalog response is too large", "CATALOG_INVALID")
  }

  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > MAX_CATALOG_BYTES) {
    throw new CatalogSourceError("Merchant catalog response is too large", "CATALOG_INVALID")
  }

  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new CatalogSourceError("Merchant catalog returned invalid JSON", "CATALOG_INVALID") }
  return parseCatalogDocument(parsed)
}

export async function listCatalogProducts(): Promise<VibeProduct[]> {
  const rawUrl = process.env.VIBECART_CATALOG_URL?.trim()
  if (!rawUrl) return PRODUCTS

  if (cache && cache.url === rawUrl && cache.expiresAt > Date.now()) return cache.products

  const products = await fetchRemoteCatalog(rawUrl)
  cache = { url: rawUrl, products, expiresAt: Date.now() + CACHE_TTL_MS }
  return products
}

export async function getCatalogProduct(id: string): Promise<VibeProduct | null> {
  const products = await listCatalogProducts()
  return products.find(product => product.id === id) ?? null
}
