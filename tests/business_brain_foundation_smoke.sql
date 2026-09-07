-- Business Brain Phase 1 schema smoke checks.
-- Run after migrations/006_business_brain_foundation.sql in a disposable Postgres database.
BEGIN;

DO $$
DECLARE
  business_uuid uuid;
BEGIN
  INSERT INTO businesses (name) VALUES ('Schema Smoke Test') RETURNING id INTO business_uuid;

  -- The same source_record_id must be allowed for different source systems.
  INSERT INTO source_rows (business_id, source_system, source_record_id, raw_payload)
  VALUES
    (business_uuid, 'shipstation', '42', '{}'::jsonb),
    (business_uuid, 'sage50', '42', '{}'::jsonb);

  IF (SELECT count(*) FROM source_rows WHERE business_id = business_uuid AND source_record_id = '42') <> 2 THEN
    RAISE EXCEPTION 'source-system-aware dedupe regression';
  END IF;

  -- A duplicate within the same source system must still be rejected.
  BEGIN
    INSERT INTO source_rows (business_id, source_system, source_record_id, raw_payload)
    VALUES (business_uuid, 'shipstation', '42', '{}'::jsonb);
    RAISE EXCEPTION 'same-source duplicate unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

ROLLBACK;
