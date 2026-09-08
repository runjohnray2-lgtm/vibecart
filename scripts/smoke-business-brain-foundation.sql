-- Business Brain foundation smoke test.
-- Run against a disposable Postgres database after applying migrations/006_business_brain_foundation.sql.
-- The transaction always rolls back.

BEGIN;

DO $$
DECLARE
  v_business uuid;
  v_import_shipstation uuid;
  v_import_sage uuid;
BEGIN
  INSERT INTO businesses (account_key, name)
  VALUES ('smoke-account', 'Smoke Business')
  RETURNING id INTO v_business;

  INSERT INTO source_imports (business_id, source_system, source_name, file_sha256)
  VALUES (v_business, 'shipstation', 'shipstation.csv', 'smoke-shipstation')
  RETURNING id INTO v_import_shipstation;

  INSERT INTO source_imports (business_id, source_system, source_name, file_sha256)
  VALUES (v_business, 'sage', 'sage.csv', 'smoke-sage')
  RETURNING id INTO v_import_sage;

  -- Same external record ID from two source systems must be allowed.
  INSERT INTO source_rows (business_id, import_id, source_system, source_record_id, row_number, raw_data)
  VALUES
    (v_business, v_import_shipstation, 'shipstation', 'ORDER-100', 1, '{"source":"shipstation"}'::jsonb),
    (v_business, v_import_sage, 'sage', 'ORDER-100', 1, '{"source":"sage"}'::jsonb);

  -- Duplicate identity inside one source system must fail.
  BEGIN
    INSERT INTO source_rows (business_id, import_id, source_system, source_record_id, row_number, raw_data)
    VALUES (v_business, v_import_shipstation, 'shipstation', 'ORDER-100', 2, '{}'::jsonb);
    RAISE EXCEPTION 'expected duplicate source identity to be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END $$;

ROLLBACK;
