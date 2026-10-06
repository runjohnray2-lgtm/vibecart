import { createHash } from "node:crypto"
import { neon } from "@neondatabase/serverless"

function db() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) throw new Error("Business Brain storage is not configured")
  return neon(url)
}

function accountKey(value: string) {
  const key = value.trim()
  if (!key || key.length > 200) throw new Error("Invalid account")
  return key
}

function clean(value: string | undefined, fallback = "", max = 300) {
  return (value?.trim() || fallback).slice(0, max)
}

function header(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1]
    if (quoted) {
      if (ch === "\"" && next === "\"") { field += "\""; i++ }
      else if (ch === "\"") quoted = false
      else field += ch
    } else if (ch === "\"") quoted = true
    else if (ch === ",") { row.push(field); field = "" }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = "" }
    else field += ch
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row) }
  return rows.filter(r => r.some(cell => cell.trim()))
}

function sourceId(raw: Record<string,string>) {
  const id = raw.customer_id || raw.id || raw.customer_number
  if (id) return clean(id, "", 300)
  if (raw.email) return "email:" + raw.email.trim().toLowerCase()
  if (raw.phone) return "phone:" + raw.phone.replace(/\D/g, "")
  return "row:" + createHash("sha256").update(JSON.stringify(Object.keys(raw).sort().map(k => [k, raw[k]]))).digest("hex")
}

function customer(raw: Record<string,string>) {
  const name = raw.display_name || raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ") || raw.company_name || raw.company || raw.email || "Unnamed customer"
  return {
    displayName: clean(name, "Unnamed customer", 200),
    companyName: clean(raw.company_name || raw.company, "", 200) || null,
    email: clean(raw.email || raw.email_address, "", 320).toLowerCase() || null,
    phone: clean(raw.phone || raw.phone_number, "", 80) || null,
  }
}

export async function ensureWorkspace(accountValue: string, businessName = "SeekPwr Co.") {
  const account = accountKey(accountValue), name = clean(businessName, "SeekPwr Co.", 200)
  const sql = db()
  const rows = await sql.query("INSERT INTO businesses (account_key,name) VALUES ($1,$2) ON CONFLICT (account_key,name) DO UPDATE SET updated_at=NOW() RETURNING id::text,account_key,name", [account,name])
  const row = rows[0] as Record<string,unknown>
  await sql.query("INSERT INTO business_members (business_id,account_key,role) VALUES ($1::uuid,$2,\'owner\') ON CONFLICT (business_id,account_key) DO NOTHING", [String(row.id),account])
  return { id:String(row.id), accountKey:String(row.account_key), name:String(row.name) }
}

export async function importCustomerCsv(input: {accountKey:string; businessName?:string; sourceSystem:string; sourceName?:string; csvText:string}) {
  const workspace = await ensureWorkspace(input.accountKey, input.businessName)
  const sql = db(), system = clean(input.sourceSystem, "csv", 100).toLowerCase(), sourceName = clean(input.sourceName, "customer-import.csv", 200)
  const sha = createHash("sha256").update(input.csvText).digest("hex")
  const existing = await sql.query("SELECT id::text,status,row_count,accepted_count,rejected_count FROM source_imports WHERE business_id=$1::uuid AND source_system=$2 AND file_sha256=$3 LIMIT 1", [workspace.id,system,sha])
  const prior = existing[0] as Record<string,unknown> | undefined
  if (prior?.status === "completed") return { workspace, importId:String(prior.id), rowCount:Number(prior.row_count), acceptedCount:Number(prior.accepted_count), rejectedCount:Number(prior.rejected_count), idempotentReplay:true }
  const parsed = parseCsv(input.csvText)
  if (parsed.length < 2) throw new Error("CSV must include a header row and at least one customer row")
  const headers = parsed[0].map(header), data = parsed.slice(1)
  const imported = await sql.query("INSERT INTO source_imports (business_id,source_system,source_name,file_sha256,status,row_count) VALUES ($1::uuid,$2,$3,$4,\'processing\',$5) ON CONFLICT (business_id,source_system,file_sha256) DO UPDATE SET source_name=EXCLUDED.source_name RETURNING id::text", [workspace.id,system,sourceName,sha,data.length])
  const importId = String((imported[0] as Record<string,unknown>).id)
  let accepted = 0, rejected = 0
  for (let index=0; index<data.length; index++) {
    const raw: Record<string,string> = {}
    headers.forEach((h,i) => { if (h) raw[h] = (data[index][i] ?? "").trim() })
    try {
      const mapped = customer(raw), sid = sourceId(raw)
      const sr = await sql.query("INSERT INTO source_rows (business_id,import_id,source_system,source_record_id,row_number,raw_data,mapping_status) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,\'accepted\') ON CONFLICT (business_id,source_system,source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET import_id=EXCLUDED.import_id,row_number=EXCLUDED.row_number,raw_data=EXCLUDED.raw_data,mapping_status=\'accepted\',mapping_error=NULL RETURNING id::text", [workspace.id,importId,system,sid,index+2,JSON.stringify(raw)])
      const sourceRowId = String((sr[0] as Record<string,unknown>).id)
      await sql.query("INSERT INTO business_customers (business_id,display_name,company_name,email,phone,source_system,source_record_id,source_row_id) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid) ON CONFLICT (business_id,source_system,source_record_id) WHERE source_system IS NOT NULL AND source_record_id IS NOT NULL DO UPDATE SET display_name=EXCLUDED.display_name,company_name=EXCLUDED.company_name,email=EXCLUDED.email,phone=EXCLUDED.phone,source_row_id=EXCLUDED.source_row_id,updated_at=NOW()", [workspace.id,mapped.displayName,mapped.companyName,mapped.email,mapped.phone,system,sid,sourceRowId])
      accepted++
    } catch (error) {
      rejected++
      const message = error instanceof Error ? error.message : "Import error"
      await sql.query("INSERT INTO source_rows (business_id,import_id,source_system,row_number,raw_data,mapping_status,mapping_error) VALUES ($1::uuid,$2::uuid,$3,$4,$5::jsonb,\'rejected\',$6) ON CONFLICT (import_id,row_number) DO UPDATE SET mapping_status=\'rejected\',mapping_error=EXCLUDED.mapping_error", [workspace.id,importId,system,index+2,JSON.stringify(raw),message.slice(0,1000)])
    }
  }
  await sql.query("UPDATE source_imports SET status=$2,accepted_count=$3,rejected_count=$4,completed_at=NOW() WHERE id=$1::uuid", [importId,rejected ? "completed_with_errors" : "completed",accepted,rejected])
  return { workspace, importId, rowCount:data.length, acceptedCount:accepted, rejectedCount:rejected, idempotentReplay:false }
}

export async function getWorkspaceSnapshot(accountValue:string, businessName="SeekPwr Co.") {
  const account = accountKey(accountValue), sql = db(), name = clean(businessName,"SeekPwr Co.",200)
  const found = await sql.query("SELECT id::text,name FROM businesses WHERE account_key=$1 AND name=$2 LIMIT 1", [account,name])
  if (!found[0]) return { workspace:null, customers:[], imports:[] }
  const id = String((found[0] as Record<string,unknown>).id)
  const customers = await sql.query("SELECT c.id::text,c.display_name,c.company_name,c.email,c.phone,c.source_system,c.source_record_id,c.created_at,c.updated_at,i.id::text AS import_id,i.source_name,i.created_at AS imported_at FROM business_customers c LEFT JOIN source_rows r ON r.id=c.source_row_id LEFT JOIN source_imports i ON i.id=r.import_id WHERE c.business_id=$1::uuid ORDER BY c.display_name LIMIT 1000", [id])
  const imports = await sql.query("SELECT id::text,source_system,source_name,status,row_count,accepted_count,rejected_count,created_at,completed_at FROM source_imports WHERE business_id=$1::uuid ORDER BY created_at DESC LIMIT 100", [id])
  const rules = await sql.query("SELECT id::text,rule_text,source,is_active,effective_from,created_at FROM business_rules WHERE business_id=$1::uuid AND is_active=true AND (effective_until IS NULL OR effective_until>NOW()) ORDER BY effective_from DESC LIMIT 200", [id])
  const memories = await sql.query("SELECT id::text,memory_type,content,source,effective_from,created_at FROM business_memories WHERE business_id=$1::uuid AND (effective_until IS NULL OR effective_until>NOW()) ORDER BY effective_from DESC LIMIT 500", [id])
  return { workspace:{id,name:String((found[0] as Record<string,unknown>).name),accountKey:account}, customers, imports, rules, memories }
}

export async function saveBusinessRule(input:{accountKey:string; businessName?:string; ruleText:string; source?:string}) {
  const workspace = await ensureWorkspace(input.accountKey, input.businessName)
  const ruleText = clean(input.ruleText, "", 4000)
  if (!ruleText) throw new Error("Rule text is required")
  const source = clean(input.source, "manual", 200)
  const sql = db()
  const rows = await sql.query("INSERT INTO business_rules (business_id,rule_text,source) VALUES ($1::uuid,$2,$3) RETURNING id::text,rule_text,source,is_active,effective_from,created_at", [workspace.id,ruleText,source])
  return { workspace, rule:rows[0] }
}

export async function saveBusinessMemory(input:{accountKey:string; businessName?:string; memoryType:string; content:string; source?:string}) {
  const workspace = await ensureWorkspace(input.accountKey, input.businessName)
  const memoryType = clean(input.memoryType, "fact", 40).toLowerCase()
  if (!["decision","note","preference","fact"].includes(memoryType)) throw new Error("Invalid memory type")
  const content = clean(input.content, "", 4000)
  if (!content) throw new Error("Memory content is required")
  const source = clean(input.source, "manual", 200)
  const sql = db()
  const rows = await sql.query("INSERT INTO business_memories (business_id,memory_type,content,source) VALUES ($1::uuid,$2,$3,$4) RETURNING id::text,memory_type,content,source,effective_from,created_at", [workspace.id,memoryType,content,source])
  return { workspace, memory:rows[0] }
}


export async function getBusinessQuestionContext(input:{accountKey:string; businessName?:string; question:string}) {
  const account = accountKey(input.accountKey)
  const name = clean(input.businessName, "SeekPwr Co.", 200)
  const question = clean(input.question, "", 1200)
  if (!question) throw new Error("Question is required")
  const sql = db()
  const found = await sql.query("SELECT id::text,name FROM businesses WHERE account_key=$1 AND name=$2 LIMIT 1", [account,name])
  if (!found[0]) throw new Error("Create the business workspace first")
  const id = String((found[0] as Record<string,unknown>).id)
  const terms = Array.from(new Set(question.toLowerCase().split(/[^a-z0-9@.+-]+/).filter(term => term.length >= 3))).slice(0,12)
  const patterns = terms.map(term => `%${term}%`)
  const customers = patterns.length
    ? await sql.query("SELECT id::text,display_name,company_name,email,phone,source_system,source_record_id FROM business_customers WHERE business_id=$1::uuid AND EXISTS (SELECT 1 FROM unnest($2::text[]) p WHERE lower(coalesce(display_name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) LIKE p) ORDER BY updated_at DESC LIMIT 25", [id,patterns])
    : []
  const rules = await sql.query("SELECT id::text,rule_text,source FROM business_rules WHERE business_id=$1::uuid AND is_active=true AND (effective_until IS NULL OR effective_until>NOW()) ORDER BY effective_from DESC LIMIT 50", [id])
  const memories = await sql.query("SELECT id::text,memory_type,content,source FROM business_memories WHERE business_id=$1::uuid AND (effective_until IS NULL OR effective_until>NOW()) ORDER BY effective_from DESC LIMIT 80", [id])
  const imports = await sql.query("SELECT source_system,source_name,status,accepted_count,rejected_count,completed_at FROM source_imports WHERE business_id=$1::uuid ORDER BY created_at DESC LIMIT 10", [id])
  const counts = await sql.query("SELECT count(*)::int AS customer_count FROM business_customers WHERE business_id=$1::uuid", [id])
  return {
    workspace:{id,name:String((found[0] as Record<string,unknown>).name)},
    question,
    customers,
    rules,
    memories,
    imports,
    customerCount:Number((counts[0] as Record<string,unknown>)?.customer_count ?? 0),
  }
}
