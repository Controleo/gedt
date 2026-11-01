const express = require('express');
const { query, tx } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const config = require('../config');
const { sendPendingEmails } = require('../mailer');
const { asyncHandler, HttpError } = H;

const router = express.Router();

// Raises the alert through the database function. Used by technicians and by the simulated feed.
async function raiseAlert({ routeRef, lng, lat, source, userId, operatorId }) {
  return tx(userId, async (c) => {
    const params = [routeRef];
    let sql = 'SELECT route_id, operator_id, status FROM routes WHERE ';
    sql += /^\d+$/.test(String(routeRef)) ? 'route_id = $1::int' : 'route_code = $1';
    if (operatorId) { params.push(operatorId); sql += ' AND operator_id = $2'; }
    const found = await c.query(sql, params);
    const route = found.rows[0];
    if (!route) throw new HttpError(404, 'Route not found');
    const open = await c.query("SELECT 1 FROM alerts WHERE route_id = $1 AND status <> 'resolved'", [route.route_id]);
    if (open.rows[0]) throw new HttpError(409, 'This route already has an open alert');
    if (route.status === 'decommissioned' || route.status === 'planned') throw new HttpError(400, 'A route that is not in service cannot be cut');
    if (lng !== undefined && lng !== null) {
      const near = await c.query('SELECT ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, 200) AS ok FROM routes WHERE route_id = $1', [route.route_id, lng, lat]);
      if (!near.rows[0].ok) throw new HttpError(400, 'The cut location must be within 200 m of the route');
    }
    const hasPoint = lng !== undefined && lng !== null;
    const res = await c.query(
      `SELECT raise_fibre_cut_alert($1, $2, CASE WHEN $3::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326) END, $5, $6) AS alert_id`,
      [route.route_id, source, hasPoint ? lng : null, hasPoint ? lat : null, userId || null, config.corridorM]);
    return res.rows[0].alert_id;
  });
}

async function describe(alertId, operatorId) {
  const { rows } = await query(ALERT_SQL + ' AND a.alert_id = $2', [operatorId, alertId]);
  return rows[0];
}

// What an operator may know about an alert depends on its relation to it:
// owner = everything, connected device = owner and route, neighbour = generic warning and location only
const ALERT_SQL = `
  SELECT a.alert_id, a.status, a.severity, a.source, a.created_at, a.acknowledged_at, a.resolved_at,
         CASE WHEN r.operator_id = $1 THEN 'owner' ELSE n.reason END AS relation,
         CASE WHEN r.operator_id = $1 THEN a.message ELSE n.message END AS message,
         CASE WHEN r.operator_id = $1 OR n.reason = 'connected_device' THEN r.route_code END AS route_code,
         CASE WHEN r.operator_id = $1 OR n.reason = 'connected_device' THEN o.name END AS owner_name,
         ST_AsGeoJSON(a.cut_location)::json AS cut_location
    FROM alerts a
    JOIN routes r ON r.route_id = a.route_id
    JOIN operators o ON o.operator_id = r.operator_id
    LEFT JOIN LATERAL (SELECT reason, message FROM notifications
                        WHERE alert_id = a.alert_id AND recipient_operator_id = $1
                        ORDER BY notification_id LIMIT 1) n ON true
   WHERE (r.operator_id = $1 OR n.reason IS NOT NULL)`;

router.get('/', asyncHandler(async (req, res) => {
  const params = [req.user.operatorId];
  let extra = '';
  if (req.query.status) { params.push(H.oneOf(req.query.status, ['new', 'acknowledged', 'resolved'], 'status')); extra = ` AND a.status = $${params.length}`; }
  params.push(H.limit(req.query.limit, 200, 1000));
  const { rows } = await query(`${ALERT_SQL}${extra} ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
  res.json(rows);
}));

router.post('/', requireRole('field_technician', 'asset_manager'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.route_id === undefined && !b.route_code) throw new HttpError(400, 'Give route_id or route_code');
  let lng = null, lat = null;
  if (b.longitude !== undefined || b.latitude !== undefined) [lng, lat] = H.coordinate(b.longitude, b.latitude);
  const alertId = await raiseAlert({ routeRef: b.route_id ?? b.route_code, lng, lat, source: 'technician', userId: req.user.id, operatorId: req.user.operatorId });
  sendPendingEmails().catch(() => {});
  res.status(201).json(await describe(alertId, req.user.operatorId));
}));

async function ownAlert(client, id, user) {
  const { rows } = await client.query(
    'SELECT a.alert_id, a.status FROM alerts a JOIN routes r ON r.route_id = a.route_id WHERE a.alert_id = $1 AND r.operator_id = $2', [id, user.operatorId]);
  if (!rows[0]) throw new HttpError(404, 'Alert not found');
  return rows[0];
}

router.patch('/:id/acknowledge', requireRole('asset_manager', 'decision_maker'), asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  await tx(req.user.id, async (c) => {
    const a = await ownAlert(c, id, req.user);
    if (a.status !== 'new') throw new HttpError(409, `This alert is already ${a.status}`);
    await c.query("UPDATE alerts SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now() WHERE alert_id = $2", [req.user.id, id]);
  });
  res.json(await describe(id, req.user.operatorId));
}));

router.patch('/:id/resolve', requireRole('asset_manager', 'decision_maker'), asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  const notes = H.text((req.body || {}).notes, 'notes', { max: 1000, optional: true });
  await tx(req.user.id, async (c) => {
    const a = await ownAlert(c, id, req.user);
    if (a.status === 'resolved') throw new HttpError(409, 'This alert is already resolved');
    await c.query('SELECT resolve_alert($1, $2, $3)', [id, req.user.id, notes]);
  });
  res.json(await describe(id, req.user.operatorId));
}));

module.exports = router;
module.exports.raiseAlert = raiseAlert;
