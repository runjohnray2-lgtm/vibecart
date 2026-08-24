ALTER TABLE vibecart_carts
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(metadata) = 'object');
