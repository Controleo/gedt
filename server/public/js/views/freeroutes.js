import { api } from '../api.js';
import { el, field, toast, table } from '../util.js';

export async function mount(root) {
  const minSpare = el('input', { type: 'number', min: 1, value: 1, style: 'width:6rem' });
  const own = el('input', { type: 'checkbox' });
  const mapDiv = el('div', { class: 'map', style: 'position:relative;height:420px;border-radius:10px;border:1px solid #d9e0e8' });
  const holder = el('div');
  root.append(el('div', { class: 'page' }, el('h1', {}, 'Free routes'),
    el('p', { class: 'lead' }, 'Routes that operators have shared, that are working, and that have spare fibres. Use this to find where you could lease capacity or share a corridor.'),
    el('div', { class: 'toolbar' }, field('At least this many spare fibres', minSpare), el('label', {}, own, ' Include my own routes'), el('button', { class: 'btn primary', type: 'button', onclick: load }, 'Apply')),
    el('div', { style: 'position:relative;margin-bottom:1rem' }, mapDiv), holder));
  const map = L.map(mapDiv, { center: [6.52, 3.40], zoom: 11 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const group = L.layerGroup().addTo(map);
  const lines = new Map();
  let unmounted = false;
  setTimeout(() => { if (!unmounted) map.invalidateSize(); }, 50);

  async function load() {
    const q = new URLSearchParams({ min_spare: String(minSpare.value || 1) }); if (own.checked) q.set('include_own', 'true');
    let data;
    try { data = await api('GET', '/free-routes?' + q); } catch (e) { return toast(e.message, 'error'); }
    if (unmounted) return;
    group.clearLayers(); lines.clear();
    data.features.forEach((f) => {
      const p = f.properties;
      const line = L.polyline(f.geometry.coordinates.map((c) => [c[1], c[0]]), { color: '#00a86b', weight: 6, opacity: .8 }).addTo(group)
        .bindPopup(`${p.operator_name}: ${p.route_code}, ${p.spare_capacity_fibres} spare fibres`);
      lines.set(p.route_id, line);
    });
    if (data.features.length) map.fitBounds(L.featureGroup([...lines.values()]).getBounds().pad(0.1), { animate: false });
    holder.replaceChildren(table([
      { title: 'Operator', render: (f) => f.properties.operator_name }, { title: 'Route', render: (f) => f.properties.route_code }, { title: 'Type', render: (f) => f.properties.route_type },
      { title: 'Spare fibres', render: (f) => `${f.properties.spare_capacity_fibres} of ${f.properties.total_fibres}` }, { title: 'Length', render: (f) => `${(f.properties.length_m / 1000).toFixed(2)} km` },
      { title: 'Map', render: (f) => el('button', { class: 'btn small', type: 'button', onclick: () => { const l = lines.get(f.properties.route_id); map.fitBounds(l.getBounds().pad(0.3), { animate: false }); l.openPopup(); } }, 'Show') },
    ], data.features, 'No free routes match. Try fewer spare fibres.'));
  }
  await load();
  return { unmount() { unmounted = true; map.stop(); map.remove(); } };
}
