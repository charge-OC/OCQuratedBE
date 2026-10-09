// Import necessary modules for file reading and path resolution
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Import the pg client to establish a single DB connection for migration
import pg from 'pg';

const { Client } = pg;
// Create equivalent of __filename and __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Connects to the local PostgreSQL database, reads the initial SQL schema file,
 * and executes it to set up the database tables.
 */
async function runMigrations() {
  // Initialize a single, direct client connection (no pool needed for a one-off script)
  const client = new Client({
    user: 'qurated',
    host: '127.0.0.1',
    database: 'qurated_db',
    password: 'qurated_dev_password',
    port: 5433, // Connect to 5433 mapped by Docker
  });

  try {
    // Attempt to connect to the database
    await client.connect();
    console.log('Connected to PostgreSQL container on 127.0.0.1:5433 as qurated.');

    // Read all files in the migrations directory, sort them alphabetically to ensure correct order
    const migrationsDir = path.resolve(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const migrationFile = path.join(migrationsDir, file);
      const sql = fs.readFileSync(migrationFile, 'utf8');

      console.log(`Applying migration: ${file}...`);
      await client.query(sql);
      console.log(`Migration ${file} applied successfully.`);
    }
  } catch (err) {
    // If anything fails (connection, syntax error), log and exit with failure code
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    // Always cleanly shut down the client connection
    await client.end();
  }
}

// Execute the migration function
runMigrations();