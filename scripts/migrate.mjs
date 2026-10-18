import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is missing. Copy .env.example to .env and set your Neon connection string.');
  process.exit(1);
}
const file = resolve(process.cwd(), 'sql/001_init.sql');
const ddl = await readFile(file, 'utf8');
const pool = new Pool({ connectionString, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined, max: 1, connectionTimeoutMillis: 15000 });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ddl);
    await client.query('COMMIT');
    console.log('✅ Neon schema installed successfully. No sample livestock data was added.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} catch (error) {
  console.error('❌ Database migration failed. Check DATABASE_URL and make sure the Neon database is reachable.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await pool.end(); }
