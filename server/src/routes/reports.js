const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const { asyncHandler, HttpError, ENUMS } = H;

const router = express.Router();
const READERS = requireRole('asset_manager', 'decision_maker');

function send(res, format, columns, rows, name) {
  if (format === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(H.toCsv(columns, rows));
  }
  return res.json(rows);
}

const format = (req) => H.oneOf(String(req.query.format || 'json'), ['json', 'csv'], 'format');

// Maintenance report by asset, location or period (FR6)
router.get('/reports/maintenance', READERS, asyncHandler(async (req, res) => {
  const fmt = format(req);
  const where = ['COALESCE(d.operator_id, r.operator_id) = $1']; const params = [req.user.operatorId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  const from = H.dateOnly(req.query.from, 'from'); const to = H.dateOnly(req.query.to, 'to');
  if (from) add('m.reported_at >= ?::date', from);
  if (to) add("m.reported_at < (?::date + interval '1 day')", to);
  if (req.query.status) add('m.status = ?', H.oneOf(req.query.status, ENUMS.maintStatus, 'status'));
  if (req.query.issue_type) add('m.issue_type = ?', H.oneOf(req.query.issue_type, ENUMS.issueType, 'issue_type'));
  if (req.query.asset_kind) {
    const kind = H.oneOf(req.query.asset_kind, ['device', 'route'], 'asset_kind');
    where.push(kind === 'device' ? 'm.device_id IS NOT NULL' : 'm.route_id IS NOT NULL');
  }
  const box = H.bbox(req.query.bbox);
  if (box) { params.push(...box); where.push(`COALESCE(d.geom, r.geom) && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`); }
  params.push(H.limit(req.query.limit, 1000, 10000));
  const { rows } = await query(
    `SELECT m.record_id, CASE WHEN m.device_id IS NOT NULL THEN 'device' ELSE 'route' END AS asset_kind, COALESCE(d.device_code, r.route_code) AS asset_code,
            m.issue_type, m.status, m.notes, m.reported_at, ru.full_name AS reported_by, m.resolved_at
       FROM maintenance_records m
       LEFT JOIN devices d ON d.device_id = m.device_id LEFT JOIN routes r ON r.route_id = m.route_id
       LEFT JOIN users ru ON ru.user_id = m.reported_by
      WHERE ${where.join(' AND ')} ORDER BY m.reported_at DESC LIMIT $${params.length}`, params);
  send(res, fmt, ['record_id', 'asset_kind', 'asset_code', 'issue_type', 'status', 'notes', 'reported_at', 'reported_by', 'resolved_at'], rows, 'maintenance-report');
}));

// Dashboard numbers (FR7)
router.get('/dashboard', READERS, asyncHandler(async (req, res) => {
  const op = req.user.operatorId;
  const [counts, maint, alerts, mine, unread, free] = await Promise.all([
    query('SELECT asset_kind, asset_type, status, total::int FROM v_asset_counts WHERE operator_id = $1 ORDER BY 1, 2, 3', [op]),
    query(`SELECT m.status, m.issue_type, count(*)::int AS total
             FROM maintenance_records m LEFT JOIN devices d ON d.device_id = m.device_id LEFT JOIN routes r ON r.route_id = m.route_id
            WHERE COALESCE(d.operator_id, r.operator_id) = $1 AND m.reported_at >= now() - interval '90 days'
            GROUP BY 1, 2 ORDER BY 1, 2`, [op]),
    query(`SELECT a.status, count(*)::int AS total FROM alerts a JOIN routes r ON r.route_id = a.route_id WHERE r.operator_id = $1 GROUP BY 1`, [op]),
    query(`SELECT count(*)::int AS total FROM alerts a LEFT JOIN LATERAL (SELECT 1 AS hit FROM notifications n WHERE n.alert_id = a.alert_id AND n.recipient_operator_id = $1 LIMIT 1) n ON true
            JOIN routes r ON r.route_id = a.route_id WHERE a.status <> 'resolved' AND (r.operator_id = $1 OR n.hit = 1)`, [op]),
    query("SELECT count(*)::int AS total FROM notifications WHERE recipient_user_id = $1 AND channel = 'in_app' AND read_at IS NULL", [req.user.id]),
    query('SELECT count(*)::int AS routes, COALESCE(sum(spare_capacity_fibres), 0)::int AS spare_fibres FROM v_free_routes WHERE operator_id <> $1', [op]),
  ]);
  res.json({
    assets: counts.rows,
    maintenance_last_90_days: maint.rows,
    alerts_by_status: alerts.rows,
    open_alerts_relevant_to_me: mine.rows[0].total,
    unread_notifications: unread.rows[0].total,
    free_routes_from_other_operators: free.rows[0],
  });
}));

// Export (FR11)
router.get('/export/devices', READERS, asyncHandler(async (req, res) => {
  const fmt = H.oneOf(String(req.query.format || 'geojson'), ['geojson', 'csv'], 'format');
  const { rows } = await query(
    `SELECT device_id, device_code, name, device_type, status, visibility, install_date, ST_X(geom) AS longitude, ST_Y(geom) AS latitude, ST_AsGeoJSON(geom)::json AS geometry
       FROM devices WHERE operator_id = $1 ORDER BY device_code`, [req.user.operatorId]);
  if (fmt === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="devices.csv"');
    return res.send(H.toCsv(['device_id', 'device_code', 'name', 'device_type', 'status', 'visibility', 'install_date', 'longitude', 'latitude'], rows));
  }
  res.set('Content-Type', 'application/geo+json; charset=utf-8');
  res.json({ type: 'FeatureCollection', features: rows.map(({ geometry, longitude, latitude, ...props }) => ({ type: 'Feature', id: props.device_id, geometry, properties: props })) });
}));

router.get('/export/routes', READERS, asyncHandler(async (req, res) => {
  const fmt = H.oneOf(String(req.query.format || 'geojson'), ['geojson', 'csv'], 'format');
  const { rows } = await query(
    `SELECT route_id, route_code, name, route_type, status, visibility, total_fibres, spare_capacity_fibres, install_date,
            round(ST_Length(geom::geography)::numeric, 0) AS length_m, ST_AsText(geom) AS wkt, ST_AsGeoJSON(geom)::json AS geometry
       FROM routes WHERE operator_id = $1 ORDER BY route_code`, [req.user.operatorId]);
  if (fmt === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="routes.csv"');
    return res.send(H.toCsv(['route_id', 'route_code', 'name', 'route_type', 'status', 'visibility', 'total_fibres', 'spare_capacity_fibres', 'install_date', 'length_m', 'wkt'], rows));
  }
  res.set('Content-Type', 'application/geo+json; charset=utf-8');
  res.json({ type: 'FeatureCollection', features: rows.map(({ geometry, wkt, ...props }) => ({ type: 'Feature', id: props.route_id, geometry, properties: props })) });
}));

module.exports = router;
