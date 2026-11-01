// Loads schema.sql and seed.sql into the database in DATABASE_URL, creating the database if needed.
// WARNING: this erases the tables it builds. For a database that is not on your own computer you must add --yes.
//   npm run db:load                   (local database)
//   npm run db:load -- --yes          (hosted database, for example Neon)
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const sslOption = () => (String(process.env.PGSSL || 'false') === 'true' ? { ssl: true } : {});

async function connect(connectionString) {
  const client = new Client({ connectionString, ...sslOption() });
  await client.connect();
  return client;
}

async function ensureDatabaseExists(connectionString) {
  try { (await connect(connectionString)).end(); return; } catch (e) { if (e.code !== '3D000') throw e; }
  const url = new URL(connectionString);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = await connect(url.toString());
  await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await admin.end();
}

async function loadDatabase(connectionString) {
  await ensureDatabaseExists(connectionString);
  const client = await connect(connectionString);
  const dir = path.join(__dirname, '..', '..', 'database');
  try {
    for (const file of ['schema.sql', 'seed.sql']) await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  } finally { await client.end(); }
}

// Loads only when the tables are missing, so it is safe to run on every start
async function ensureLoaded(connectionString) {
  await ensureDatabaseExists(connectionString);
  const client = await connect(connectionString);
  const { rows } = await client.query("SELECT to_regclass('public.operators') AS t");
  await client.end();
  if (rows[0].t) return false;
  await loadDatabase(connectionString);
  return true;
}

module.exports = { loadDatabase, ensureLoaded };

if (require.main === module) {
  require('dotenv').config();
  const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gedt_dev';
  const local = ['localhost', '127.0.0.1', '::1', 'db'].includes(new URL(url).hostname);
  const onlyIfEmpty = process.argv.includes('--if-empty');
  if (!local && !process.argv.includes('--yes') && !onlyIfEmpty) {
    console.error(`This will ERASE and rebuild the database on ${new URL(url).hostname}. If that is what you want, run again with --yes`);
    process.exit(1);
  }
  const job = onlyIfEmpty ? ensureLoaded(url).then((did) => console.log(did ? 'Database was empty: schema and demo data loaded.' : 'Database already set up: nothing changed.'))
    : loadDatabase(url).then(() => console.log('Database loaded: schema and demo data.'));
  job.catch((e) => { console.error(e.message); process.exit(1); });
}
