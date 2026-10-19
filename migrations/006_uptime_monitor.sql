CREATE TABLE IF NOT EXISTS uptime_monitors (
  id BIGSERIAL PRIMARY KEY,
  account_key TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','HEAD')),
  expected_status INTEGER NOT NULL DEFAULT 200 CHECK (expected_status BETWEEN 100 AND 599),
  interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK (interval_seconds IN (60, 300, 900, 1800, 3600)),
  timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_status INTEGER,
  last_latency_ms INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS uptime_monitors_account_idx
  ON uptime_monitors (account_key, created_at DESC);

CREATE INDEX IF NOT EXISTS uptime_monitors_due_idx
  ON uptime_monitors (is_active, last_checked_at)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS uptime_check_events (
  id BIGSERIAL PRIMARY KEY,
  monitor_id BIGINT NOT NULL REFERENCES uptime_monitors(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_code INTEGER,
  latency_ms INTEGER,
  ok BOOLEAN NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS uptime_check_events_monitor_idx
  ON uptime_check_events (monitor_id, checked_at DESC);
