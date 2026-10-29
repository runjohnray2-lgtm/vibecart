CREATE TABLE IF NOT EXISTS vibecart_cloud_outbox (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES vibecart_orders(id) ON DELETE CASCADE,
  merchant_id text NOT NULL,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL
    CHECK (event_type IN ('checkout.session.completed','checkout.session.async_payment_succeeded')),
  event_created_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','delivered','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_status_code integer,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vibecart_cloud_outbox_due_idx
  ON vibecart_cloud_outbox (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS vibecart_cloud_outbox_merchant_idx
  ON vibecart_cloud_outbox (merchant_id, created_at DESC);

COMMENT ON TABLE vibecart_cloud_outbox IS
  'Optional post-payment Cloud delivery outbox. Core order persistence is authoritative and independent of Cloud.';
