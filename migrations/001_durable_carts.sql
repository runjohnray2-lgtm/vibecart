CREATE TABLE IF NOT EXISTS vibecart_carts (
  id text PRIMARY KEY,
  merchant_id text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','converted','expired')),
  currency text NOT NULL DEFAULT 'usd',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key text,
  checkout_session_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vibecart_carts_status_expires_idx ON vibecart_carts (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS vibecart_carts_merchant_idempotency_idx ON vibecart_carts (merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
