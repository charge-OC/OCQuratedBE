import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

delete process.env.PGUSER;
delete process.env.PGPASSWORD;
delete process.env.PGDATABASE;
delete process.env.PGPORT;
delete process.env.PGHOST;

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const client = new Client({
    user: 'qurated',
    host: '127.0.0.1',
    database: 'qurated_db',
    password: 'qurated_dev_password',
    port: 5432,
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL container on 127.0.0.1:5432 as qurated.');

    const migrationFile = path.resolve(__dirname, '../../migrations/001_initial_schema.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    await client.query(sql);
    console.log('Migration 001_initial_schema.sql applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
