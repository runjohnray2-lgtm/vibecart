import { neon } from "@neondatabase/serverless"

export interface UptimeMonitor {
  id: number
  accountKey: string
  name: string
  url: string
  method: "GET" | "HEAD"
  expectedStatus: number
  intervalSeconds: number
  timeoutMs: number
  isActive: boolean
  lastCheckedAt: string | null
  lastStatus: number | null
  lastLatencyMs: number | null
  lastError: string | null
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

function accountKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 200) throw new Error("Invalid account key")
  return key
}

function targetUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Monitor URL must use http or https")
  return url.toString()
}

function mapMonitor(row: Record<string, unknown>): UptimeMonitor {
  const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null
  return {
    id: Number(row.id),
    accountKey: String(row.account_key),
    name: String(row.name),
    url: String(row.url),
    method: String(row.method) as "GET" | "HEAD",
    expectedStatus: Number(row.expected_status),
    intervalSeconds: Number(row.interval_seconds),
    timeoutMs: Number(row.timeout_ms),
    isActive: Boolean(row.is_active),
    lastCheckedAt: iso(row.last_checked_at),
    lastStatus: row.last_status == null ? null : Number(row.last_status),
    lastLatencyMs: row.last_latency_ms == null ? null : Number(row.last_latency_ms),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

export async function listUptimeMonitors(owner: string, limit = 100): Promise<UptimeMonitor[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 250)
  const rows = await sql()`
    SELECT * FROM uptime_monitors
    WHERE account_key = ${accountKey(owner)}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `
  return rows.map(row => mapMonitor(row as Record<string, unknown>))
}

export async function createUptimeMonitor(input: {
  accountKey: string
  name: string
  url: string
  method?: string
  expectedStatus?: number
  intervalSeconds?: number
  timeoutMs?: number
}): Promise<UptimeMonitor> {
  const owner = accountKey(input.accountKey)
  const name = input.name.trim().slice(0, 120)
  if (!name) throw new Error("Monitor name is required")
  const url = targetUrl(input.url)
  const method = input.method === "HEAD" ? "HEAD" : "GET"
  const expectedStatus = Math.trunc(input.expectedStatus ?? 200)
  if (expectedStatus < 100 || expectedStatus > 599) throw new Error("Expected status must be 100-599")
  const allowedIntervals = new Set([60, 300, 900, 1800, 3600])
  const intervalSeconds = Math.trunc(input.intervalSeconds ?? 300)
  if (!allowedIntervals.has(intervalSeconds)) throw new Error("Unsupported check interval")
  const timeoutMs = Math.min(Math.max(Math.trunc(input.timeoutMs ?? 10000), 1000), 30000)

  const rows = await sql()`
    INSERT INTO uptime_monitors (account_key, name, url, method, expected_status, interval_seconds, timeout_ms)
    VALUES (${owner}, ${name}, ${url}, ${method}, ${expectedStatus}, ${intervalSeconds}, ${timeoutMs})
    RETURNING *
  `
  return mapMonitor(rows[0] as Record<string, unknown>)
}
