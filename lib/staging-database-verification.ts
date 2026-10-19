import { neon } from "@neondatabase/serverless"
import { merchantRequestAuthorized } from "@/lib/merchant-auth"

// Temporary owner-requested verification. No commerce gate or state is changed.
const HOST = "ep-blue-hill-b46430js-pooler.c-6.us-east-2.aws.neon.tech"
const ROLE = "vibecart_pilot_runtime"
const EXPIRES_AT = "2026-10-21T23:43:28.900Z"
const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow, noarchive" }

export const STAGING_IDENTITY_QUERIES = [
  `SELECT current_database() AS database, current_user AS role, session_user,
    inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
    current_setting('transaction_read_only') AS transaction_read_only,
    current_setting('neon.endpoint_id', true) AS neon_endpoint_id`,
  `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
    FROM pg_roles WHERE rolname=current_user`,
  `SELECT rolname AS member_of, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname<>current_user AND pg_has_role(current_user,oid,'MEMBER')`,
  `SELECT has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
    has_database_privilege(current_user,current_database(),'TEMP') AS database_temp,
    has_schema_privilege(current_user,'public','USAGE') AS public_usage,
    has_schema_privilege(current_user,'public','CREATE') AS public_create`,
  `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
    has_table_privilege(current_user,c.oid,'TRUNCATE') AS can_truncate,
    has_table_privilege(current_user,c.oid,'TRIGGER') AS can_trigger
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
  `SELECT schemaname,tablename,policyname,roles,cmd FROM pg_policies WHERE schemaname='public'`,
  `SELECT n.nspname,p.proname,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS executable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef`,
]

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: HEADERS })
}

export async function verifyStagingDatabase(req: Request) {
  // Fail before touching a credential or database outside this exact locked pilot.
  if (process.env.VERCEL_ENV !== "preview" || process.env.VIBECART_STAGING_ISOLATION_VERIFIED !== "false"
    || process.env.VIBECART_HOSTED_MODE !== "true" || process.env.VIBECART_MERCHANT_ID !== "radiantz-staging"
    || Date.now() >= Date.parse(EXPIRES_AT)) return reply({ error: "Not found" }, 404)
  try {
    if (!merchantRequestAuthorized(req)) return reply({ error: "Unauthorized" }, 401)
    const raw = process.env.DATABASE_URL ?? ""
    const target = new URL(raw)
    if (target.hostname !== HOST || decodeURIComponent(target.username) !== ROLE
      || (target.searchParams.has("sslmode") && !["require", "verify-ca", "verify-full"].includes(target.searchParams.get("sslmode")!))
      || (target.searchParams.has("channel_binding") && target.searchParams.get("channel_binding") !== "require")
      || [...target.searchParams.keys()].some(key => !["sslmode", "channel_binding"].includes(key))
      || !target.password || target.pathname !== "/neondb" || target.port
      || !["postgres:", "postgresql:"].includes(target.protocol)
      || process.env.VIBECART_STAGING_DATABASE_HOST !== HOST
      || (process.env.POSTGRES_URL && process.env.POSTGRES_URL !== raw)) {
      return reply({ error: "Temporary database target mismatch; no connection attempted" }, 503)
    }
    const sql = neon(raw)
    const results = await sql.transaction(STAGING_IDENTITY_QUERIES.map(query => sql.query(query)), {
      readOnly: true, isolationLevel: "RepeatableRead",
      fetchOptions: { signal: AbortSignal.timeout(10_000) },
    })
    const [identity, role, memberships, namespacePrivileges, tables, policies, securityDefiners] = results
    if (identity[0]?.role !== ROLE || identity[0]?.database !== "neondb"
      || identity[0]?.transaction_read_only !== "on") return reply({ error: "Read-only identity assertion failed" }, 503)
    return reply({
      scope: "temporary-preview-read-only", verifiedAt: new Date().toISOString(),
      deployment: { environment: process.env.VERCEL_ENV, commit: process.env.VERCEL_GIT_COMMIT_SHA,
        branch: process.env.VERCEL_GIT_COMMIT_REF, hostname: process.env.VERCEL_URL },
      isolationLock: false, merchantId: "radiantz-staging", connectionHost: target.hostname,
      identity: identity[0], role: role[0], memberships, namespacePrivileges: namespacePrivileges[0],
      tables, policies, securityDefiners,
    })
  } catch {
    // Driver errors may contain credentials. Never return or log the original error.
    return reply({ error: "Read-only staging verification unavailable" }, 503)
  }
}

// This form is served only on the already Vercel-protected Preview. It contains
// no credential or database data; authentication precedes every SQL connection.
export function stagingVerificationForm() {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VIBECART_STAGING_ISOLATION_VERIFIED !== "false"
    || process.env.VIBECART_HOSTED_MODE !== "true" || process.env.VIBECART_MERCHANT_ID !== "radiantz-staging"
    || Date.now() >= Date.parse(EXPIRES_AT)) return reply({ error: "Not found" }, 404)
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Read-only staging verification</title>
    <h1>Read-only staging verification</h1><p>Temporary Radiantz Preview only. Commerce remains locked.</p>
    <form method="post" action="/api/health?staging-database=verify" autocomplete="off">
      <label>Staging merchant key <input type="password" name="merchantKey" maxlength="128" autocomplete="off" required></label>
      <button type="submit">Verify database (read only)</button>
    </form></html>`, { headers: { ...HEADERS, "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "same-origin", "x-frame-options": "DENY" } })
}

export async function submitStagingVerification(req: Request) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VIBECART_STAGING_ISOLATION_VERIFIED !== "false") {
    return reply({ error: "Not found" }, 404)
  }
  // Same-origin POST keeps the key out of URLs, history and referrer headers.
  const deploymentHost = process.env.VERCEL_URL
  if (!deploymentHost || !/^[a-z0-9-]+\.vercel\.app$/.test(deploymentHost)
    || req.headers.get("origin") !== `https://${deploymentHost}`) return reply({ error: "Forbidden" }, 403)
  if (req.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") {
    return reply({ error: "Unsupported content type" }, 415)
  }
  try {
    const reader = req.body?.getReader()
    if (!reader) return reply({ error: "Invalid request" }, 400)
    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 2048) { await reader.cancel(); return reply({ error: "Invalid request" }, 413) }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const key = new URLSearchParams(new TextDecoder().decode(bytes)).get("merchantKey") ?? ""
    if (!key || key.length > 128) return reply({ error: "Unauthorized" }, 401)
    return verifyStagingDatabase(new Request(req.url, { headers: { "x-vibecart-merchant-key": key } }))
  } catch { return reply({ error: "Read-only staging verification unavailable" }, 503) }
}
