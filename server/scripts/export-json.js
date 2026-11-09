// Exports every table in the database to JSON: one file per table plus all.json with everything.
// Geometry columns are written as GeoJSON. Password hashes are left out unless you add --include-password-hashes.
//   npm run db:export                         (writes to the export/ folder)
//   npm run db:export -- --out my-folder      (writes somewhere else)
// Uses DATABASE_URL from .env, and PGSSL=true for hosted databases such as Neon.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : 'export');
const includeHashes = args.includes('--include-password-hashes');
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gedt_dev';

// PostGIS keeps its own reference table in public; it is not project data
const SKIP_TABLES = ['spatial_ref_sys'];

const ident = (name) => '"' + name.replace(/"/g, '""') + '"';

async function main() {
  const client = new Client({ connectionString: url, ...(String(process.env.PGSSL) === 'true' ? { ssl: true } : {}) });
  await client.connect();
  try {
    const tables = (await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND NOT (table_name = ANY($1))
        ORDER BY table_name`, [SKIP_TABLES])).rows.map((r) => r.table_name);

    fs.mkdirSync(outDir, { recursive: true });
    const all = { exported_at: new Date().toISOString(), database: new URL(url).pathname.slice(1), tables: {} };
    const summary = [];

    for (const table of tables) {
      const cols = (await client.query(
        `SELECT column_name, udt_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).rows;
      const select = cols
        .filter((c) => includeHashes || c.column_name !== 'password_hash')
        .map((c) => (c.udt_name === 'geometry' || c.udt_name === 'geography'
          ? `ST_AsGeoJSON(${ident(c.column_name)})::json AS ${ident(c.column_name)}`
          : ident(c.column_name)))
        .join(', ');
      // Order by the first column, which is the primary key in every table of this schema.
      // The database builds the JSON itself, so dates stay as written and jsonb stays as objects.
      const { rows } = await client.query(
        `SELECT COALESCE(json_agg(t), '[]'::json) AS data
           FROM (SELECT ${select} FROM ${ident(table)} ORDER BY 1) t`);
      const data = rows[0].data;
      fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(data, null, 2) + '\n');
      all.tables[table] = data;
      summary.push([table, data.length]);
    }

    fs.writeFileSync(path.join(outDir, 'all.json'), JSON.stringify(all, null, 2) + '\n');
    for (const [t, n] of summary) console.log(`${t.padEnd(22)} ${String(n).padStart(6)} rows`);
    console.log(`\nWrote ${summary.length} table files and all.json to ${outDir}`);
    if (!includeHashes) console.log('Password hashes were left out (add --include-password-hashes to keep them).');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
