import { api } from '../api.js';
import { el, label, field, select, optionsOf, openModal, toast, fmtDate, badge, table } from '../util.js';

export async function mount(root, ctx) {
  const canEdit = ctx.user.role === 'field_technician' || ctx.user.role === 'asset_manager';
  const statusSel = select([['', 'All'], ...optionsOf('maint', ['open', 'in_progress', 'resolved'])], '', { onchange: load });
  const issueSel = select([['', 'All'], ...optionsOf('issue', ['fibre_cut', 'equipment_fault', 'vandalism', 'theft', 'power_failure', 'routine_inspection', 'other'])], '', { onchange: load });
  const holder = el('div');
  root.append(el('div', { class: 'page' }, el('h1', {}, 'Maintenance records'),
    el('p', { class: 'lead' }, 'Repairs, inspections and incidents on your devices and routes.'),
    el('div', { class: 'toolbar' }, field('Status', statusSel), field('Issue', issueSel),
      canEdit ? el('button', { class: 'btn primary', id: 'new-record', type: 'button', onclick: newRecord }, '+ New record') : null), holder));

  async function newRecord() {
    const kind = select([['device', 'Device'], ['route', 'Route']], 'device');
    const asset = select([['', 'Loading...']]);
    const issue = select(optionsOf('issue', ['equipment_fault', 'fibre_cut', 'vandalism', 'theft', 'power_failure', 'routine_inspection', 'other']), 'equipment_fault');
    const stat = select(optionsOf('maint', ['open', 'in_progress', 'resolved']), 'open');
    const notes = el('textarea', { maxlength: 1000 });
    async function fill() {
      const data = await api('GET', `/${kind.value === 'device' ? 'devices' : 'routes'}?limit=5000`);
      asset.replaceChildren(...data.features.map((f) => el('option', { value: f.id }, `${f.properties.device_code || f.properties.route_code}: ${f.properties.name}`)));
    }
    kind.addEventListener('change', fill);
    await fill();
    openModal({ title: 'New maintenance record', body: el('div', {}, el('div', { class: 'row2' }, field('Asset type', kind), field('Asset', asset)), field('Issue', issue), field('Status', stat), field('Notes', notes)),
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
        await api('POST', '/maintenance', { [kind.value === 'device' ? 'device_id' : 'route_id']: Number(asset.value), issue_type: issue.value, status: stat.value, notes: notes.value || undefined });
        toast('Record saved', 'success'); await load();
      } }] });
  }

  async function load() {
    const q = new URLSearchParams(); if (statusSel.value) q.set('status', statusSel.value); if (issueSel.value) q.set('issue_type', issueSel.value);
    const rows = await api('GET', '/maintenance?' + q).catch((e) => { toast(e.message, 'error'); return []; });
    holder.replaceChildren(table([
      { title: 'Reported', render: (r) => fmtDate(r.reported_at) }, { title: 'Asset', render: (r) => `${label(r.asset_kind === 'device' ? 'deviceType' : 'routeType', '') || (r.asset_kind === 'device' ? 'Device' : 'Route')} ${r.asset_code}` },
      { title: 'Issue', render: (r) => label('issue', r.issue_type) }, { title: 'Status', render: (r) => badge('maint', r.status) }, { title: 'Notes', key: 'notes' },
      { title: 'Reported by', key: 'reported_by' }, { title: 'Resolved', render: (r) => (r.resolved_at ? `${fmtDate(r.resolved_at)} by ${r.resolved_by || ''}` : '') },
      { title: 'Actions', render: (r) => (canEdit && r.status !== 'resolved' ? el('button', { class: 'btn small primary', type: 'button', onclick: async () => {
        try { await api('PATCH', `/maintenance/${r.record_id}/resolve`); toast('Marked as resolved', 'success'); await load(); } catch (e) { toast(e.message, 'error'); } } }, 'Mark resolved') : '') },
    ], rows, 'No maintenance records match.'));
  }
  await load();
}
