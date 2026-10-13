-- Up Migration
-- this makes sure the sources table has both type and protocol as sander asked

ALTER TABLE sources 
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS protocol VARCHAR(32) DEFAULT 'HTTP',
  ADD COLUMN IF NOT EXISTS default_model_id VARCHAR(255) DEFAULT 'google/gemini-flash-1.5',
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Down Migration
-- this removes the extra columns if rolled back
ALTER TABLE sources 
  DROP COLUMN IF EXISTS type,
  DROP COLUMN IF EXISTS default_model_id,
  DROP COLUMN IF EXISTS last_run_at,
  DROP COLUMN IF EXISTS archived_at;
