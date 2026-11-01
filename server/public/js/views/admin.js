import { api } from '../api.js';
import { el, label, field, select, optionsOf, openModal, toast, fmtDate, badge, table } from '../util.js';

const ROLES = ['field_technician', 'asset_manager', 'decision_maker', 'gis_admin'];

export async function mount(root, ctx) {
  return ctx.viewId === 'audit' ? audit(root) : users(root, ctx);
}

async function users(root, ctx) {
  const holder = el('div');
  root.append(el('div', { class: 'page' }, el('h1', {}, 'Users'), el('p', { class: 'lead' }, `People who can sign in for ${ctx.user.operatorName}.`),
    el('div', { class: 'toolbar' }, el('button', { class: 'btn primary', id: 'add-user', type: 'button', onclick: addUser }, '+ Add user')), holder));

  function addUser() {
    const f = { name: el('input', { type: 'text', maxlength: 120 }), email: el('input', { type: 'email' }), role: select(optionsOf('role', ROLES), 'field_technician'), pw: el('input', { type: 'password', autocomplete: 'new-password' }) };
    openModal({ title: 'Add a user', body: el('div', {}, field('Full name', f.name), field('Email', f.email), field('Role', f.role), field('Temporary password', f.pw, 'At least 8 characters. The person should change it after signing in.')),
      actions: [{ label: 'Cancel' }, { label: 'Add user', kind: 'primary', onClick: async () => {
        await api('POST', '/admin/users', { full_name: f.name.value, email: f.email.value, role: f.role.value, password: f.pw.value }); toast('User added', 'success'); await load();
      } }] });
  }
  function resetPassword(u) {
    const pw = el('input', { type: 'password', autocomplete: 'new-password' });
    openModal({ title: `New password for ${u.full_name}`, body: field('New password', pw, 'At least 8 characters'),
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => { await api('PATCH', `/admin/users/${u.user_id}`, { password: pw.value }); toast('Password changed', 'success'); } }] });
  }
  async function change(u, body) { try { await api('PATCH', `/admin/users/${u.user_id}`, body); toast('Saved', 'success'); await load(); } catch (e) { toast(e.message, 'error'); await load(); } }

  async function load() {
    const rows = await api('GET', '/admin/users').catch((e) => { toast(e.message, 'error'); return []; });
    holder.replaceChildren(table([
      { title: 'Name', key: 'full_name' }, { title: 'Email', key: 'email' },
      { title: 'Role', render: (u) => { if (u.user_id === ctx.user.id) return label('role', u.role); const s = select(optionsOf('role', ROLES), u.role, { 'aria-label': `Role of ${u.full_name}`, onchange: () => change(u, { role: s.value }) }); return s; } },
      { title: 'Active', render: (u) => badge('status', u.is_active ? 'active' : 'decommissioned') },
      { title: 'Actions', render: (u) => (u.user_id === ctx.user.id ? 'This is you' : el('div', { class: 'actions' },
        el('button', { class: 'btn small', type: 'button', onclick: () => change(u, { is_active: !u.is_active }) }, u.is_active ? 'Switch off' : 'Switch on'),
        el('button', { class: 'btn small', type: 'button', onclick: () => resetPassword(u) }, 'Set password'))) },
    ], rows, 'No users.'));
  }
  await load();
}

async function audit(root) {
  const tableSel = select([['', 'All records'], ['devices', 'Devices'], ['routes', 'Routes'], ['maintenance_records', 'Maintenance'], ['alerts', 'Alerts'], ['users', 'Users']], '', { onchange: load });
  const rec = el('input', { type: 'text', placeholder: 'Record number', style: 'width:9rem', onchange: load });
  const holder = el('div');
  root.append(el('div', { class: 'page' }, el('h1', {}, 'Audit log'), el('p', { class: 'lead' }, 'Who changed what and when, for changes made by people in your operator.'),
    el('div', { class: 'toolbar' }, field('Show', tableSel), field('Record', rec), el('button', { class: 'btn', type: 'button', onclick: load }, 'Refresh')), holder));

  const changes = (r) => {
    if (r.action === 'INSERT') return 'Created';
    if (r.action === 'DELETE') return 'Deleted';
    const skip = new Set(['updated_at']);
    const diffs = Object.keys(r.new_data || {}).filter((k) => !skip.has(k) && JSON.stringify(r.new_data[k]) !== JSON.stringify((r.old_data || {})[k]));
    return diffs.map((k) => `${k}: ${fmt((r.old_data || {})[k])} to ${fmt(r.new_data[k])}`).join('; ');
  };
  const fmt = (v) => (v === null || v === undefined ? 'empty' : typeof v === 'object' ? 'changed' : String(v));

  async function load() {
    const q = new URLSearchParams({ limit: '300' }); if (tableSel.value) q.set('table', tableSel.value); if (rec.value.trim()) q.set('record_id', rec.value.trim());
    const rows = await api('GET', '/admin/audit?' + q).catch((e) => { toast(e.message, 'error'); return []; });
    holder.replaceChildren(table([{ title: 'When', render: (r) => fmtDate(r.performed_at) }, { title: 'Who', render: (r) => r.performed_by || 'System' }, { title: 'Action', key: 'action' },
      { title: 'Table', key: 'table_name' }, { title: 'Record', key: 'record_id' }, { title: 'Changes', render: changes }], rows, 'No changes recorded.'));
  }
  await load();
}
