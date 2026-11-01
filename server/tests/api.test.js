// Automated API tests. They map to the planned test cases in Chapter 3 (Table 3.13).
// Run with:  npm test        (needs PostgreSQL with PostGIS running; builds the gedt_test database)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gedt_test';
process.env.SIM_FEED_KEY = 'test-feed-key';
process.env.EMAIL_MODE = 'console';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadDatabase } = require('../scripts/load-db');
const { createApp } = require('../src/app');
const { pool } = require('../src/db');
const { sendPendingEmails } = require('../src/mailer');

const PASSWORD = 'Demo@12345';
const USERS = {
  lagAM: 'tunde.bakare@lagoon-telecom.example', lagFT: 'chinedu.eze@lagoon-telecom.example',
  lagDM: 'femi.adeyemi@lagoon-telecom.example', lagAdmin: 'adaeze.okafor@lagoon-telecom.example',
  harAM: 'ibrahim.danjuma@harmattan-networks.example', harFT: 'emeka.nwosu@harmattan-networks.example',
  harDM: 'yusuf.garba@harmattan-networks.example', harAdmin: 'hauwa.bello@harmattan-networks.example',
  savAM: 'kunle.ogunleye@savanna-fibre.example',
};
const T = {};
let server, base;

async function api(method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const codes = (fc, key) => fc.features.map((f) => f.properties[key]);

before(async () => {
  await loadDatabase(process.env.DATABASE_URL);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(USERS)) {
    const r = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(r.status, 200, `login for ${k}`);
    T[k] = r.body.token;
  }
});
after(async () => { server.close(); await pool.end(); });

describe('Authentication and roles', () => {
  it('rejects a wrong password and an unknown email with the same message', async () => {
    const a = await api('POST', '/api/auth/login', { body: { email: USERS.lagAM, password: 'wrong' } });
    const b = await api('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'wrong' } });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error);
  });
  it('requires a valid token', async () => {
    assert.equal((await api('GET', '/api/devices')).status, 401);
    assert.equal((await api('GET', '/api/devices', { token: T.lagAM + 'x' })).status, 401);
  });
  it('returns the signed-in user', async () => {
    const r = await api('GET', '/api/auth/me', { token: T.lagFT });
    assert.equal(r.body.role, 'field_technician'); assert.equal(r.body.operatorName, 'Lagoon Telecom');
  });
  it('TC5: a field technician cannot open user management', async () => {
    assert.equal((await api('GET', '/api/admin/users', { token: T.lagFT })).status, 403);
  });
  it('hides server details and handles bad JSON', async () => {
    const r = await api('POST', '/api/auth/login', { raw: '{bad json' });
    assert.equal(r.status, 400); assert.equal(r.headers.get('x-powered-by'), null);
  });
});

describe('Devices (TC1, TC3, TC17)', () => {
  let deviceId;
  it('TC1: registers a device as a point', async () => {
    const r = await api('POST', '/api/devices', { token: T.lagFT, body: { device_code: 'LAG-TEST-01', name: 'Test enclosure', device_type: 'splice_enclosure', longitude: 3.38, latitude: 6.52 } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.geometry.coordinates, [3.38, 6.52]);
    assert.equal(r.body.properties.status, 'active'); assert.equal(r.body.properties.visibility, 'private');
    deviceId = r.body.id;
  });
  it('rejects duplicates and invalid values', async () => {
    const base = { device_code: 'LAG-TEST-02', name: 'X', device_type: 'tower', longitude: 3.4, latitude: 6.5 };
    assert.equal((await api('POST', '/api/devices', { token: T.lagFT, body: { ...base, device_code: 'LAG-TEST-01' } })).status, 409);
    assert.equal((await api('POST', '/api/devices', { token: T.lagFT, body: { ...base, device_type: 'router' } })).status, 400);
    assert.equal((await api('POST', '/api/devices', { token: T.lagFT, body: { ...base, latitude: 95 } })).status, 400);
    assert.equal((await api('POST', '/api/devices', { token: T.lagFT, body: { ...base, device_code: 'bad code!' } })).status, 400);
  });
  it('only technicians and asset managers can register', async () => {
    const body = { device_code: 'LAG-TEST-03', name: 'X', device_type: 'tower', longitude: 3.4, latitude: 6.5 };
    assert.equal((await api('POST', '/api/devices', { token: T.lagDM, body })).status, 403);
    assert.equal((await api('POST', '/api/devices', { token: T.lagAdmin, body })).status, 403);
  });
  it('TC3: a status change is logged with the user, note and audit entry', async () => {
    const r = await api('PATCH', `/api/devices/${deviceId}/status`, { token: T.lagFT, body: { status: 'faulty', note: 'Power fault' } });
    assert.equal(r.status, 200); assert.equal(r.body.properties.status, 'faulty');
    const h = await api('GET', `/api/devices/${deviceId}/history`, { token: T.lagAM });
    assert.equal(h.body[0].new_status, 'faulty'); assert.equal(h.body[0].recorded_by, 'Chinedu Eze'); assert.equal(h.body[0].note, 'Power fault');
    const a = await api('GET', `/api/admin/audit?table=devices&record_id=${deviceId}`, { token: T.lagAdmin });
    assert.ok(a.body.some((x) => x.action === 'UPDATE' && x.new_data.status === 'faulty' && x.performed_by === 'Chinedu Eze'));
  });
  it('rejects an unknown status', async () => {
    assert.equal((await api('PATCH', `/api/devices/${deviceId}/status`, { token: T.lagFT, body: { status: 'broken' } })).status, 400);
  });
  it('TC17: malicious text is stored as text and breaks nothing', async () => {
    const evil = "x'); DROP TABLE devices;--";
    const r = await api('POST', '/api/devices', { token: T.lagFT, body: { device_code: 'LAG-SQLI-01', name: evil, device_type: 'tower', longitude: 3.4, latitude: 6.5 } });
    assert.equal(r.status, 201); assert.equal(r.body.properties.name, evil);
    const list = await api('GET', "/api/devices?q=%27%20OR%201%3D1%20--", { token: T.lagFT });
    assert.equal(list.status, 200); assert.equal(list.body.features.length, 0);
    assert.equal((await api('GET', '/api/devices', { token: T.lagFT })).status, 200);
  });
  it('searches and filters', async () => {
    const r = await api('GET', '/api/devices?type=tower&status=active&q=tower', { token: T.lagFT });
    assert.equal(r.status, 200);
    assert.ok(r.body.features.every((f) => f.properties.device_type === 'tower' && f.properties.status === 'active'));
  });
});

describe('Routes, sharing and free routes (TC2, TC6, TC7, TC8)', () => {
  const line = { type: 'LineString', coordinates: [[3.38, 6.52], [3.381, 6.521]] };
  it('TC2: registers a route as a line with its end devices', async () => {
    const r = await api('POST', '/api/routes', { token: T.lagAM, body: { route_code: 'LAG-TEST-R1', name: 'Shared test route', route_type: 'distribution', total_fibres: 24, spare_capacity_fibres: 6, visibility: 'shared', start_device: 'LAG-TEST-01', geometry: line } });
    assert.equal(r.status, 201); assert.equal(r.body.geometry.type, 'LineString'); assert.ok(r.body.properties.length_m > 0);
    assert.ok(r.body.properties.start_device_id);
    const p = await api('POST', '/api/routes', { token: T.lagAM, body: { route_code: 'LAG-TEST-R2', name: 'Private test route', route_type: 'distribution', total_fibres: 12, spare_capacity_fibres: 4, visibility: 'private', geometry: line } });
    assert.equal(p.status, 201);
  });
  it('rejects bad routes', async () => {
    const ok = { route_code: 'LAG-TEST-R3', name: 'X', route_type: 'feeder', total_fibres: 12, spare_capacity_fibres: 2, geometry: line };
    assert.equal((await api('POST', '/api/routes', { token: T.lagAM, body: { ...ok, spare_capacity_fibres: 13 } })).status, 400);
    assert.equal((await api('POST', '/api/routes', { token: T.lagAM, body: { ...ok, geometry: { type: 'Point', coordinates: [3, 6] } } })).status, 400);
    assert.equal((await api('POST', '/api/routes', { token: T.lagAM, body: { ...ok, start_device: 'HAR-IKR-01' } })).status, 400);
  });
  it('TC6: another operator cannot read or change private records', async () => {
    const mine = await api('GET', '/api/routes?q=LAG-TEST-R2', { token: T.lagAM });
    const id = mine.body.features[0].id;
    assert.equal((await api('GET', `/api/routes/${id}`, { token: T.harAM })).status, 404);
    assert.equal((await api('PATCH', `/api/routes/${id}/status`, { token: T.harAM, body: { status: 'under_repair' } })).status, 404);
    const list = await api('GET', '/api/routes', { token: T.harAM });
    assert.ok(codes(list.body, 'route_code').every((c) => c.startsWith('HAR-')));
    const dev = await api('GET', '/api/devices', { token: T.harAM });
    assert.ok(codes(dev.body, 'device_code').every((c) => c.startsWith('HAR-')));
  });
  it('TC7: the shared view shows other operators\' shared routes with limited fields', async () => {
    const r = await api('GET', '/api/shared/routes', { token: T.harAM });
    assert.equal(r.status, 200);
    const names = codes(r.body, 'route_code');
    assert.ok(names.includes('LAG-TEST-R1')); assert.ok(!names.includes('LAG-TEST-R2'));
    assert.ok(names.every((c) => !c.startsWith('HAR-')));
    assert.deepEqual(Object.keys(r.body.features[0].properties).sort(), ['operator_name', 'route_code', 'route_id', 'route_type', 'spare_capacity_fibres', 'status']);
    const d = await api('GET', '/api/shared/devices', { token: T.harAM });
    assert.deepEqual(Object.keys(d.body.features[0].properties).sort(), ['device_id', 'device_type', 'operator_name', 'status']);
  });
  it('TC8: the free route view lists only shared, working routes with spare fibres', async () => {
    const r = await api('GET', '/api/free-routes', { token: T.harDM });
    assert.equal(r.status, 200); assert.ok(r.body.features.length > 0);
    assert.ok(r.body.features.every((f) => f.properties.spare_capacity_fibres > 0 && f.properties.operator_name !== 'Harmattan Networks'));
    assert.ok(codes(r.body, 'route_code').includes('LAG-TEST-R1'));
    assert.ok(!codes(r.body, 'route_code').includes('LAG-TEST-R2'));
    const big = await api('GET', '/api/free-routes?min_spare=30', { token: T.harDM });
    assert.ok(big.body.features.every((f) => f.properties.spare_capacity_fibres >= 30));
    assert.equal((await api('GET', '/api/free-routes', { token: T.harFT })).status, 403);
  });
  it('a route cannot be marked cut by a plain status change', async () => {
    const mine = await api('GET', '/api/routes?q=LAG-TEST-R2', { token: T.lagAM });
    assert.equal((await api('PATCH', `/api/routes/${mine.body.features[0].id}/status`, { token: T.lagAM, body: { status: 'cut' } })).status, 400);
  });
});

describe('Maintenance and reports (TC4, TC15)', () => {
  let recordId, deviceId;
  before(async () => { deviceId = (await api('GET', '/api/devices?q=LAG-TEST-01', { token: T.lagAM })).body.features[0].id; });
  it('TC4: an asset manager logs maintenance; a decision maker cannot', async () => {
    const r = await api('POST', '/api/maintenance', { token: T.lagAM, body: { device_id: deviceId, issue_type: 'equipment_fault', notes: 'Replace power unit' } });
    assert.equal(r.status, 201); assert.equal(r.body.status, 'open'); assert.equal(r.body.reported_by, 'Tunde Bakare');
    recordId = r.body.record_id;
    assert.equal((await api('POST', '/api/maintenance', { token: T.lagDM, body: { device_id: deviceId, issue_type: 'other' } })).status, 403);
  });
  it('rejects records for another operator\'s asset or for both asset types', async () => {
    assert.equal((await api('POST', '/api/maintenance', { token: T.harAM, body: { device_id: deviceId, issue_type: 'other' } })).status, 404);
    assert.equal((await api('POST', '/api/maintenance', { token: T.lagAM, body: { device_id: deviceId, route_id: 1, issue_type: 'other' } })).status, 400);
  });
  it('resolves a record once', async () => {
    const r = await api('PATCH', `/api/maintenance/${recordId}/resolve`, { token: T.lagFT, body: { notes: 'Unit replaced' } });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'resolved'); assert.match(r.body.notes, /Unit replaced/);
    assert.equal((await api('PATCH', `/api/maintenance/${recordId}/resolve`, { token: T.lagFT })).status, 409);
  });
  it('TC15: the report filters by period and exports CSV', async () => {
    const r = await api('GET', '/api/reports/maintenance?from=2020-01-01&to=2099-12-31', { token: T.lagAM });
    assert.equal(r.status, 200); assert.ok(r.body.some((x) => x.record_id === recordId));
    const none = await api('GET', '/api/reports/maintenance?from=2019-01-01&to=2019-01-31', { token: T.lagAM });
    assert.equal(none.body.length, 0);
    const csv = await api('GET', '/api/reports/maintenance?format=csv', { token: T.lagDM });
    assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.body, /^record_id,asset_kind,asset_code/);
    assert.equal((await api('GET', '/api/reports/maintenance?from=31-12-2026', { token: T.lagAM })).status, 400);
    assert.equal((await api('GET', '/api/reports/maintenance', { token: T.lagFT })).status, 403);
  });
});

describe('Fibre cut alerts (TC9 to TC13)', () => {
  let alertId, routeId;
  it('TC9: a technician raises a cut and the owner is notified', async () => {
    routeId = (await api('GET', '/api/routes?q=LAG-MIL-BB-01', { token: T.lagFT })).body.features[0].id;
    const r = await api('POST', '/api/alerts', { token: T.lagFT, body: { route_code: 'LAG-MIL-BB-01' } });
    assert.equal(r.status, 201); assert.equal(r.body.status, 'new'); assert.equal(r.body.relation, 'owner'); assert.equal(r.body.source, 'technician');
    alertId = r.body.alert_id;
    const route = await api('GET', `/api/routes/${routeId}`, { token: T.lagAM });
    assert.equal(route.body.properties.status, 'cut');
    const n = await api('GET', '/api/notifications?unread=true', { token: T.lagAM });
    assert.ok(n.body.some((x) => x.alert_id === alertId && x.reason === 'owner'));
    assert.equal((await api('POST', '/api/alerts', { token: T.lagFT, body: { route_code: 'LAG-MIL-BB-01' } })).status, 409);
  });
  it('TC10 and TC11: a neighbour 35 m away gets a generic warning, one 180 m away hears nothing', async () => {
    const har = await api('GET', '/api/alerts', { token: T.harAM });
    const a = har.body.find((x) => x.alert_id === alertId);
    assert.ok(a, 'Harmattan should see the alert');
    assert.equal(a.relation, 'corridor_neighbour');
    assert.equal(a.route_code, null); assert.equal(a.owner_name, null);
    assert.doesNotMatch(a.message, /Lagoon|LAG-MIL/);
    const sav = await api('GET', '/api/alerts', { token: T.savAM });
    assert.ok(!sav.body.some((x) => x.alert_id === alertId));
    const n = await api('GET', '/api/notifications', { token: T.harAM });
    assert.ok(n.body.some((x) => x.alert_id === alertId && x.reason === 'corridor_neighbour'));
  });
  it('a neighbour cannot acknowledge or resolve the owner\'s alert', async () => {
    assert.equal((await api('PATCH', `/api/alerts/${alertId}/acknowledge`, { token: T.harAM })).status, 404);
    assert.equal((await api('PATCH', `/api/alerts/${alertId}/resolve`, { token: T.harAM })).status, 404);
    assert.equal((await api('PATCH', `/api/alerts/${alertId}/acknowledge`, { token: T.lagFT })).status, 403);
  });
  it('queued alert emails are delivered', async () => {
    await sendPendingEmails();
    const left = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE channel = 'email' AND delivered_at IS NULL");
    assert.equal(left.rows[0].n, 0);
  });
  it('the owner acknowledges, then TC13: resolves, restoring the route and recording the repair', async () => {
    const ack = await api('PATCH', `/api/alerts/${alertId}/acknowledge`, { token: T.lagDM });
    assert.equal(ack.status, 200); assert.equal(ack.body.status, 'acknowledged');
    assert.equal((await api('PATCH', `/api/alerts/${alertId}/acknowledge`, { token: T.lagDM })).status, 409);
    const res = await api('PATCH', `/api/alerts/${alertId}/resolve`, { token: T.lagAM, body: { notes: 'Spliced and tested' } });
    assert.equal(res.status, 200); assert.equal(res.body.status, 'resolved');
    const route = await api('GET', `/api/routes/${routeId}`, { token: T.lagAM });
    assert.equal(route.body.properties.status, 'active');
    const m = await api('GET', '/api/maintenance?route_id=' + routeId, { token: T.lagAM });
    assert.ok(m.body.some((x) => x.alert_id === alertId && x.status === 'resolved' && /Spliced/.test(x.notes)));
  });
  it('a cut location far from the route is rejected', async () => {
    const r = await api('POST', '/api/alerts', { token: T.lagFT, body: { route_code: 'LAG-LEK-BB-01', longitude: 3.9, latitude: 6.9 } });
    assert.equal(r.status, 400);
  });
  it('a technician cannot raise a cut on another operator\'s route', async () => {
    assert.equal((await api('POST', '/api/alerts', { token: T.harFT, body: { route_code: 'LAG-LEK-BB-01' } })).status, 404);
  });
  it('TC12: the simulated feed needs its key and raises an alert', async () => {
    assert.equal((await api('POST', '/api/simulate/cut', { body: { route_code: 'HAR-IKR-BB-01' } })).status, 401);
    assert.equal((await api('POST', '/api/simulate/cut', { headers: { 'X-Feed-Key': 'wrong' }, body: { route_code: 'HAR-IKR-BB-01' } })).status, 401);
    const ok = await api('POST', '/api/simulate/cut', { headers: { 'X-Feed-Key': 'test-feed-key' }, body: { route_code: 'HAR-IKR-BB-01' } });
    assert.equal(ok.status, 201); assert.equal(ok.body.source, 'simulated_feed');
    const list = await api('GET', '/api/alerts?status=new', { token: T.harAM });
    assert.ok(list.body.some((x) => x.alert_id === ok.body.alert_id && x.source === 'simulated_feed' && x.relation === 'owner'));
    assert.equal((await api('POST', '/api/simulate/cut', { headers: { 'X-Feed-Key': 'test-feed-key' }, body: { route_code: 'NOPE-1' } })).status, 404);
  });
  it('marks a notification as read', async () => {
    const n = await api('GET', '/api/notifications?unread=true', { token: T.lagAM });
    assert.ok(n.body.length > 0);
    const r = await api('PATCH', `/api/notifications/${n.body[0].notification_id}/read`, { token: T.lagAM });
    assert.equal(r.status, 200); assert.ok(r.body.read_at);
    assert.equal((await api('PATCH', `/api/notifications/${n.body[0].notification_id}/read`, { token: T.harAM })).status, 404);
  });
});

describe('Dashboard and export (TC14)', () => {
  it('shows dashboard figures to managers and decision makers only', async () => {
    const r = await api('GET', '/api/dashboard', { token: T.lagAM });
    assert.equal(r.status, 200); assert.ok(r.body.assets.length > 0); assert.ok('unread_notifications' in r.body);
    assert.equal((await api('GET', '/api/dashboard', { token: T.lagFT })).status, 403);
  });
  it('TC14: exports valid GeoJSON and CSV', async () => {
    const g = await api('GET', '/api/export/devices', { token: T.lagAM });
    assert.equal(g.body.type, 'FeatureCollection'); assert.ok(g.body.features.every((f) => f.geometry.type === 'Point'));
    const r = await api('GET', '/api/export/routes', { token: T.lagAM });
    assert.ok(r.body.features.every((f) => f.geometry.type === 'LineString'));
    const csv = await api('GET', '/api/export/devices?format=csv', { token: T.lagAM });
    assert.match(csv.body, /^device_id,device_code,name,device_type/);
  });
  it('defuses spreadsheet formulas in CSV exports', async () => {
    await api('POST', '/api/devices', { token: T.lagFT, body: { device_code: 'LAG-CSV-01', name: '=HYPERLINK("http://x")', device_type: 'tower', longitude: 3.4, latitude: 6.5 } });
    const csv = await api('GET', '/api/export/devices?format=csv', { token: T.lagAM });
    assert.ok(csv.body.includes(`"'=HYPERLINK`));
  });
  it('TC16: the map and dashboard data load quickly', async () => {
    for (const path of ['/api/devices', '/api/routes', '/api/dashboard']) {
      const t0 = Date.now();
      const r = await api('GET', path, { token: T.lagAM });
      assert.equal(r.status, 200); assert.ok(Date.now() - t0 < 1000, `${path} took ${Date.now() - t0} ms`);
    }
  });
});

describe('User management', () => {
  let newId;
  it('an administrator creates a user who can sign in', async () => {
    const r = await api('POST', '/api/admin/users', { token: T.lagAdmin, body: { full_name: 'New Tech', email: 'new.tech@lagoon-telecom.example', role: 'field_technician', password: 'LongEnough1' } });
    assert.equal(r.status, 201); assert.equal(r.body.password_hash, undefined);
    newId = r.body.user_id;
    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'new.tech@lagoon-telecom.example', password: 'LongEnough1' } })).status, 200);
  });
  it('validates input and protects the administrator', async () => {
    const body = { full_name: 'X', email: 'x@lagoon-telecom.example', role: 'field_technician', password: 'short' };
    assert.equal((await api('POST', '/api/admin/users', { token: T.lagAdmin, body })).status, 400);
    assert.equal((await api('POST', '/api/admin/users', { token: T.lagAdmin, body: { ...body, password: 'LongEnough1', role: 'owner' } })).status, 400);
    const me = (await api('GET', '/api/auth/me', { token: T.lagAdmin })).body.id;
    assert.equal((await api('PATCH', `/api/admin/users/${me}`, { token: T.lagAdmin, body: { is_active: false } })).status, 400);
  });
  it('limits an administrator to their own operator and audits the change without the password hash', async () => {
    assert.equal((await api('PATCH', `/api/admin/users/${newId}`, { token: T.harAdmin, body: { role: 'asset_manager' } })).status, 404);
    assert.equal((await api('PATCH', `/api/admin/users/${newId}`, { token: T.lagAdmin, body: { role: 'asset_manager' } })).status, 200);
    const a = await api('GET', `/api/admin/audit?table=users&record_id=${newId}`, { token: T.lagAdmin });
    assert.ok(a.body.some((x) => x.new_data.role === 'asset_manager' && !('password_hash' in x.new_data)));
    assert.equal((await api('GET', `/api/admin/audit?table=users&record_id=${newId}`, { token: T.harAdmin })).body.length, 0);
  });
  it('a switched-off user can no longer sign in or use an old token', async () => {
    const login = await api('POST', '/api/auth/login', { body: { email: 'new.tech@lagoon-telecom.example', password: 'LongEnough1' } });
    assert.equal((await api('PATCH', `/api/admin/users/${newId}`, { token: T.lagAdmin, body: { is_active: false } })).status, 200);
    assert.equal((await api('GET', '/api/devices', { token: login.body.token })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'new.tech@lagoon-telecom.example', password: 'LongEnough1' } })).status, 401);
  });
});
