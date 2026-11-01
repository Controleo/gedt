import { api, session, setSession, isSignedIn } from './api.js';
import { el, openModal, toast, ago } from './util.js';
import * as loginView from './views/login.js';

const ALL = ['field_technician', 'asset_manager', 'gis_admin', 'decision_maker'];
const MANAGERS = ['asset_manager', 'decision_maker'];
const VIEWS = [
  { id: 'map', label: 'Map', roles: ALL, module: () => import('./views/map.js') },
  { id: 'alerts', label: 'Alerts', roles: ALL, module: () => import('./views/alerts.js') },
  { id: 'maintenance', label: 'Maintenance', roles: ALL, module: () => import('./views/maintenance.js') },
  { id: 'free-routes', label: 'Free routes', roles: MANAGERS, module: () => import('./views/freeroutes.js') },
  { id: 'dashboard', label: 'Dashboard', roles: MANAGERS, module: () => import('./views/dashboard.js') },
  { id: 'reports', label: 'Reports and export', roles: MANAGERS, module: () => import('./views/reports.js') },
  { id: 'users', label: 'Users', roles: ['gis_admin'], module: () => import('./views/admin.js') },
  { id: 'audit', label: 'Audit log', roles: ['gis_admin'], module: () => import('./views/admin.js') },
];

const app = document.getElementById('app');
let current = null;      // the mounted view
let pollTimer = null;
let bellPanel = null;

function route() {
  const id = (location.hash || '#/map').replace('#/', '').split('?')[0] || 'map';
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  return { id, params };
}

async function show() {
  if (!isSignedIn()) return showLogin();
  const { id, params } = route();
  const allowed = VIEWS.filter((v) => v.roles.includes(session.user.role));
  const view = allowed.find((v) => v.id === id) || allowed[0];
  if (view.id !== id) { location.hash = '#/' + view.id; return; }
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view.id));
  if (current && current.unmount) current.unmount();
  const main = document.getElementById('main');
  main.replaceChildren();
  const mod = await view.module();
  current = await mod.mount(main, { user: session.user, viewId: view.id, params, refreshBell });
}

function showLogin() {
  if (current && current.unmount) current.unmount();
  current = null;
  clearInterval(pollTimer);
  app.replaceChildren();
  loginView.mount(app, { onSignedIn: () => { build(); show(); } });
}

function build() {
  const u = session.user;
  const nav = el('nav', { class: 'nav', 'aria-label': 'Main' },
    VIEWS.filter((v) => v.roles.includes(u.role)).map((v) => el('a', { href: '#/' + v.id, 'data-view': v.id }, v.label)));
  const bell = el('button', { class: 'iconbtn', id: 'bell', type: 'button', 'aria-label': 'Notifications', onclick: toggleBell }, 'Notices', el('span', { class: 'count', id: 'bellcount', hidden: true }, '0'));
  const help = el('button', { class: 'iconbtn', type: 'button', onclick: showHelp }, 'Help');
  const out = el('button', { class: 'iconbtn', type: 'button', onclick: signOut }, 'Sign out');
  app.replaceChildren(
    el('header', { class: 'topbar' },
      el('div', { class: 'brand' }, 'GEDT Registry', el('small', {}, 'Shared telecom infrastructure map')),
      nav,
      el('div', { class: 'userbox' }, el('div', { class: 'who' }, u.name, el('small', {}, `${roleName(u.role)}, ${u.operatorName}`)), bell, help, out)),
    el('main', { id: 'main' }));
  refreshBell();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshBell, 30000);
}

const roleName = (r) => ({ field_technician: 'Field Technician', asset_manager: 'Asset Manager', gis_admin: 'GIS Administrator', decision_maker: 'Decision Maker' }[r] || r);

async function refreshBell() {
  if (!isSignedIn()) return;
  try {
    const list = await api('GET', '/notifications?unread=true&limit=50');
    const c = document.getElementById('bellcount');
    if (c) { c.textContent = list.length; c.hidden = list.length === 0; }
    if (current && current.onNotifications) current.onNotifications(list);
  } catch { /* ignore */ }
}

async function toggleBell() {
  if (bellPanel) { bellPanel.remove(); bellPanel = null; return; }
  const list = await api('GET', '/notifications?limit=20');
  bellPanel = el('div', { class: 'bell-panel', role: 'region', 'aria-label': 'Notifications' }, el('h3', {}, 'Recent notices'),
    list.length ? list.map((n) => el('button', { class: `bell-item${n.read_at ? '' : ' unread'}`, type: 'button', onclick: async () => {
      if (!n.read_at) await api('PATCH', `/notifications/${n.notification_id}/read`).catch(() => {});
      bellPanel.remove(); bellPanel = null; refreshBell(); location.hash = '#/alerts?alert=' + n.alert_id;
    } }, n.message, el('small', {}, `Alert ${n.alert_id}, ${n.alert_status}, ${ago(n.created_at)}`))) : el('p', { class: 'empty' }, 'No notices yet.'));
  document.body.append(bellPanel);
}

function showHelp() {
  const role = session.user.role;
  const tips = {
    field_technician: ['Click a device or route on the map to update its status, log maintenance or report a cut.', 'Use "+ Device" and "+ Route" to register new assets.'],
    asset_manager: ['Register and update assets from the map, and log maintenance.', 'Use Alerts to acknowledge and resolve cuts, and Free routes to find spare fibres from other operators.'],
    decision_maker: ['Use the Dashboard for the overall picture and Alerts to follow open cuts.', 'Free routes shows spare fibres other operators have shared.'],
    gis_admin: ['Use Users to add people and set their roles.', 'Use Audit log to see who changed what.'],
  }[role];
  openModal({ title: 'How to use this system', body: el('div', { class: 'help' },
    el('p', {}, 'Colours show status and shapes show device type. Solid lines are your routes, thin grey lines are routes other operators chose to share, and green lines are free routes.'),
    el('ul', {}, tips.map((t) => el('li', {}, t)))), actions: [{ label: 'Close', kind: 'primary' }] });
}

async function signOut() {
  try { await api('GET', '/auth/me'); } catch { /* ignore */ }
  setSession(null, null);
  location.hash = '';
  showLogin();
}

window.addEventListener('hashchange', () => { if (bellPanel) { bellPanel.remove(); bellPanel = null; } show(); });
window.addEventListener('gedt:signedout', () => { toast('Your session ended. Please sign in again.', 'error'); showLogin(); });

if (isSignedIn() && session.user) { build(); show(); } else showLogin();
