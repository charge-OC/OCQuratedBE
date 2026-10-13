-- migrations/003_source_columns.sql
-- Ensure sources table includes all runtime columns expected by source schema and cron workers

ALTER TABLE sources 
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS default_model_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
