// this is the migration runner that sander asked for: using node-pg-migrate
import { runner } from 'node-pg-migrate';
import dotenv from 'dotenv';
dotenv.config();

// this runs our pending migrations safely
export async function runMigrations() {
  // this connects using our database url from env
  const databaseUrl = process.env.DATABASE_URL || 'postgres://qurated:qurated_dev_password@127.0.0.1:5433/qurated_db';

  // running migrations up safely without dropping anything
  await runner({
    databaseUrl,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    verbose: true,
  });
}

// run if called directly
runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});