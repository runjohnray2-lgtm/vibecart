\set ON_ERROR_STOP on

BEGIN;

INSERT INTO vibecart_carts (
  id, merchant_id, status, currency, items, metadata, subtotal_cents, version, expires_at
) VALUES
  ('cart_a', 'merchant_a', 'active', 'usd', '[]'::jsonb, '{"source":"ai"}'::jsonb, 1200, 1, now() + interval '1 day'),
  ('cart_b', 'merchant_b', 'active', 'usd', '[]'::jsonb, '{}'::jsonb, 500, 1, now() + interval '1 day');

-- This mirrors the merchant-scoped conversion predicate in order-store.ts.
UPDATE vibecart_carts
SET status = 'converted', checkout_session_id = 'cs_test_durable_1', updated_at = now()
WHERE id = 'cart_b' AND merchant_id = 'merchant_a';

DO $$
BEGIN
  IF (SELECT status FROM vibecart_carts WHERE id = 'cart_b') <> 'active' THEN
    RAISE EXCEPTION 'cross-merchant cart update escaped tenant scope';
  END IF;
END $$;

INSERT INTO vibecart_orders (
  id, merchant_id, event_id, checkout_session_id, cart_id, stripe_payment_intent_id,
  customer_email, customer_name, customer_phone,
  shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_state,
  shipping_postal_code, shipping_country,
  amount_subtotal, amount_shipping, amount_tax, amount_total, currency,
  payment_status, fulfillment_status, metadata
) VALUES (
  'ord_durable_1', 'merchant_a', 'evt_durable_1', 'cs_test_durable_1', 'cart_a', 'pi_test_1',
  'test@example.invalid', 'Test Buyer', '',
  'Test Buyer', '1 Test Way', '', 'Testville', 'OR',
  '97415', 'US',
  1200, 0, 0, 1200, 'usd',
  'paid', 'new', '{"source":"ai"}'::jsonb
)
ON CONFLICT (checkout_session_id) DO UPDATE SET
  payment_status = EXCLUDED.payment_status,
  updated_at = now();

-- Same Checkout Session replay must not create a second order.
INSERT INTO vibecart_orders (
  id, merchant_id, event_id, checkout_session_id, cart_id, stripe_payment_intent_id,
  customer_email, customer_name, customer_phone,
  shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_state,
  shipping_postal_code, shipping_country,
  amount_subtotal, amount_shipping, amount_tax, amount_total, currency,
  payment_status, fulfillment_status, metadata
) VALUES (
  'ord_should_not_exist', 'merchant_a', 'evt_durable_duplicate', 'cs_test_durable_1', 'cart_a', 'pi_test_1',
  'test@example.invalid', 'Test Buyer', '',
  'Test Buyer', '1 Test Way', '', 'Testville', 'OR',
  '97415', 'US',
  1200, 0, 0, 1200, 'usd',
  'paid', 'new', '{}'::jsonb
)
ON CONFLICT (checkout_session_id) DO UPDATE SET
  payment_status = EXCLUDED.payment_status,
  updated_at = now();

INSERT INTO vibecart_order_lines (
  order_id, line_item_id, product_id, description, quantity, unit_amount,
  amount_subtotal, amount_discount, amount_tax, amount_total, currency
) VALUES (
  'ord_durable_1', 'li_test_1', 'sku_test_1', 'Test product', 1, 1200,
  1200, 0, 0, 1200, 'usd'
)
ON CONFLICT (order_id, line_item_id) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  amount_total = EXCLUDED.amount_total;

INSERT INTO vibecart_order_events (
  id, order_id, event_type, to_status, source, details
) VALUES (
  'evt_durable_1', 'ord_durable_1', 'payment_verified', 'new', 'stripe',
  '{"checkoutSessionId":"cs_test_durable_1"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO vibecart_order_events (
  id, order_id, event_type, to_status, source, details
) VALUES (
  'evt_durable_1', 'ord_durable_1', 'payment_verified', 'new', 'stripe',
  '{"checkoutSessionId":"cs_test_durable_1"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO vibecart_cloud_outbox (
  id, order_id, merchant_id, event_id, event_type, event_created_at,
  status, attempt_count, next_attempt_at
) VALUES (
  'out_durable_1', 'ord_durable_1', 'merchant_a', 'evt_durable_1',
  'checkout.session.completed', now(), 'pending', 0, now()
)
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO vibecart_cloud_outbox (
  id, order_id, merchant_id, event_id, event_type, event_created_at,
  status, attempt_count, next_attempt_at
) VALUES (
  'out_should_not_exist', 'ord_durable_1', 'merchant_a', 'evt_durable_1',
  'checkout.session.completed', now(), 'pending', 0, now()
)
ON CONFLICT (order_id) DO NOTHING;

UPDATE vibecart_carts
SET status = 'converted', checkout_session_id = 'cs_test_durable_1', updated_at = now()
WHERE id = 'cart_a' AND merchant_id = 'merchant_a';

DO $$
DECLARE
  order_count integer;
  line_count integer;
  event_count integer;
  outbox_count integer;
  due_index_count integer;
  merchant_index_count integer;
BEGIN
  SELECT count(*) INTO order_count
    FROM vibecart_orders WHERE checkout_session_id = 'cs_test_durable_1';
  IF order_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one durable order, found %', order_count;
  END IF;

  IF (SELECT id FROM vibecart_orders WHERE checkout_session_id = 'cs_test_durable_1') <> 'ord_durable_1' THEN
    RAISE EXCEPTION 'duplicate checkout replaced the original durable order identity';
  END IF;

  SELECT count(*) INTO line_count
    FROM vibecart_order_lines WHERE order_id = 'ord_durable_1';
  IF line_count <> 1 THEN
    RAISE EXCEPTION 'expected one durable line, found %', line_count;
  END IF;

  SELECT count(*) INTO event_count
    FROM vibecart_order_events WHERE id = 'evt_durable_1';
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'expected one payment event, found %', event_count;
  END IF;

  SELECT count(*) INTO outbox_count
    FROM vibecart_cloud_outbox WHERE order_id = 'ord_durable_1';
  IF outbox_count <> 1 THEN
    RAISE EXCEPTION 'expected one Cloud outbox row, found %', outbox_count;
  END IF;

  IF (SELECT merchant_id FROM vibecart_cloud_outbox WHERE order_id = 'ord_durable_1') <> 'merchant_a' THEN
    RAISE EXCEPTION 'outbox merchant identity mismatch';
  END IF;

  IF (SELECT status FROM vibecart_carts WHERE id = 'cart_a') <> 'converted' THEN
    RAISE EXCEPTION 'same-merchant cart conversion failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vibecart_cloud_outbox' AND column_name = 'lease_until'
  ) THEN
    RAISE EXCEPTION 'outbox processing lease column missing';
  END IF;

  SELECT count(*) INTO due_index_count
    FROM pg_indexes WHERE indexname = 'vibecart_cloud_outbox_due_idx';
  SELECT count(*) INTO merchant_index_count
    FROM pg_indexes WHERE indexname = 'vibecart_cloud_outbox_merchant_idx';
  IF due_index_count <> 1 OR merchant_index_count <> 1 THEN
    RAISE EXCEPTION 'required outbox indexes missing';
  END IF;
END $$;


-- A replacement worker owns the row after reclaim. Neither a late success nor
-- a late failure from the old worker may mutate its delivery state.
UPDATE vibecart_cloud_outbox
SET status = 'processing', lease_token = 'replacement-worker', lease_until = now() + interval '120 seconds'
WHERE order_id = 'ord_durable_1';
UPDATE vibecart_cloud_outbox SET status = 'delivered', lease_token = NULL
WHERE order_id = 'ord_durable_1' AND status = 'processing' AND lease_token = 'expired-worker';
UPDATE vibecart_cloud_outbox SET status = 'pending', attempt_count = attempt_count + 1, lease_token = NULL
WHERE order_id = 'ord_durable_1' AND status = 'processing' AND lease_token = 'expired-worker';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vibecart_cloud_outbox WHERE order_id = 'ord_durable_1'
    AND status = 'processing' AND lease_token = 'replacement-worker' AND attempt_count = 0) THEN
    RAISE EXCEPTION 'expired worker overwrote replacement lease';
  END IF;
END $$;
UPDATE vibecart_cloud_outbox SET status = 'delivered', lease_token = NULL
WHERE order_id = 'ord_durable_1' AND status = 'processing' AND lease_token = 'replacement-worker';
DO $$
BEGIN
  IF (SELECT status FROM vibecart_cloud_outbox WHERE order_id = 'ord_durable_1') <> 'delivered' THEN
    RAISE EXCEPTION 'current lease owner could not finish delivery';
  END IF;
END $$;

ROLLBACK;
