import { api } from '../api.js';
import { el, label, field, select, openModal, toast, fmtDate, ago, badge, table } from '../util.js';

export async function mount(root, ctx) {
  const canAct = ctx.user.role === 'asset_manager' || ctx.user.role === 'decision_maker';
  const target = ctx.params.get('alert');
  const statusSel = select([['', 'All alerts'], ['new', 'New'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved']], '', { onchange: load });
  const holder = el('div');
  let unmounted = false;
  root.append(el('div', { class: 'page' }, el('h1', {}, 'Fibre cut alerts'),
    el('p', { class: 'lead' }, 'Cuts on your routes, on routes connected to your devices, and cuts reported near your routes. Operators you share a corridor with only see a general warning.'),
    el('div', { class: 'toolbar' }, field('Show', statusSel), el('button', { class: 'btn', type: 'button', onclick: load }, 'Refresh')), holder));

  function resolveModal(a) {
    const notes = el('textarea', { maxlength: 1000, placeholder: 'What was repaired' });
    openModal({ title: `Resolve alert ${a.alert_id}`, body: el('div', {}, el('p', {}, 'This restores the route to active and records the repair in maintenance.'), field('Repair notes', notes)),
      actions: [{ label: 'Cancel' }, { label: 'Resolve', kind: 'primary', onClick: async () => {
        await api('PATCH', `/alerts/${a.alert_id}/resolve`, { notes: notes.value || undefined }); toast('Alert resolved', 'success'); await load();
      } }] });
  }

  async function load() {
    const q = statusSel.value ? `?status=${statusSel.value}` : '';
    const rows = await api('GET', '/alerts' + q).catch((e) => { toast(e.message, 'error'); return []; });
    if (unmounted) return;
    const tbl = table([
      { title: 'Alert', key: 'alert_id' }, { title: 'Status', render: (a) => badge('alert', a.status) }, { title: 'Relation', render: (a) => label('relation', a.relation) },
      { title: 'Route', render: (a) => a.route_code || 'Not shown' }, { title: 'Owner', render: (a) => a.owner_name || 'Not shown' }, { title: 'Message', key: 'message' },
      { title: 'Raised', render: (a) => `${fmtDate(a.created_at)} (${ago(a.created_at)})` }, { title: 'Source', render: (a) => (a.source === 'simulated_feed' ? 'Simulated feed' : 'Technician') },
      { title: 'Actions', render: (a) => el('div', { class: 'actions' },
        a.cut_location ? el('a', { class: 'btn small', href: `#/map?alert=${a.alert_id}` }, 'Show on map') : null,
        canAct && a.relation === 'owner' && a.status === 'new' ? el('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('PATCH', `/alerts/${a.alert_id}/acknowledge`); toast('Alert acknowledged', 'success'); await load(); } catch (e) { toast(e.message, 'error'); } } }, 'Acknowledge') : null,
        canAct && a.relation === 'owner' && a.status !== 'resolved' ? el('button', { class: 'btn small primary', type: 'button', onclick: () => resolveModal(a) }, 'Resolve') : null) },
    ], rows, 'No alerts to show.');
    holder.replaceChildren(tbl);
    if (target) holder.querySelectorAll('tbody tr').forEach((tr) => { if (tr.firstChild.textContent === target) { tr.style.outline = '3px solid #ffb300'; tr.scrollIntoView({ block: 'center' }); } });
  }
  await load();
  return { unmount() { unmounted = true; }, onNotifications() { load(); } };
}
