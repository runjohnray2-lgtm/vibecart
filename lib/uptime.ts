import { neon } from "@neondatabase/serverless"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

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

export interface UptimeCheckResult {
  monitorId: number
  ok: boolean
  statusCode: number | null
  latencyMs: number
  error: string | null
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
  if (url.username || url.password) throw new Error("Monitor URL cannot contain credentials")
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

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase()
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return true
}

async function assertPublicTarget(value: string): Promise<URL> {
  const url = new URL(targetUrl(value))
  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Private network targets are not allowed")
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Private network targets are not allowed")
    return url
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error("Private network targets are not allowed")
  }
  return url
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

export async function listDueUptimeMonitors(limit = 25): Promise<UptimeMonitor[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
  const rows = await sql()`
    SELECT * FROM uptime_monitors
    WHERE is_active = TRUE
      AND (last_checked_at IS NULL OR last_checked_at <= NOW() - (interval_seconds * INTERVAL '1 second'))
    ORDER BY last_checked_at NULLS FIRST, id
    LIMIT ${safeLimit}
  `
  return rows.map(row => mapMonitor(row as Record<string, unknown>))
}

async function persistCheckResult(result: UptimeCheckResult): Promise<void> {
  const error = result.error?.slice(0, 500) ?? null
  await sql().transaction([
    sql()`
      INSERT INTO uptime_check_events (monitor_id, status_code, latency_ms, ok, error)
      VALUES (${result.monitorId}, ${result.statusCode}, ${result.latencyMs}, ${result.ok}, ${error})
    `,
    sql()`
      UPDATE uptime_monitors
      SET last_checked_at = NOW(),
          last_status = ${result.statusCode},
          last_latency_ms = ${result.latencyMs},
          last_error = ${error},
          updated_at = NOW()
      WHERE id = ${result.monitorId}
    `,
  ])
}

export async function executeUptimeCheck(monitor: UptimeMonitor): Promise<UptimeCheckResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), monitor.timeoutMs)

  try {
    let current = await assertPublicTarget(monitor.url)
    let response: Response | null = null

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetch(current, {
        method: monitor.method,
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { "user-agent": "VibeCart-Uptime/1.0" },
      })

      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get("location")
      if (!location) break
      if (redirectCount === 3) throw new Error("Too many redirects")
      current = await assertPublicTarget(new URL(location, current).toString())
    }

    const statusCode = response?.status ?? null
    const result: UptimeCheckResult = {
      monitorId: monitor.id,
      ok: statusCode === monitor.expectedStatus,
      statusCode,
      latencyMs: Date.now() - started,
      error: statusCode === monitor.expectedStatus ? null : `Expected ${monitor.expectedStatus}, received ${statusCode ?? "no status"}`,
    }
    await persistCheckResult(result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : "Uptime check failed"
    const result: UptimeCheckResult = {
      monitorId: monitor.id,
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      error: message,
    }
    await persistCheckResult(result)
    return result
  } finally {
    clearTimeout(timer)
  }
}

export async function runDueUptimeChecks(limit = 25): Promise<UptimeCheckResult[]> {
  const monitors = await listDueUptimeMonitors(limit)
  const results: UptimeCheckResult[] = []
  for (const monitor of monitors) {
    results.push(await executeUptimeCheck(monitor))
  }
  return results
}
