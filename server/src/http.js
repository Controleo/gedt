class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ENUMS = {
  deviceType: ['tower', 'olt', 'pop', 'splice_enclosure', 'distribution_point'],
  deviceStatus: ['active', 'faulty', 'under_repair', 'vandalised', 'decommissioned'],
  routeType: ['backbone', 'feeder', 'distribution', 'drop'],
  routeStatus: ['active', 'cut', 'under_repair', 'planned', 'decommissioned'],
  visibility: ['private', 'shared'],
  issueType: ['fibre_cut', 'equipment_fault', 'vandalism', 'theft', 'power_failure', 'routine_inspection', 'other'],
  maintStatus: ['open', 'in_progress', 'resolved'],
  role: ['field_technician', 'asset_manager', 'gis_admin', 'decision_maker'],
};

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function text(value, name, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new HttpError(400, `${name} is required`);
  }
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text`);
  const v = value.trim();
  if (v.length < min || v.length > max) throw new HttpError(400, `${name} must be ${min} to ${max} characters`);
  return v;
}

function integer(value, name, { min = 0, max = 1000000, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new HttpError(400, `${name} is required`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`);
  return n;
}

function coordinate(lng, lat) {
  const x = Number(lng), y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) {
    throw new HttpError(400, 'Coordinates must be numbers: longitude -180 to 180 and latitude -90 to 90');
  }
  return [x, y];
}

function lineString(geometry) {
  if (!geometry || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || geometry.coordinates.length > 5000) {
    throw new HttpError(400, 'geometry must be a GeoJSON LineString with 2 to 5000 positions');
  }
  return { type: 'LineString', coordinates: geometry.coordinates.map((c) => coordinate(c[0], c[1])) };
}

function dateOnly(value, name, optional = true) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new HttpError(400, `${name} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) throw new HttpError(400, `${name} must be a date like 2026-10-31`);
  return value;
}

function bbox(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new HttpError(400, 'bbox must be minLng,minLat,maxLng,maxLat');
  return parts;
}

function limit(value, def = 1000, max = 5000) {
  const n = value === undefined ? def : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'limit must be a positive whole number');
  return Math.min(n, max);
}

// Spreadsheet programs run text that starts with = + - @ as a formula, so defuse it.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(columns, rows) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  const map = { '23505': [409, 'A record with that value already exists'], '23503': [400, 'A referenced record does not exist'], '23514': [400, 'A value breaks a data rule'], '22P02': [400, 'A value has the wrong format'], '22023': [400, 'A value is not allowed'], 'XX000': [400, 'The request could not be processed'] };
  if (err && map[err.code]) return res.status(map[err.code][0]).json({ error: map[err.code][1] });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on the server' });
}

module.exports = { HttpError, asyncHandler, ENUMS, oneOf, text, integer, coordinate, lineString, dateOnly, bbox, limit, toCsv, errorHandler };
