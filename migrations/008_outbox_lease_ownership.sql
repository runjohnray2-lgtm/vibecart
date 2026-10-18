-- Apply before deploying lease-fenced outbox workers. Existing processing rows
-- are reclaimed after their lease expires and receive a fresh token.
ALTER TABLE vibecart_cloud_outbox
  ADD COLUMN IF NOT EXISTS lease_token text;
