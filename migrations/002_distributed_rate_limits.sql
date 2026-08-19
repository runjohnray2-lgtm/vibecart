CREATE TABLE IF NOT EXISTS vibecart_rate_limits (
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash)
);

CREATE INDEX IF NOT EXISTS vibecart_rate_limits_updated_at_idx
  ON vibecart_rate_limits (updated_at);

COMMENT ON TABLE vibecart_rate_limits IS
  'Shared fixed-window abuse-control counters. key_hash stores a one-way request-key digest, never a raw client IP.';
