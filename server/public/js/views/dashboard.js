import { api } from '../api.js';
import { el, label, STATUS_COLOR, toast } from '../util.js';

export async function mount(root, ctx) {
  const charts = [];
  const page = el('div', { class: 'page' }, el('h1', {}, 'Dashboard'), el('p', { class: 'lead', id: 'dash-sub' }, `Overview for ${ctx.user.operatorName}`));
  root.append(page);
  let d;
  try { d = await api('GET', '/dashboard'); } catch (e) { toast(e.message, 'error'); return {}; }

  const sum = (rows, test) => rows.filter(test).reduce((s, r) => s + r.total, 0);
  const devices = d.assets.filter((r) => r.asset_kind === 'device');
  const routes = d.assets.filter((r) => r.asset_kind === 'route');
  const stat = (n, text) => el('div', { class: 'card stat' }, el('b', {}, n), el('span', {}, text));
  page.append(el('div', { class: 'cards' },
    stat(sum(devices, () => true), 'Devices'), stat(sum(routes, () => true), 'Routes'),
    stat(sum(devices, (r) => r.status !== 'active'), 'Devices needing attention'), stat(sum(routes, (r) => ['cut', 'under_repair'].includes(r.status)), 'Routes cut or under repair'),
    stat(d.open_alerts_relevant_to_me, 'Open alerts'), stat(sum(d.maintenance_last_90_days, (r) => r.status !== 'resolved'), 'Open maintenance (90 days)'),
    stat(d.free_routes_from_other_operators.routes, `Free routes shared by others (${d.free_routes_from_other_operators.spare_fibres} spare fibres)`)));

  const group = (rows, key) => { const m = {}; rows.forEach((r) => { m[r[key]] = (m[r[key]] || 0) + r.total; }); return m; };
  const card = (title) => { const c = el('canvas', { 'aria-label': title, role: 'img' }); return [el('div', { class: 'card' }, el('h3', {}, title), c), c]; };
  const [c1, k1] = card('Devices by status'); const [c2, k2] = card('Routes by status'); const [c3, k3] = card('Devices by type'); const [c4, k4] = card('Maintenance by issue, last 90 days');
  page.append(el('div', { class: 'charts' }, c1, c2, c3, c4));

  const doughnut = (canvas, rows, group_) => {
    const m = group(rows, 'status'); const keys = Object.keys(m);
    charts.push(new Chart(canvas, { type: 'doughnut', data: { labels: keys.map((k) => label('status', k)), datasets: [{ data: keys.map((k) => m[k]), backgroundColor: keys.map((k) => STATUS_COLOR[k] || '#999') }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } }));
  };
  doughnut(k1, devices); doughnut(k2, routes);
  const t = group(devices, 'asset_type'); const tk = Object.keys(t);
  charts.push(new Chart(k3, { type: 'bar', data: { labels: tk.map((k) => label('deviceType', k)), datasets: [{ label: 'Devices', data: tk.map((k) => t[k]), backgroundColor: '#14507a' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } }));
  const issues = [...new Set(d.maintenance_last_90_days.map((r) => r.issue_type))];
  const stats = ['open', 'in_progress', 'resolved']; const colors = { open: '#c62828', in_progress: '#ef6c00', resolved: '#2e7d32' };
  charts.push(new Chart(k4, { type: 'bar', data: { labels: issues.map((k) => label('issue', k)), datasets: stats.map((s) => ({ label: label('maint', s), backgroundColor: colors[s], data: issues.map((i) => sum(d.maintenance_last_90_days, (r) => r.issue_type === i && r.status === s)) })) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } } }));
  return { unmount() { charts.forEach((c) => c.destroy()); } };
}
