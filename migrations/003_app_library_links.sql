-- VibeCart app-library foundation: shared entitlements + Link/QR/UTM utility
-- Additive/reversible migration. Does not modify existing cart/payment tables.

CREATE TABLE IF NOT EXISTS app_entitlements (
  id BIGSERIAL PRIMARY KEY,
  account_key TEXT NOT NULL,
  app_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','trial','paused','expired','revoked')),
  source TEXT NOT NULL DEFAULT 'subscription',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_key, app_key)
);

CREATE INDEX IF NOT EXISTS idx_app_entitlements_account_status
  ON app_entitlements (account_key, status);

CREATE TABLE IF NOT EXISTS short_links (
  id BIGSERIAL PRIMARY KEY,
  account_key TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  title TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_short_links_account_created
  ON short_links (account_key, created_at DESC);

CREATE TABLE IF NOT EXISTS short_link_events (
  id BIGSERIAL PRIMARY KEY,
  short_link_id BIGINT NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  referrer TEXT,
  user_agent TEXT,
  country_code CHAR(2),
  device_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_short_link_events_link_time
  ON short_link_events (short_link_id, occurred_at DESC);

COMMENT ON TABLE app_entitlements IS 'Shared VibeCart app-library access. account_key intentionally decouples entitlement logic from a specific auth provider.';
COMMENT ON TABLE short_links IS 'Editable destinations used by short URLs and generated QR codes; QR images should encode the VibeCart redirect URL, not the final destination.';
COMMENT ON TABLE short_link_events IS 'Privacy-minimized aggregate click events; do not store raw IP addresses.';
