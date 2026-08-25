import { neon } from "@neondatabase/serverless"

export type EntitlementStatus = "active" | "trial" | "paused" | "expired" | "revoked"

export interface AppEntitlement {
  accountKey: string
  appKey: string
  status: EntitlementStatus
  startsAt: string
  endsAt: string | null
}

export interface ShortLink {
  id: number
  accountKey: string
  slug: string
  destinationUrl: string
  title: string | null
  isActive: boolean
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("VibeCart app-library storage is not configured")
  return value
}

function sql() {
  return neon(databaseUrl())
}

function validAccountKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 200) throw new Error("Invalid account key")
  return key
}

function validAppKey(value: string): string {
  const key = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) throw new Error("Invalid app key")
  return key
}

function validSlug(value: string): string {
  const slug = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(slug)) throw new Error("Invalid short-link slug")
  return slug
}

function validDestinationUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Destination must use http or https")
  return url.toString()
}

function iso(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export async function hasAppAccess(accountKey: string, appKey: string): Promise<boolean> {
  const rows = await sql()`
    SELECT status, starts_at, ends_at
    FROM app_entitlements
    WHERE account_key = ${validAccountKey(accountKey)}
      AND app_key = ${validAppKey(appKey)}
    LIMIT 1
  `
  const row = rows[0] as { status?: EntitlementStatus; starts_at?: string | Date; ends_at?: string | Date | null } | undefined
  if (!row || (row.status !== "active" && row.status !== "trial")) return false
  const now = Date.now()
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return false
  return true
}

export async function listShortLinks(accountKey: string, limit = 100): Promise<ShortLink[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 250)
  const rows = await sql()`
    SELECT id, account_key, slug, destination_url, title, is_active, expires_at, created_at, updated_at
    FROM short_links
    WHERE account_key = ${validAccountKey(accountKey)}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `
  return rows.map(row => ({
    id: Number(row.id),
    accountKey: String(row.account_key),
    slug: String(row.slug),
    destinationUrl: String(row.destination_url),
    title: row.title ? String(row.title) : null,
    isActive: Boolean(row.is_active),
    expiresAt: iso(row.expires_at as string | Date | null),
    createdAt: iso(row.created_at as string | Date)!,
    updatedAt: iso(row.updated_at as string | Date)!,
  }))
}

export async function createShortLink(input: {
  accountKey: string
  slug: string
  destinationUrl: string
  title?: string
}): Promise<ShortLink> {
  const accountKey = validAccountKey(input.accountKey)
  const slug = validSlug(input.slug)
  const destinationUrl = validDestinationUrl(input.destinationUrl)
  const title = input.title?.trim().slice(0, 200) || null
  const rows = await sql()`
    INSERT INTO short_links (account_key, slug, destination_url, title)
    VALUES (${accountKey}, ${slug}, ${destinationUrl}, ${title})
    RETURNING id, account_key, slug, destination_url, title, is_active, expires_at, created_at, updated_at
  `
  const row = rows[0]
  return {
    id: Number(row.id), accountKey: String(row.account_key), slug: String(row.slug),
    destinationUrl: String(row.destination_url), title: row.title ? String(row.title) : null,
    isActive: Boolean(row.is_active), expiresAt: iso(row.expires_at as string | Date | null),
    createdAt: iso(row.created_at as string | Date)!, updatedAt: iso(row.updated_at as string | Date)!,
  }
}

export async function resolveShortLink(slugValue: string): Promise<{ id: number; destinationUrl: string } | null> {
  const slug = validSlug(slugValue)
  const rows = await sql()`
    SELECT id, destination_url
    FROM short_links
    WHERE slug = ${slug}
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `
  const row = rows[0]
  return row ? { id: Number(row.id), destinationUrl: String(row.destination_url) } : null
}
