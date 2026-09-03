-- Business Brain Phase 1 foundation
-- Tenant-scoped, audit-friendly records. Apply only after review/testing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_key, name)
);

CREATE TABLE IF NOT EXISTS business_members (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_key text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, account_key)
);

CREATE TABLE IF NOT EXISTS business_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_text text NOT NULL,
  source text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS business_rules_active_idx ON business_rules (business_id, is_active, effective_from DESC);

CREATE TABLE IF NOT EXISTS source_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  source_name text,
  file_sha256 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','completed_with_errors','failed')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (business_id, source_system, file_sha256)
);

CREATE TABLE IF NOT EXISTS source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES source_imports(id) ON DELETE CASCADE,
  source_record_id text,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw_data jsonb NOT NULL,
  mapping_status text NOT NULL DEFAULT 'pending' CHECK (mapping_status IN ('pending','accepted','rejected','needs_review')),
  mapping_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, row_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS source_rows_record_dedupe_idx
  ON source_rows (business_id, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  company_name text,
  email text,
  phone text,
  source_system text,
  source_record_id text,
  source_row_id uuid REFERENCES source_rows(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_customers_source_dedupe_idx
  ON business_customers (business_id, source_system, source_record_id)
  WHERE source_system IS NOT NULL AND source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_customers_name_idx ON business_customers (business_id, display_name);

CREATE TABLE IF NOT EXISTS business_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  memory_type text NOT NULL CHECK (memory_type IN ('decision','note','preference','fact')),
  content text NOT NULL,
  source text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS business_memories_lookup_idx ON business_memories (business_id, memory_type, effective_from DESC);

CREATE TABLE IF NOT EXISTS business_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_account_key text,
  action_type text NOT NULL,
  target_type text,
  target_id text,
  status text NOT NULL CHECK (status IN ('planned','attempted','succeeded','failed','cancelled')),
  provider text,
  provider_reference text,
  request_summary jsonb,
  result_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS business_action_log_recent_idx ON business_action_log (business_id, created_at DESC);
