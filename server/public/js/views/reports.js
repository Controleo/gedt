import { api, download } from '../api.js';
import { el, label, field, select, optionsOf, toast, fmtDate, badge, table } from '../util.js';

export async function mount(root) {
  const f = {
    from: el('input', { type: 'date' }), to: el('input', { type: 'date' }),
    status: select([['', 'All'], ...optionsOf('maint', ['open', 'in_progress', 'resolved'])]),
    issue: select([['', 'All'], ...optionsOf('issue', ['fibre_cut', 'equipment_fault', 'vandalism', 'theft', 'power_failure', 'routine_inspection', 'other'])]),
    kind: select([['', 'Devices and routes'], ['device', 'Devices'], ['route', 'Routes']]),
  };
  const holder = el('div');
  const query = () => { const q = new URLSearchParams(); if (f.from.value) q.set('from', f.from.value); if (f.to.value) q.set('to', f.to.value);
    if (f.status.value) q.set('status', f.status.value); if (f.issue.value) q.set('issue_type', f.issue.value); if (f.kind.value) q.set('asset_kind', f.kind.value); return q; };
  const safe = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };

  const run = safe(async () => {
    const rows = await api('GET', '/reports/maintenance?' + query());
    holder.replaceChildren(el('p', { class: 'lead' }, `${rows.length} record${rows.length === 1 ? '' : 's'} found.`), table([
      { title: 'Reported', render: (r) => fmtDate(r.reported_at) }, { title: 'Asset', render: (r) => `${r.asset_kind === 'device' ? 'Device' : 'Route'} ${r.asset_code}` },
      { title: 'Issue', render: (r) => label('issue', r.issue_type) }, { title: 'Status', render: (r) => badge('maint', r.status) }, { title: 'Notes', key: 'notes' },
      { title: 'Reported by', key: 'reported_by' }, { title: 'Resolved', render: (r) => (r.resolved_at ? fmtDate(r.resolved_at) : '') }], rows, 'No records match these filters.'));
  });

  root.append(el('div', { class: 'page' }, el('h1', {}, 'Reports and export'),
    el('h2', {}, 'Maintenance report'),
    el('div', { class: 'toolbar' }, field('From', f.from), field('To', f.to), field('Status', f.status), field('Issue', f.issue), field('Asset type', f.kind),
      el('button', { class: 'btn primary', id: 'run-report', type: 'button', onclick: run }, 'Show report'),
      el('button', { class: 'btn', type: 'button', onclick: safe(() => { const q = query(); q.set('format', 'csv'); return download('/reports/maintenance?' + q, 'maintenance-report.csv'); }) }, 'Download CSV')),
    holder,
    el('h2', { style: 'margin-top:1.5rem' }, 'Export my data'),
    el('p', { class: 'lead' }, 'GeoJSON opens in QGIS, ArcGIS and most web maps. CSV opens in Excel.'),
    el('div', { class: 'actions' },
      [['Devices (GeoJSON)', '/export/devices', 'devices.geojson'], ['Devices (CSV)', '/export/devices?format=csv', 'devices.csv'], ['Routes (GeoJSON)', '/export/routes', 'routes.geojson'], ['Routes (CSV)', '/export/routes?format=csv', 'routes.csv']]
        .map(([t, p, n]) => el('button', { class: 'btn', type: 'button', onclick: safe(() => download(p, n)) }, t)))));
  await run();
}
