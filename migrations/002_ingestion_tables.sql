-- migrations/002_ingestion_tables.sql

-- Drop existing tables to recreate with the requested B1.3 schema
DROP TABLE IF EXISTS normalized_records CASCADE;
DROP TABLE IF EXISTS flagged_records CASCADE;
DROP TABLE IF EXISTS ingestion_runs CASCADE;

-- 1. ingestion_runs
CREATE TABLE ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING', -- 'PROCESSING', 'COMPLETED', 'FAILED'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE,
    total_rows INT DEFAULT 0,
    valid_rows INT DEFAULT 0,
    failed_rows INT DEFAULT 0,
    error_message TEXT
);

-- 2. flagged_records
CREATE TABLE flagged_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    row_index INT NOT NULL,
    raw_row JSONB NOT NULL,
    error_reasons JSONB NOT NULL, -- Array of string reasons
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. normalized_records
CREATE TABLE normalized_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL,
    sku VARCHAR(255) NOT NULL,
    name VARCHAR(500),
    price NUMERIC(12, 2),
    ean VARCHAR(64),
    attributes JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
