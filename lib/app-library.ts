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
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  isActive: boolean
  expiresAt: string | null
  clickCount: number
  lastClickedAt: string | null
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

function optionalText(value: string | undefined, max = 200): string | null {
  const text = value?.trim()
  if (!text) return null
  return text.slice(0, max)
}

function iso(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapShortLink(row: Record<string, unknown>): ShortLink {
  return {
    id: Number(row.id),
    accountKey: String(row.account_key),
    slug: String(row.slug),
    destinationUrl: String(row.destination_url),
    title: row.title ? String(row.title) : null,
    utmSource: row.utm_source ? String(row.utm_source) : null,
    utmMedium: row.utm_medium ? String(row.utm_medium) : null,
    utmCampaign: row.utm_campaign ? String(row.utm_campaign) : null,
    utmTerm: row.utm_term ? String(row.utm_term) : null,
    utmContent: row.utm_content ? String(row.utm_content) : null,
    isActive: Boolean(row.is_active),
    expiresAt: iso(row.expires_at as string | Date | null),
    clickCount: Number(row.click_count ?? 0),
    lastClickedAt: iso(row.last_clicked_at as string | Date | null),
    createdAt: iso(row.created_at as string | Date)!,
    updatedAt: iso(row.updated_at as string | Date)!,
  }
}

export async function ensureInitialAppTrial(accountKey: string, appKey: string, days = 7): Promise<void> {
  const safeDays = Math.min(Math.max(Math.trunc(days), 1), 30)
  await sql()`
    INSERT INTO app_entitlements (account_key, app_key, status, source, starts_at, ends_at, metadata)
    VALUES (
      ${validAccountKey(accountKey)},
      ${validAppKey(appKey)},
      'trial',
      'app-factory-first-use',
      NOW(),
      NOW() + (${safeDays}::text || ' days')::interval,
      ${JSON.stringify({ trialDays: safeDays })}::jsonb
    )
    ON CONFLICT (account_key, app_key) DO NOTHING
  `
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
    SELECT
      l.id, l.account_key, l.slug, l.destination_url, l.title,
      l.utm_source, l.utm_medium, l.utm_campaign, l.utm_term, l.utm_content,
      l.is_active, l.expires_at, l.created_at, l.updated_at,
      COUNT(e.id)::int AS click_count,
      MAX(e.occurred_at) AS last_clicked_at
    FROM short_links l
    LEFT JOIN short_link_events e ON e.short_link_id = l.id
    WHERE l.account_key = ${validAccountKey(accountKey)}
    GROUP BY l.id
    ORDER BY l.created_at DESC
    LIMIT ${safeLimit}
  `
  return rows.map(row => mapShortLink(row as Record<string, unknown>))
}

export async function createShortLink(input: {
  accountKey: string
  slug: string
  destinationUrl: string
  title?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
}): Promise<ShortLink> {
  const accountKey = validAccountKey(input.accountKey)
  const slug = validSlug(input.slug)
  const destinationUrl = validDestinationUrl(input.destinationUrl)
  const title = optionalText(input.title)
  const utmSource = optionalText(input.utmSource)
  const utmMedium = optionalText(input.utmMedium)
  const utmCampaign = optionalText(input.utmCampaign)
  const utmTerm = optionalText(input.utmTerm)
  const utmContent = optionalText(input.utmContent)

  const rows = await sql()`
    INSERT INTO short_links (
      account_key, slug, destination_url, title,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content
    )
    VALUES (
      ${accountKey}, ${slug}, ${destinationUrl}, ${title},
      ${utmSource}, ${utmMedium}, ${utmCampaign}, ${utmTerm}, ${utmContent}
    )
    RETURNING
      id, account_key, slug, destination_url, title,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      is_active, expires_at, created_at, updated_at,
      0::int AS click_count,
      NULL::timestamptz AS last_clicked_at
  `
  return mapShortLink(rows[0] as Record<string, unknown>)
}

export async function resolveShortLink(slugValue: string): Promise<{ id: number; destinationUrl: string } | null> {
  const slug = validSlug(slugValue)
  const rows = await sql()`
    SELECT id, destination_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content
    FROM short_links
    WHERE slug = ${slug}
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null

  const destination = new URL(String(row.destination_url))
  const campaign = {
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_term: row.utm_term,
    utm_content: row.utm_content,
  }
  for (const [key, value] of Object.entries(campaign)) {
    if (value) destination.searchParams.set(key, String(value))
  }

  return { id: Number(row.id), destinationUrl: destination.toString() }
}

export async function recordShortLinkEvent(input: {
  shortLinkId: number
  referrer?: string | null
  userAgent?: string | null
  countryCode?: string | null
  deviceType?: string | null
}): Promise<void> {
  const referrer = optionalText(input.referrer ?? undefined, 1000)
  const userAgent = optionalText(input.userAgent ?? undefined, 1000)
  const countryCode = optionalText(input.countryCode ?? undefined, 8)
  const deviceType = optionalText(input.deviceType ?? undefined, 32)
  await sql()`
    INSERT INTO short_link_events (short_link_id, referrer, user_agent, country_code, device_type)
    VALUES (${Math.trunc(input.shortLinkId)}, ${referrer}, ${userAgent}, ${countryCode}, ${deviceType})
  `
}
