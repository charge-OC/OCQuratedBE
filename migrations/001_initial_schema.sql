CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    protocol VARCHAR(32) NOT NULL,
    connection_config JSONB NOT NULL DEFAULT '{}',
    dialect_config JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    schedule_cron VARCHAR(64),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    archived_at TIMESTAMP,
    archived_by VARCHAR(255),
    last_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
    started_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP,
    total_rows INT DEFAULT 0,
    valid_rows INT DEFAULT 0,
    failed_rows INT DEFAULT 0,
    error_message TEXT
);

CREATE TABLE flagged_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    row_index INT NOT NULL,
    raw_row JSONB NOT NULL,
    error_reasons JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
