// Runs one SQL file against the database in DATABASE_URL.  Usage: node server/scripts/run-sql.js database/seed_evaluation.sql
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');
const file = process.argv[2];
if (!file) { console.error('Give a SQL file'); process.exit(1); }
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gedt_dev';
const client = new Client({ connectionString: url, ...(String(process.env.PGSSL) === 'true' ? { ssl: true } : {}) });
client.connect().then(() => client.query(fs.readFileSync(file, 'utf8'))).then(() => console.log(`Ran ${file}`)).catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => client.end());
