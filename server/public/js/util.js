// Small helpers for building the page safely. Text is always added as text, never as HTML.
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const LABELS = {
  deviceType: { tower: 'Tower', olt: 'OLT', pop: 'Point of presence', splice_enclosure: 'Splice enclosure', distribution_point: 'Distribution point' },
  routeType: { backbone: 'Backbone', feeder: 'Feeder', distribution: 'Distribution', drop: 'Drop' },
  status: { active: 'Active', faulty: 'Faulty', under_repair: 'Under repair', vandalised: 'Vandalised', decommissioned: 'Decommissioned', cut: 'Cut', planned: 'Planned' },
  visibility: { private: 'Private', shared: 'Shared' },
  issue: { fibre_cut: 'Fibre cut', equipment_fault: 'Equipment fault', vandalism: 'Vandalism', theft: 'Theft', power_failure: 'Power failure', routine_inspection: 'Routine inspection', other: 'Other' },
  maint: { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' },
  alert: { new: 'New', acknowledged: 'Acknowledged', resolved: 'Resolved' },
  role: { field_technician: 'Field Technician', asset_manager: 'Asset Manager', gis_admin: 'GIS Administrator', decision_maker: 'Decision Maker' },
  relation: { owner: 'Your route', connected_device: 'Connected to your device', corridor_neighbour: 'Near your routes' },
};
export const label = (group, key) => (LABELS[group] && LABELS[group][key]) || key || '';

export const STATUS_COLOR = { active: '#2e7d32', faulty: '#c62828', cut: '#c62828', under_repair: '#ef6c00', vandalised: '#6a1b9a', decommissioned: '#757575', planned: '#1565c0' };

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export function select(options, value, attrs = {}) {
  const s = el('select', attrs, options.map(([v, t]) => el('option', { value: v }, t)));
  if (value !== undefined && value !== null) s.value = value;
  return s;
}
export const optionsOf = (group, keys) => keys.map((k) => [k, label(group, k)]);

export function field(labelText, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 9);
  input.id = id;
  return el('div', { class: 'field' }, el('label', { for: id }, labelText), input, hint ? el('small', {}, hint) : null);
}

export function toast(message, type = 'info') {
  const t = el('div', { class: `toast ${type}`, role: 'status' }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
}

// A simple dialog. actions: [{ label, kind, onClick: async () => {} }]. Returning false keeps it open.
export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const err = el('div', { class: 'form-error', role: 'alert' });
  const buttons = actions.map((a) => {
    const b = el('button', { type: 'button', class: `btn ${a.kind || 'secondary'}` }, a.label);
    b.addEventListener('click', async () => {
      err.textContent = '';
      b.disabled = true;
      try {
        const keep = a.onClick ? await a.onClick() : undefined;
        if (keep !== false) close();
      } catch (e) {
        err.textContent = e.message || 'Something went wrong';
      } finally { b.disabled = false; }
    });
    return b;
  });
  const dialog = el('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('h2', {}, title), el('div', { class: 'modal-body' }, body), err, el('div', { class: 'modal-actions' }, buttons));
  const backdrop = el('div', { class: 'backdrop' }, dialog);
  let closed = false;
  function close() { if (closed) return; closed = true; backdrop.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  const first = dialog.querySelector('input, select, textarea, button');
  if (first) first.focus();
  return { close, dialog };
}

export const confirmBox = (title, text, okLabel = 'Confirm', kind = 'primary') =>
  new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({ title, body: el('p', {}, text), onClose: () => finish(false), actions: [
      { label: 'Cancel', onClick: () => finish(false) },
      { label: okLabel, kind, onClick: () => finish(true) }] });
  });

export function table(columns, rows, emptyText = 'Nothing to show.') {
  if (!rows.length) return el('p', { class: 'empty' }, emptyText);
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, columns.map((c) => el('th', {}, c.title)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, columns.map((c) => el('td', { 'data-label': c.title }, c.render ? c.render(r) : r[c.key] ?? '')))))));
}

export const badge = (group, key) => el('span', { class: `badge b-${key}` }, label(group, key));
