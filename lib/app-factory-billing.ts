import { neon } from "@neondatabase/serverless"

export type AppFactoryAccessStatus = "active" | "paused" | "expired" | "revoked"

function databaseUrl(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("VibeCart app-library storage is not configured")
  return value
}

export async function setAllAppsAccess(accountKey: string, status: AppFactoryAccessStatus, source: string): Promise<void> {
  const key = accountKey.trim()
  if (!key || key.length > 200) throw new Error("Invalid account key")
  const sql = neon(databaseUrl())
  await sql`
    INSERT INTO app_entitlements (account_key, app_key, status, source, starts_at, ends_at, metadata)
    VALUES (${key}, 'all-apps', ${status}, ${source}, NOW(), NULL, '{}'::jsonb)
    ON CONFLICT (account_key, app_key)
    DO UPDATE SET status = EXCLUDED.status, source = EXCLUDED.source, starts_at = NOW(), ends_at = NULL, updated_at = NOW()
  `
}

export function subscriptionStatusToAccess(status: string): AppFactoryAccessStatus {
  if (status === "active" || status === "trialing") return "active"
  if (status === "canceled" || status === "incomplete_expired") return "expired"
  return "paused"
}
