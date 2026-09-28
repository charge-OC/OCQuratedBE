import pg from 'pg';

delete process.env.PGUSER;
delete process.env.PGPASSWORD;
delete process.env.PGDATABASE;
delete process.env.PGPORT;
delete process.env.PGHOST;

const { Pool } = pg;

export const pool = new Pool({
  user: 'qurated',
  host: '127.0.0.1',
  database: 'qurated_db',
  password: 'qurated_dev_password',
  port: 5432,
});

export default pool;
