import { neon } from "@neondatabase/serverless"

type Row = Record<string, unknown>

function database() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) throw new Error("Business Brain storage is not configured")
  return neon(url)
}

function safeText(value: unknown) {
  return String(value ?? "").trim()
}

/**
 * Read the actual tenant-scoped Business Brain records.
 * This deliberately does NOT claim live Gmail, Shopify, Sage or Quo access:
 * ChatGPT's connected apps are not automatically connected to this web app.
 */
export async function startMyDay(accountValue: string, businessName = "SeekPwr Co.") {
  const accountKey = safeText(accountValue)
  const name = safeText(businessName)
  if (!accountKey || accountKey.length > 200) throw new Error("Sign in required")
  if (!name || name.length > 200) throw new Error("Invalid business name")

  const sql = database()
  const businesses = await sql.query(
    "SELECT id::text,name FROM businesses WHERE account_key=$1 AND name=$2 LIMIT 1",
    [accountKey, name],
  )
  const business = businesses[0] as Row | undefined
  const generatedAt = new Date().toISOString()
  const missingSources = [
    { name: "Gmail", status: "NOT_CONNECTED", detail: "Live email threads are not connected to this VibeCart app. Do not assume emails were read." },
    { name: "Shopify", status: "NOT_CONNECTED", detail: "Live SeekPwr orders are not connected to this VibeCart app. Do not assume orders were checked." },
    { name: "Quo", status: "NOT_CONNECTED", detail: "Live calls and voicemails are not connected to this VibeCart app." },
    { name: "Sage, ShipStation and Amazon", status: "NOT_CONNECTED", detail: "These operating records are not synchronized to this workspace." },
  ]

  if (!business) {
    return {
      generatedAt,
      workspace: null,
      customerCount: 0,
      activeRules: [],
      recentMemories: [],
      latestImports: [],
      openActions: [],
      recentActions: [],
      sourceChecks: [{ name: "Business Brain storage", status: "NO_WORKSPACE", detail: "Create your SeekPwr workspace first." }, ...missingSources],
      audit: { status: "NOT_RECORDED", reason: "Workspace does not exist" },
    }
  }

  const id = safeText(business.id)
  const [customerCounts, rules, memories, imports, actions] = await Promise.all([
    sql.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE email IS NULL OR email='')::int AS without_email FROM business_customers WHERE business_id=$1::uuid", [id]),
    sql.query("SELECT id::text,rule_text,source,effective_from FROM business_rules WHERE business_id=$1::uuid AND is_active=true AND (effective_until IS NULL OR effective_until>NOW()) ORDER BY effective_from DESC LIMIT 12", [id]),
    sql.query("SELECT id::text,memory_type,content,source,created_at FROM business_memories WHERE business_id=$1::uuid AND (effective_until IS NULL OR effective_until>NOW()) ORDER BY created_at DESC LIMIT 12", [id]),
    sql.query("SELECT id::text,source_system,source_name,status,accepted_count,rejected_count,completed_at,created_at FROM source_imports WHERE business_id=$1::uuid ORDER BY created_at DESC LIMIT 5", [id]),
    sql.query("SELECT id::text,action_type,target_type,target_id,status,provider,provider_reference,created_at,completed_at FROM business_action_log WHERE business_id=$1::uuid AND action_type<>'start_my_day' ORDER BY created_at DESC LIMIT 30", [id]),
  ])
  const counts = (customerCounts[0] ?? {}) as Row
  const customerCount = Number(counts.total ?? 0)
  const withoutEmail = Number(counts.without_email ?? 0)
  const openActions = actions.filter(a => ["planned", "attempted", "failed"].includes(safeText((a as Row).status))).slice(0,12)
  const completedActions = actions.filter(a => safeText((a as Row).status) === "succeeded").slice(0,12)

  const auditSummary = JSON.stringify({
    customerCount,
    openActionCount: openActions.length,
    liveEmailChecked: false,
    liveOrdersChecked: false,
  })
  const auditRows = await sql.query(
    "INSERT INTO business_action_log (business_id,actor_account_key,action_type,target_type,target_id,status,provider,request_summary,result_summary,completed_at) VALUES ($1::uuid,$2,'start_my_day','business',$1::text,'succeeded','business_brain',$3::jsonb,$4::jsonb,NOW()) RETURNING id::text,created_at",
    [id, accountKey, JSON.stringify({ mode: "stored_records_only" }), auditSummary],
  )
  const audit = (auditRows[0] ?? {}) as Row

  return {
    generatedAt,
    workspace: { id, name: safeText(business.name) },
    customerCount,
    customersWithoutEmail: withoutEmail,
    activeRules: rules,
    recentMemories: memories,
    latestImports: imports,
    openActions,
    recentActions: completedActions,
    sourceChecks: [
      { name: "Business Brain customer records", status: "CHECKED", detail: `${customerCount} stored customer records; ${withoutEmail} without an email address.` },
      { name: "Business Brain rules, memories and action history", status: "CHECKED", detail: "Read from this signed-in workspace only." },
      ...missingSources,
    ],
    audit: { status: "RECORDED", id: safeText(audit.id), createdAt: audit.created_at },
  }
}
