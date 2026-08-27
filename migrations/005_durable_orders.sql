CREATE TABLE IF NOT EXISTS vibecart_orders (
  id text PRIMARY KEY,
  merchant_id text NOT NULL DEFAULT 'default',
  event_id text NOT NULL UNIQUE,
  checkout_session_id text NOT NULL UNIQUE,
  cart_id text NOT NULL DEFAULT '',
  stripe_payment_intent_id text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  shipping_name text NOT NULL DEFAULT '',
  shipping_line1 text NOT NULL DEFAULT '',
  shipping_line2 text NOT NULL DEFAULT '',
  shipping_city text NOT NULL DEFAULT '',
  shipping_state text NOT NULL DEFAULT '',
  shipping_postal_code text NOT NULL DEFAULT '',
  shipping_country text NOT NULL DEFAULT '',
  amount_subtotal integer CHECK (amount_subtotal IS NULL OR amount_subtotal >= 0),
  amount_shipping integer NOT NULL DEFAULT 0 CHECK (amount_shipping >= 0),
  amount_tax integer NOT NULL DEFAULT 0 CHECK (amount_tax >= 0),
  amount_total integer CHECK (amount_total IS NULL OR amount_total >= 0),
  currency text NOT NULL DEFAULT 'usd',
  payment_status text NOT NULL DEFAULT 'paid',
  fulfillment_status text NOT NULL DEFAULT 'new'
    CHECK (fulfillment_status IN ('new','packing','shipped','cancelled','refunded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vibecart_orders_merchant_created_idx
  ON vibecart_orders (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vibecart_orders_fulfillment_idx
  ON vibecart_orders (merchant_id, fulfillment_status, created_at DESC);

CREATE TABLE IF NOT EXISTS vibecart_order_lines (
  order_id text NOT NULL REFERENCES vibecart_orders(id) ON DELETE CASCADE,
  line_item_id text NOT NULL,
  product_id text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  quantity integer NOT NULL CHECK (quantity >= 1),
  unit_amount integer CHECK (unit_amount IS NULL OR unit_amount >= 0),
  amount_subtotal integer NOT NULL CHECK (amount_subtotal >= 0),
  amount_discount integer NOT NULL DEFAULT 0 CHECK (amount_discount >= 0),
  amount_tax integer NOT NULL DEFAULT 0 CHECK (amount_tax >= 0),
  amount_total integer NOT NULL CHECK (amount_total >= 0),
  currency text NOT NULL DEFAULT 'usd',
  PRIMARY KEY (order_id, line_item_id)
);

CREATE TABLE IF NOT EXISTS vibecart_order_events (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES vibecart_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  source text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vibecart_order_events_order_created_idx
  ON vibecart_order_events (order_id, created_at DESC);
