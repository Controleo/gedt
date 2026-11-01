const express = require('express');
const { query, tx } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const { asyncHandler, HttpError, ENUMS } = H;

const router = express.Router();
const WRITERS = requireRole('field_technician', 'asset_manager');

const COLS = `d.device_id, d.device_code, d.name, d.device_type, d.status, d.visibility, d.install_date, d.details,
              d.created_at, d.updated_at, ST_AsGeoJSON(d.geom)::json AS geometry`;

const feature = (r) => ({
  type: 'Feature', id: r.device_id, geometry: r.geometry,
  properties: { device_id: r.device_id, device_code: r.device_code, name: r.name, device_type: r.device_type, status: r.status,
                visibility: r.visibility, install_date: r.install_date, details: r.details, created_at: r.created_at, updated_at: r.updated_at },
});

async function loadOwn(client, id, user) {
  const { rows } = await client.query(`SELECT ${COLS} FROM devices d WHERE d.device_id = $1 AND d.operator_id = $2`, [id, user.operatorId]);
  if (!rows[0]) throw new HttpError(404, 'Device not found');
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const where = ['d.operator_id = $1'];
  const params = [req.user.operatorId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.type) add('d.device_type = ?', H.oneOf(req.query.type, ENUMS.deviceType, 'type'));
  if (req.query.status) add('d.status = ?', H.oneOf(req.query.status, ENUMS.deviceStatus, 'status'));
  if (req.query.visibility) add('d.visibility = ?', H.oneOf(req.query.visibility, ENUMS.visibility, 'visibility'));
  if (req.query.q) { params.push(`%${H.text(req.query.q, 'q', { max: 60 })}%`); where.push(`(d.name ILIKE $${params.length} OR d.device_code ILIKE $${params.length})`); }
  const box = H.bbox(req.query.bbox);
  if (box) { params.push(...box); where.push(`d.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`); }
  params.push(H.limit(req.query.limit));
  const { rows } = await query(`SELECT ${COLS} FROM devices d WHERE ${where.join(' AND ')} ORDER BY d.device_code LIMIT $${params.length}`, params);
  res.json({ type: 'FeatureCollection', features: rows.map(feature) });
}));

router.post('/', WRITERS, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const code = H.text(b.device_code, 'device_code', { min: 3, max: 40 });
  if (!/^[A-Za-z0-9._-]+$/.test(code)) throw new HttpError(400, 'device_code may contain letters, numbers, dot, dash and underscore only');
  const name = H.text(b.name, 'name', { max: 120 });
  const type = H.oneOf(b.device_type, ENUMS.deviceType, 'device_type');
  const status = H.oneOf(b.status || 'active', ENUMS.deviceStatus, 'status');
  const visibility = H.oneOf(b.visibility || 'private', ENUMS.visibility, 'visibility');
  const install = H.dateOnly(b.install_date, 'install_date');
  const [lng, lat] = H.coordinate(b.longitude, b.latitude);
  const details = b.details && typeof b.details === 'object' && !Array.isArray(b.details) ? b.details : {};
  const row = await tx(req.user.id, async (c) => {
    const ins = await c.query(
      `INSERT INTO devices (operator_id, device_code, name, device_type, status, visibility, install_date, geom, details, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7, ST_SetSRID(ST_MakePoint($8,$9),4326), $10, $11) RETURNING device_id`,
      [req.user.operatorId, code, name, type, status, visibility, install, lng, lat, details, req.user.id]);
    return loadOwn(c, ins.rows[0].device_id, req.user);
  });
  res.status(201).json(feature(row));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(feature(await loadOwn({ query }, H.integer(req.params.id, 'id', { min: 1 }), req.user)));
}));

router.patch('/:id', WRITERS, asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  const sets = []; const params = [];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (b.name !== undefined) set('name', H.text(b.name, 'name', { max: 120 }));
  if (b.visibility !== undefined) set('visibility', H.oneOf(b.visibility, ENUMS.visibility, 'visibility'));
  if (b.install_date !== undefined) set('install_date', H.dateOnly(b.install_date, 'install_date'));
  if (b.details !== undefined) {
    if (!b.details || typeof b.details !== 'object' || Array.isArray(b.details)) throw new HttpError(400, 'details must be an object');
    set('details', b.details);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const row = await tx(req.user.id, async (c) => {
    await loadOwn(c, id, req.user);
    params.push(id);
    await c.query(`UPDATE devices SET ${sets.join(', ')} WHERE device_id = $${params.length}`, params);
    return loadOwn(c, id, req.user);
  });
  res.json(feature(row));
}));

router.patch('/:id/status', WRITERS, asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  const status = H.oneOf((req.body || {}).status, ENUMS.deviceStatus, 'status');
  const note = H.text((req.body || {}).note, 'note', { max: 500, optional: true });
  const row = await tx(req.user.id, async (c) => {
    const current = await loadOwn(c, id, req.user);
    if (current.status !== status) {
      await c.query('UPDATE devices SET status = $1 WHERE device_id = $2', [status, id]);
      if (note) await c.query('UPDATE status_log SET note = $1 WHERE log_id = (SELECT max(log_id) FROM status_log WHERE device_id = $2)', [note, id]);
    }
    return loadOwn(c, id, req.user);
  });
  res.json(feature(row));
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  await loadOwn({ query }, id, req.user);
  const { rows } = await query(
    `SELECT s.log_id, s.old_status, s.new_status, s.note, s.recorded_at, u.full_name AS recorded_by
       FROM status_log s LEFT JOIN users u ON u.user_id = s.recorded_by WHERE s.device_id = $1 ORDER BY s.log_id DESC LIMIT 200`, [id]);
  res.json(rows);
}));

module.exports = router;
