// Replaces all devices and routes with the contents of two JSON files (in the format db:export writes).
// Rows that point at devices or routes (status_log, maintenance_records, alerts, notifications) are deleted first.
// Everything runs in one transaction: if any row is rejected, nothing changes.
//   node server/scripts/replace-network.js <devices.json> <routes.json> --yes
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

const [devicesFile, routesFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!devicesFile || !routesFile || !process.argv.includes('--yes')) {
  console.error('Usage: node server/scripts/replace-network.js <devices.json> <routes.json> --yes');
  process.exit(1);
}
const devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ...(String(process.env.PGSSL) === 'true' ? { ssl: true } : {}),
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const t of ['notifications', 'maintenance_records', 'alerts', 'status_log', 'routes', 'devices']) {
      const r = await client.query(`DELETE FROM ${t}`);
      console.log(`deleted ${String(r.rowCount).padStart(5)} from ${t}`);
    }

    const d = await client.query(
      `INSERT INTO devices (device_id, operator_id, device_code, name, device_type, status, visibility,
                            install_date, geom, details, created_by, created_at, updated_at)
       OVERRIDING SYSTEM VALUE
       SELECT x.device_id, x.operator_id, x.device_code, x.name, x.device_type, x.status, x.visibility,
              x.install_date, ST_SetSRID(ST_GeomFromGeoJSON(x.geom::text), 4326), COALESCE(x.details, '{}'),
              x.created_by, x.created_at, x.updated_at
         FROM jsonb_to_recordset($1::jsonb) AS x(device_id int, operator_id int, device_code text, name text,
              device_type text, status text, visibility text, install_date date, geom jsonb, details jsonb,
              created_by int, created_at timestamptz, updated_at timestamptz)`,
      [JSON.stringify(devices)]);
    console.log(`inserted ${String(d.rowCount).padStart(5)} devices`);

    const r = await client.query(
      `INSERT INTO routes (route_id, operator_id, route_code, name, route_type, status, visibility,
                           total_fibres, spare_capacity_fibres, start_device_id, end_device_id,
                           install_date, geom, created_by, created_at, updated_at)
       OVERRIDING SYSTEM VALUE
       SELECT x.route_id, x.operator_id, x.route_code, x.name, x.route_type, x.status, x.visibility,
              x.total_fibres, x.spare_capacity_fibres, x.start_device_id, x.end_device_id,
              x.install_date, ST_SetSRID(ST_GeomFromGeoJSON(x.geom::text), 4326),
              x.created_by, x.created_at, x.updated_at
         FROM jsonb_to_recordset($1::jsonb) AS x(route_id int, operator_id int, route_code text, name text,
              route_type text, status text, visibility text, total_fibres int, spare_capacity_fibres int,
              start_device_id int, end_device_id int, install_date date, geom jsonb,
              created_by int, created_at timestamptz, updated_at timestamptz)`,
      [JSON.stringify(routes)]);
    console.log(`inserted ${String(r.rowCount).padStart(5)} routes`);

    // Move the ID counters past the loaded IDs so new rows don't collide
    for (const [t, col] of [['devices', 'device_id'], ['routes', 'route_id']]) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${t}', '${col}'), (SELECT COALESCE(MAX(${col}), 1) FROM ${t}))`);
    }
    await client.query('COMMIT');
    console.log('Done.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('Rolled back, nothing changed:', e.message); process.exit(1); });
