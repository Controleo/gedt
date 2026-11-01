const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const { asyncHandler } = H;

const router = express.Router();

function boxClause(req, params, alias) {
  const box = H.bbox(req.query.bbox);
  if (!box) return '';
  params.push(...box);
  return ` AND ${alias}.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`;
}

// Other operators' shared routes: limited fields only (FR12, NFR6)
router.get('/shared/routes', asyncHandler(async (req, res) => {
  const params = [req.user.operatorId];
  const sql = `SELECT route_id, operator_name, route_code, route_type, status, spare_capacity_fibres, ST_AsGeoJSON(geom)::json AS geometry
                 FROM v_routes_shared r WHERE operator_id <> $1${boxClause(req, params, 'r')} ORDER BY route_code LIMIT 5000`;
  const { rows } = await query(sql, params);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => ({
    type: 'Feature', id: r.route_id, geometry: r.geometry,
    properties: { route_id: r.route_id, operator_name: r.operator_name, route_code: r.route_code, route_type: r.route_type, status: r.status, spare_capacity_fibres: r.spare_capacity_fibres } })) });
}));

// Other operators' shared devices: location, type, owner and status only
router.get('/shared/devices', asyncHandler(async (req, res) => {
  const params = [req.user.operatorId];
  const sql = `SELECT device_id, operator_name, device_type, status, ST_AsGeoJSON(geom)::json AS geometry
                 FROM v_devices_shared d WHERE operator_id <> $1${boxClause(req, params, 'd')} ORDER BY device_id LIMIT 5000`;
  const { rows } = await query(sql, params);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => ({
    type: 'Feature', id: r.device_id, geometry: r.geometry,
    properties: { device_id: r.device_id, operator_name: r.operator_name, device_type: r.device_type, status: r.status } })) });
}));

// Free route view (FR13): shared, working routes with spare fibres
router.get('/free-routes', requireRole('asset_manager', 'decision_maker'), asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';
  if (String(req.query.include_own) !== 'true') { params.push(req.user.operatorId); where += ` AND operator_id <> $${params.length}`; }
  if (req.query.min_spare !== undefined) { params.push(H.integer(req.query.min_spare, 'min_spare', { max: 10000 })); where += ` AND spare_capacity_fibres >= $${params.length}`; }
  where += boxClause(req, params, 'f');
  const { rows } = await query(
    `SELECT route_id, operator_name, route_code, route_type, spare_capacity_fibres, total_fibres, length_m, ST_AsGeoJSON(geom)::json AS geometry
       FROM v_free_routes f ${where} ORDER BY spare_capacity_fibres DESC, route_code LIMIT 5000`, params);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => ({
    type: 'Feature', id: r.route_id, geometry: r.geometry,
    properties: { route_id: r.route_id, operator_name: r.operator_name, route_code: r.route_code, route_type: r.route_type,
                  spare_capacity_fibres: r.spare_capacity_fibres, total_fibres: r.total_fibres, length_m: Number(r.length_m) } })) });
}));

module.exports = router;
