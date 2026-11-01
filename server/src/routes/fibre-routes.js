const express = require('express');
const { query, tx } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const { asyncHandler, HttpError, ENUMS } = H;

const router = express.Router();
const WRITERS = requireRole('field_technician', 'asset_manager');

const COLS = `r.route_id, r.route_code, r.name, r.route_type, r.status, r.visibility, r.total_fibres, r.spare_capacity_fibres,
              r.start_device_id, r.end_device_id, r.install_date, r.created_at, r.updated_at,
              round(ST_Length(r.geom::geography)::numeric, 0) AS length_m, ST_AsGeoJSON(r.geom)::json AS geometry`;

const feature = (r) => ({
  type: 'Feature', id: r.route_id, geometry: r.geometry,
  properties: { route_id: r.route_id, route_code: r.route_code, name: r.name, route_type: r.route_type, status: r.status, visibility: r.visibility,
                total_fibres: r.total_fibres, spare_capacity_fibres: r.spare_capacity_fibres, start_device_id: r.start_device_id,
                end_device_id: r.end_device_id, length_m: Number(r.length_m), install_date: r.install_date, created_at: r.created_at, updated_at: r.updated_at },
});

async function loadOwn(client, id, user) {
  const { rows } = await client.query(`SELECT ${COLS} FROM routes r WHERE r.route_id = $1 AND r.operator_id = $2`, [id, user.operatorId]);
  if (!rows[0]) throw new HttpError(404, 'Route not found');
  return rows[0];
}

async function ownDeviceId(client, ref, user) {
  if (ref === undefined || ref === null || ref === '') return null;
  const { rows } = await client.query('SELECT device_id FROM devices WHERE operator_id = $1 AND (device_id::text = $2 OR device_code = $2)', [user.operatorId, String(ref)]);
  if (!rows[0]) throw new HttpError(400, `Device ${ref} was not found among your devices`);
  return rows[0].device_id;
}

router.get('/', asyncHandler(async (req, res) => {
  const where = ['r.operator_id = $1'];
  const params = [req.user.operatorId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.type) add('r.route_type = ?', H.oneOf(req.query.type, ENUMS.routeType, 'type'));
  if (req.query.status) add('r.status = ?', H.oneOf(req.query.status, ENUMS.routeStatus, 'status'));
  if (req.query.visibility) add('r.visibility = ?', H.oneOf(req.query.visibility, ENUMS.visibility, 'visibility'));
  if (req.query.q) { params.push(`%${H.text(req.query.q, 'q', { max: 60 })}%`); where.push(`(r.name ILIKE $${params.length} OR r.route_code ILIKE $${params.length})`); }
  const box = H.bbox(req.query.bbox);
  if (box) { params.push(...box); where.push(`r.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`); }
  params.push(H.limit(req.query.limit));
  const { rows } = await query(`SELECT ${COLS} FROM routes r WHERE ${where.join(' AND ')} ORDER BY r.route_code LIMIT $${params.length}`, params);
  res.json({ type: 'FeatureCollection', features: rows.map(feature) });
}));

router.post('/', WRITERS, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const code = H.text(b.route_code, 'route_code', { min: 3, max: 40 });
  if (!/^[A-Za-z0-9._-]+$/.test(code)) throw new HttpError(400, 'route_code may contain letters, numbers, dot, dash and underscore only');
  const name = H.text(b.name, 'name', { max: 120 });
  const type = H.oneOf(b.route_type, ENUMS.routeType, 'route_type');
  const status = H.oneOf(b.status || 'active', ['active', 'planned'], 'status');
  const visibility = H.oneOf(b.visibility || 'private', ENUMS.visibility, 'visibility');
  const total = H.integer(b.total_fibres, 'total_fibres', { max: 10000 });
  const spare = H.integer(b.spare_capacity_fibres ?? 0, 'spare_capacity_fibres', { max: 10000 });
  if (spare > total) throw new HttpError(400, 'spare_capacity_fibres cannot be more than total_fibres');
  const install = H.dateOnly(b.install_date, 'install_date');
  const line = H.lineString(b.geometry);
  const row = await tx(req.user.id, async (c) => {
    const start = await ownDeviceId(c, b.start_device, req.user);
    const end = await ownDeviceId(c, b.end_device, req.user);
    const ins = await c.query(
      `INSERT INTO routes (operator_id, route_code, name, route_type, status, visibility, total_fibres, spare_capacity_fibres,
                           start_device_id, end_device_id, install_date, geom, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ST_SetSRID(ST_GeomFromGeoJSON($12),4326), $13) RETURNING route_id`,
      [req.user.operatorId, code, name, type, status, visibility, total, spare, start, end, install, JSON.stringify(line), req.user.id]);
    return loadOwn(c, ins.rows[0].route_id, req.user);
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
  if (b.total_fibres !== undefined) set('total_fibres', H.integer(b.total_fibres, 'total_fibres', { max: 10000 }));
  if (b.spare_capacity_fibres !== undefined) set('spare_capacity_fibres', H.integer(b.spare_capacity_fibres, 'spare_capacity_fibres', { max: 10000 }));
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const row = await tx(req.user.id, async (c) => {
    await loadOwn(c, id, req.user);
    params.push(id);
    await c.query(`UPDATE routes SET ${sets.join(', ')} WHERE route_id = $${params.length}`, params);
    return loadOwn(c, id, req.user);
  });
  res.json(feature(row));
}));

router.patch('/:id/status', WRITERS, asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  const status = H.oneOf((req.body || {}).status, ENUMS.routeStatus, 'status');
  const note = H.text((req.body || {}).note, 'note', { max: 500, optional: true });
  const row = await tx(req.user.id, async (c) => {
    const current = await loadOwn(c, id, req.user);
    if (status === 'cut' && current.status !== 'cut') throw new HttpError(400, 'To report a cut, raise an alert (POST /api/alerts) so the affected operators are told');
    if (current.status !== status) {
      await c.query('UPDATE routes SET status = $1 WHERE route_id = $2', [status, id]);
      if (note) await c.query('UPDATE status_log SET note = $1 WHERE log_id = (SELECT max(log_id) FROM status_log WHERE route_id = $2)', [note, id]);
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
       FROM status_log s LEFT JOIN users u ON u.user_id = s.recorded_by WHERE s.route_id = $1 ORDER BY s.log_id DESC LIMIT 200`, [id]);
  res.json(rows);
}));

module.exports = router;
