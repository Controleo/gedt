const express = require('express');
const { query, tx } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const { asyncHandler, HttpError, ENUMS } = H;

const router = express.Router();
const WRITERS = requireRole('field_technician', 'asset_manager');

// A maintenance record belongs to the operator that owns its device or route
const SELECT = `SELECT m.record_id, m.device_id, m.route_id, m.alert_id, m.issue_type, m.status, m.notes, m.reported_at, m.resolved_at,
                       COALESCE(d.device_code, r.route_code) AS asset_code, CASE WHEN m.device_id IS NOT NULL THEN 'device' ELSE 'route' END AS asset_kind,
                       ru.full_name AS reported_by, su.full_name AS resolved_by
                  FROM maintenance_records m
                  LEFT JOIN devices d ON d.device_id = m.device_id
                  LEFT JOIN routes r ON r.route_id = m.route_id
                  LEFT JOIN users ru ON ru.user_id = m.reported_by
                  LEFT JOIN users su ON su.user_id = m.resolved_by`;
const OWN = 'COALESCE(d.operator_id, r.operator_id) = $1';

router.get('/', asyncHandler(async (req, res) => {
  const where = [OWN]; const params = [req.user.operatorId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.status) add('m.status = ?', H.oneOf(req.query.status, ENUMS.maintStatus, 'status'));
  if (req.query.issue_type) add('m.issue_type = ?', H.oneOf(req.query.issue_type, ENUMS.issueType, 'issue_type'));
  if (req.query.device_id) add('m.device_id = ?', H.integer(req.query.device_id, 'device_id', { min: 1 }));
  if (req.query.route_id) add('m.route_id = ?', H.integer(req.query.route_id, 'route_id', { min: 1 }));
  params.push(H.limit(req.query.limit, 200, 1000));
  const { rows } = await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY m.reported_at DESC LIMIT $${params.length}`, params);
  res.json(rows);
}));

router.post('/', WRITERS, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const hasDevice = b.device_id !== undefined && b.device_id !== null;
  const hasRoute = b.route_id !== undefined && b.route_id !== null;
  if (hasDevice === hasRoute) throw new HttpError(400, 'Give either device_id or route_id, not both and not neither');
  const issue = H.oneOf(b.issue_type, ENUMS.issueType, 'issue_type');
  const status = H.oneOf(b.status || 'open', ENUMS.maintStatus, 'status');
  const notes = H.text(b.notes, 'notes', { max: 1000, optional: true });
  const deviceId = hasDevice ? H.integer(b.device_id, 'device_id', { min: 1 }) : null;
  const routeId = hasRoute ? H.integer(b.route_id, 'route_id', { min: 1 }) : null;
  const record = await tx(req.user.id, async (c) => {
    const owner = await c.query(hasDevice ? 'SELECT 1 FROM devices WHERE device_id = $1 AND operator_id = $2' : 'SELECT 1 FROM routes WHERE route_id = $1 AND operator_id = $2',
      [hasDevice ? deviceId : routeId, req.user.operatorId]);
    if (!owner.rows[0]) throw new HttpError(404, hasDevice ? 'Device not found' : 'Route not found');
    const resolvedAt = status === 'resolved' ? new Date() : null;
    const ins = await c.query(
      `INSERT INTO maintenance_records (device_id, route_id, issue_type, status, notes, reported_by, resolved_by, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING record_id`,
      [deviceId, routeId, issue, status, notes, req.user.id, status === 'resolved' ? req.user.id : null, resolvedAt]);
    const { rows } = await c.query(`${SELECT} WHERE m.record_id = $2 AND ${OWN}`, [req.user.operatorId, ins.rows[0].record_id]);
    return rows[0];
  });
  res.status(201).json(record);
}));

router.patch('/:id/resolve', WRITERS, asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  const extra = H.text((req.body || {}).notes, 'notes', { max: 1000, optional: true });
  const record = await tx(req.user.id, async (c) => {
    const found = await c.query(`${SELECT} WHERE m.record_id = $2 AND ${OWN}`, [req.user.operatorId, id]);
    if (!found.rows[0]) throw new HttpError(404, 'Maintenance record not found');
    if (found.rows[0].status === 'resolved') throw new HttpError(409, 'This record is already resolved');
    await c.query(`UPDATE maintenance_records SET status = 'resolved', resolved_by = $1, resolved_at = now(),
                          notes = CASE WHEN $2::text IS NULL THEN notes ELSE concat_ws(E'\\n', notes, $2::text) END WHERE record_id = $3`, [req.user.id, extra, id]);
    const { rows } = await c.query(`${SELECT} WHERE m.record_id = $2 AND ${OWN}`, [req.user.operatorId, id]);
    return rows[0];
  });
  res.json(record);
}));

module.exports = router;
