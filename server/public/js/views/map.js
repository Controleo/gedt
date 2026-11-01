import { api } from '../api.js';
import { el, label, field, select, optionsOf, openModal, toast, fmtDate, badge, table, STATUS_COLOR } from '../util.js';

const DEVICE_STATUS = ['active', 'faulty', 'under_repair', 'vandalised', 'decommissioned'];
const ROUTE_STATUS = ['active', 'under_repair', 'planned', 'decommissioned'];
const ROUTE_WEIGHT = { backbone: 5, feeder: 4, distribution: 3, drop: 2 };
const LAGOS = [6.52, 3.40];

const ll = (coord) => [coord[1], coord[0]];            // GeoJSON [lng, lat] to Leaflet [lat, lng]
const flip = (coords) => coords.map(ll);

export async function mount(root, ctx) {
  const role = ctx.user.role;
  const canEdit = role === 'field_technician' || role === 'asset_manager';
  const isManager = role === 'asset_manager' || role === 'decision_maker';
  const state = { devices: [], routes: [], sharedRoutes: [], sharedDevices: [], free: [], alerts: [] };
  const show = { devices: true, routes: true, sharedRoutes: true, sharedDevices: false, free: false, alerts: true };
  const filter = { type: '', status: '', q: '' };
  let mode = null;                 // null, 'device' or 'route'
  let drawPoints = [];
  let drawLine = null;
  let unmounted = false;

  // ------------------------------------------------------------ layout
  const mapDiv = el('div', { class: 'map', id: 'map', role: 'application', 'aria-label': 'Map of devices and routes' });
  const modebar = el('div', { class: 'modebar', role: 'status' });
  const checks = [
    ['devices', 'My devices'], ['routes', 'My routes'], ['sharedRoutes', 'Shared routes of other operators'],
    ['sharedDevices', 'Shared devices of other operators'], ...(isManager ? [['free', 'Free routes (spare fibres)']] : []), ['alerts', 'Fibre cut alerts'],
  ].map(([key, text]) => {
    const box = el('input', { type: 'checkbox', id: 'chk-' + key, onchange: () => { show[key] = box.checked; render(); } });
    box.checked = show[key];
    return el('label', {}, box, text);
  });

  const typeSel = select([['', 'All device types'], ...optionsOf('deviceType', Object.keys({ tower: 1, olt: 1, pop: 1, splice_enclosure: 1, distribution_point: 1 }))], '', { onchange: () => { filter.type = typeSel.value; render(); }, 'aria-label': 'Device type' });
  const statusSel = select([['', 'All statuses'], ...optionsOf('status', ['active', 'faulty', 'cut', 'under_repair', 'vandalised', 'planned', 'decommissioned'])], '', { onchange: () => { filter.status = statusSel.value; render(); }, 'aria-label': 'Status' });
  const search = el('input', { type: 'search', placeholder: 'Search code or name', 'aria-label': 'Search', oninput: () => { filter.q = search.value.trim().toLowerCase(); render(); } });
  const summary = el('p', { class: 'lead', id: 'map-summary' });
  const results = el('div', { class: 'results', id: 'search-results' });

  const legend = el('div', {},
    ['active', 'faulty', 'under_repair', 'vandalised', 'decommissioned'].map((s) => el('div', { class: 'legend-row' }, el('span', { class: 'legend-dot', style: `background:${STATUS_COLOR[s]}` }), label('status', s))),
    el('div', { class: 'legend-row' }, el('span', { class: 'swatch', style: `border-color:${STATUS_COLOR.cut}` }), 'Route cut (red line)'),
    el('div', { class: 'legend-row' }, el('span', { class: 'swatch', style: 'border-color:#00a86b' }), 'Free route'),
    el('div', { class: 'legend-row' }, el('span', { class: 'swatch', style: 'border-color:#7b8794;border-top-style:dotted' }), 'Shared by another operator'),
    el('p', { class: 'lead' }, 'Shapes: triangle = tower, square = point of presence, diamond = OLT, small dot = splice enclosure, ring = distribution point.'));

  const side = el('aside', { class: 'sidepanel', 'aria-label': 'Map controls' },
    canEdit ? el('div', {}, el('h3', {}, 'Add to the map'), el('div', { class: 'actions' },
      el('button', { class: 'btn primary small', id: 'add-device', type: 'button', onclick: () => startMode('device') }, '+ Device'),
      el('button', { class: 'btn primary small', id: 'add-route', type: 'button', onclick: () => startMode('route') }, '+ Route'))) : null,
    el('h3', {}, 'Show on map'), el('div', { class: 'checks' }, checks),
    el('h3', {}, 'Find and filter'), field('Device type', typeSel), field('Status', statusSel), field('Search', search), results, summary,
    el('h3', {}, 'Legend'), legend);

  root.append(el('div', { class: 'mapscreen' }, side, el('div', { class: 'mapwrap' }, mapDiv, modebar,
    el('div', { class: 'mapbtns' },
      el('button', { class: 'btn small', type: 'button', onclick: fitMine }, 'Zoom to my assets'),
      el('button', { class: 'btn small', type: 'button', onclick: () => load().then(() => toast('Map refreshed', 'success')) }, 'Refresh')))));

  // ------------------------------------------------------------ map
  const map = L.map(mapDiv, { center: LAGOS, zoom: 11 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  const layers = { sharedRoutes: L.layerGroup(), free: L.layerGroup(), routes: L.layerGroup(), sharedDevices: L.layerGroup(), devices: L.layerGroup(), alerts: L.layerGroup() };
  Object.values(layers).forEach((g) => g.addTo(map));
  setTimeout(() => { if (!unmounted) map.invalidateSize(); }, 50);
  const onResize = () => { if (!unmounted) map.invalidateSize(); };
  window.addEventListener('resize', onResize);

  // ------------------------------------------------------------ drawing
  const matches = (f, extra) => {
    const p = f.properties;
    if (filter.status && p.status !== filter.status) return false;
    if (extra && filter.type && p.device_type !== filter.type) return false;
    if (filter.q && !`${p.device_code || p.route_code || ''} ${p.name || ''}`.toLowerCase().includes(filter.q)) return false;
    return true;
  };

  function dl(rows) {
    return el('dl', {}, rows.filter(Boolean).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  }

  function deviceIcon(p, other) {
    return L.divIcon({ className: '', html: `<div class="marker ${p.device_type} ${p.status}${other ? ' other' : ''}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  }

  function popupFor(f, kind, latlng) {
    const p = f.properties;
    const isDevice = kind === 'device';
    const box = el('div', { class: 'popup' }, el('h4', {}, p.name || p.route_code || p.device_code),
      dl([['Code', isDevice ? p.device_code : p.route_code], ['Type', label(isDevice ? 'deviceType' : 'routeType', isDevice ? p.device_type : p.route_type)],
        ['Status', badge('status', p.status)], ['Visibility', badge('visibility', p.visibility)],
        isDevice ? null : ['Fibres', `${p.spare_capacity_fibres} spare of ${p.total_fibres}`], isDevice ? null : ['Length', `${(p.length_m / 1000).toFixed(2)} km`],
        ['Installed', p.install_date ? String(p.install_date).slice(0, 10) : 'Not recorded']]),
      el('div', { class: 'actions' },
        canEdit ? el('button', { class: 'btn small', type: 'button', onclick: () => statusModal(kind, f) }, 'Update status') : null,
        canEdit ? el('button', { class: 'btn small', type: 'button', onclick: () => maintModal(kind, f) }, 'Log maintenance') : null,
        canEdit && !isDevice && ['active', 'under_repair'].includes(p.status) ? el('button', { class: 'btn small danger', type: 'button', onclick: () => cutModal(f, latlng) }, 'Report cut') : null,
        el('button', { class: 'btn small', type: 'button', onclick: () => historyModal(kind, f) }, 'History')));
    return box;
  }

  function addRouteLine(group, f, style, onClick) {
    const pts = flip(f.geometry.coordinates);
    const line = L.polyline(pts, style).addTo(group);
    const hit = L.polyline(pts, { weight: 16, opacity: 0, interactive: true }).addTo(group);   // wider invisible line, easier to click
    [line, hit].forEach((x) => x.on('click', (e) => { if (mode === 'route') return addVertex(e.latlng); if (mode) return; onClick(e); }));
    return line;
  }

  function render() {
    Object.values(layers).forEach((g) => g.clearLayers());
    const count = { devices: 0, routes: 0 };

    if (show.sharedRoutes) state.sharedRoutes.forEach((f) => {
      addRouteLine(layers.sharedRoutes, f, { color: '#7b8794', weight: 2, dashArray: '3 6', opacity: .9 }, (e) =>
        L.popup().setLatLng(e.latlng).setContent(el('div', { class: 'popup' }, el('h4', {}, 'Shared route'), dl([['Operator', f.properties.operator_name], ['Code', f.properties.route_code],
          ['Type', label('routeType', f.properties.route_type)], ['Status', badge('status', f.properties.status)], ['Spare fibres', f.properties.spare_capacity_fibres]]))).openOn(map));
    });
    if (show.free) state.free.forEach((f) => {
      addRouteLine(layers.free, f, { color: '#00a86b', weight: 6, opacity: .75 }, (e) =>
        L.popup().setLatLng(e.latlng).setContent(el('div', { class: 'popup' }, el('h4', {}, 'Free route'), dl([['Operator', f.properties.operator_name], ['Code', f.properties.route_code],
          ['Spare fibres', `${f.properties.spare_capacity_fibres} of ${f.properties.total_fibres}`], ['Length', `${(f.properties.length_m / 1000).toFixed(2)} km`]]))).openOn(map));
    });
    if (show.routes) state.routes.filter((f) => matches(f, false) && !filter.type).forEach((f) => {
      count.routes += 1;
      const p = f.properties;
      addRouteLine(layers.routes, f, { color: STATUS_COLOR[p.status] || '#444', weight: ROUTE_WEIGHT[p.route_type] || 3, dashArray: p.status === 'planned' ? '8 8' : null, opacity: .95 },
        (e) => L.popup().setLatLng(e.latlng).setContent(popupFor(f, 'route', e.latlng)).openOn(map));
    });
    if (show.sharedDevices) state.sharedDevices.forEach((f) => {
      const p = f.properties;
      L.marker(ll(f.geometry.coordinates), { icon: deviceIcon(p, true), title: `${label('deviceType', p.device_type)} of ${p.operator_name}` }).addTo(layers.sharedDevices)
        .bindPopup(el('div', { class: 'popup' }, el('h4', {}, 'Shared device'), dl([['Operator', p.operator_name], ['Type', label('deviceType', p.device_type)], ['Status', badge('status', p.status)]])));
    });
    if (show.devices) state.devices.filter((f) => matches(f, true)).forEach((f) => {
      count.devices += 1;
      const m = L.marker(ll(f.geometry.coordinates), { icon: deviceIcon(f.properties, false), title: `${f.properties.device_code} ${f.properties.name}`, keyboard: true }).addTo(layers.devices);
      m.on('click', () => {
        if (mode === 'route') return addVertex(m.getLatLng());
        if (mode) return;
        L.popup().setLatLng(m.getLatLng()).setContent(popupFor(f, 'device')).openOn(map);
      });
    });
    if (show.alerts) state.alerts.filter((a) => a.status !== 'resolved' && a.cut_location).forEach((a) => {
      const pin = L.marker(ll(a.cut_location.coordinates), { icon: L.divIcon({ className: '', html: `<div class="alert-pin ${a.status}">!</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000, title: 'Fibre cut alert' }).addTo(layers.alerts);
      pin.on('click', () => { if (!mode) L.popup().setLatLng(pin.getLatLng()).setContent(alertPopup(a)).openOn(map); });
    });
    renderResults();
    summary.textContent = `Showing ${count.devices} of your devices and ${count.routes} of your routes.`;
  }

  // Matching assets are listed under the search box so one can be found and opened without hunting on the map
  function renderResults() {
    results.replaceChildren();
    if (!filter.q) return;
    const hits = [...state.devices.map((f) => ['device', f]), ...state.routes.map((f) => ['route', f])]
      .filter(([, f]) => `${f.properties.device_code || f.properties.route_code} ${f.properties.name}`.toLowerCase().includes(filter.q)).slice(0, 8);
    if (!hits.length) return results.append(el('small', {}, 'No asset matches.'));
    hits.forEach(([kind, f]) => results.append(el('button', { class: 'btn small result', type: 'button', onclick: () => openAsset(kind, f) },
      `${f.properties.device_code || f.properties.route_code}: ${f.properties.name}`)));
  }
  function openAsset(kind, f) {
    if (kind === 'device') {
      const at = L.latLng(ll(f.geometry.coordinates));
      map.setView(at, 17, { animate: false });
      L.popup().setLatLng(at).setContent(popupFor(f, 'device')).openOn(map);
    } else {
      const pts = flip(f.geometry.coordinates);
      map.fitBounds(L.latLngBounds(pts).pad(0.5), { animate: false, maxZoom: 17 });
      const mid = L.latLng(pts[Math.floor(pts.length / 2)]);
      L.popup().setLatLng(mid).setContent(popupFor(f, 'route', mid)).openOn(map);
    }
  }

  function alertPopup(a) {
    return el('div', { class: 'popup' }, el('h4', {}, `Fibre cut alert ${a.alert_id}`),
      dl([['Status', badge('alert', a.status)], ['Relation', label('relation', a.relation)], a.route_code ? ['Route', a.route_code] : null, a.owner_name ? ['Owner', a.owner_name] : null, ['Raised', fmtDate(a.created_at)]]),
      el('p', {}, a.message), el('a', { class: 'btn small', href: `#/alerts?alert=${a.alert_id}` }, 'Open in Alerts'));
  }

  // ------------------------------------------------------------ data
  async function load() {
    const [devices, routes, sharedRoutes, sharedDevices, free, alerts] = await Promise.all([
      api('GET', '/devices?limit=5000'), api('GET', '/routes?limit=5000'), api('GET', '/shared/routes'), api('GET', '/shared/devices'),
      isManager ? api('GET', '/free-routes') : { features: [] }, api('GET', '/alerts?limit=500')]);
    if (unmounted) return;
    Object.assign(state, { devices: devices.features, routes: routes.features, sharedRoutes: sharedRoutes.features, sharedDevices: sharedDevices.features, free: free.features, alerts });
    render();
  }

  async function reloadAlerts() {
    try { state.alerts = await api('GET', '/alerts?limit=500'); if (!unmounted) render(); } catch { /* ignore */ }
  }

  function fitMine() {
    if (unmounted) return;
    const pts = [...state.devices.map((f) => ll(f.geometry.coordinates)), ...state.routes.flatMap((f) => flip(f.geometry.coordinates))];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1), { animate: false });
  }

  // ------------------------------------------------------------ actions on one asset
  const endpoint = (kind, f) => `/${kind === 'device' ? 'devices' : 'routes'}/${f.id}`;

  function statusModal(kind, f) {
    map.closePopup();
    const isCut = f.properties.status === 'cut';
    const sel = select(optionsOf('status', kind === 'device' ? DEVICE_STATUS : (isCut ? ['cut', ...ROUTE_STATUS] : ROUTE_STATUS)), f.properties.status);
    const note = el('textarea', { maxlength: 500, placeholder: 'Optional note' });
    openModal({ title: `Update status: ${f.properties.device_code || f.properties.route_code}`,
      body: el('div', {}, isCut ? el('p', { class: 'lead' }, 'This route is cut. Resolve its alert in the Alerts page to restore it.') : null, field('New status', sel), field('Note', note)),
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
        if (isCut) throw new Error('Resolve the alert in the Alerts page to restore this route');
        await api('PATCH', endpoint(kind, f) + '/status', { status: sel.value, note: note.value || undefined });
        toast('Status updated', 'success'); await load();
      } }] });
  }

  function maintModal(kind, f) {
    map.closePopup();
    const issue = select(optionsOf('issue', ['equipment_fault', 'fibre_cut', 'vandalism', 'theft', 'power_failure', 'routine_inspection', 'other']), kind === 'device' ? 'equipment_fault' : 'fibre_cut');
    const stat = select(optionsOf('maint', ['open', 'in_progress', 'resolved']), 'open');
    const notes = el('textarea', { maxlength: 1000, placeholder: 'What was found and done' });
    openModal({ title: `Log maintenance: ${f.properties.device_code || f.properties.route_code}`,
      body: el('div', {}, field('Issue', issue), field('Status', stat), field('Notes', notes)),
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
        await api('POST', '/maintenance', { [kind === 'device' ? 'device_id' : 'route_id']: f.id, issue_type: issue.value, status: stat.value, notes: notes.value || undefined });
        toast('Maintenance record saved', 'success');
      } }] });
  }

  async function historyModal(kind, f) {
    map.closePopup();
    const rows = await api('GET', endpoint(kind, f) + '/history').catch(() => []);
    openModal({ title: `Status history: ${f.properties.device_code || f.properties.route_code}`, wide: true,
      body: table([{ title: 'When', render: (r) => fmtDate(r.recorded_at) }, { title: 'From', render: (r) => (r.old_status ? label('status', r.old_status) : '') },
        { title: 'To', render: (r) => label('status', r.new_status) }, { title: 'By', key: 'recorded_by' }, { title: 'Note', key: 'note' }], rows, 'No status changes recorded yet.'),
      actions: [{ label: 'Close', kind: 'primary' }] });
  }

  function cutModal(f, latlng) {
    map.closePopup();
    const useSpot = el('input', { type: 'checkbox', id: 'use-spot' });
    useSpot.checked = Boolean(latlng);
    openModal({ title: `Report a fibre cut: ${f.properties.route_code}`,
      body: el('div', {}, el('p', {}, 'This marks the route as cut and warns the people affected: your own managers, operators connected to this route, and operators with routes within 100 m of the cut.'),
        latlng ? el('label', {}, useSpot, ' Use the point I clicked as the cut location') : el('p', { class: 'lead' }, 'The middle of the route will be used as the cut location.')),
      actions: [{ label: 'Cancel' }, { label: 'Report cut', kind: 'danger', onClick: async () => {
        const body = { route_id: f.id };
        if (latlng && useSpot.checked) { body.longitude = latlng.lng; body.latitude = latlng.lat; }
        const a = await api('POST', '/alerts', body);
        toast(`Alert ${a.alert_id} raised`, 'success'); await load();
      } }] });
  }

  // ------------------------------------------------------------ adding devices and routes
  function startMode(m) {
    cancelMode();
    mode = m;
    mapDiv.classList.add('crosshair');
    modebar.classList.add('on');
    map.closePopup();
    if (m === 'device') {
      modebar.replaceChildren(el('span', {}, 'Click the map where the device is.'), el('button', { class: 'btn small', type: 'button', onclick: cancelMode }, 'Cancel'));
      map.once('click', onDeviceClick);
    } else {
      drawPoints = [];
      drawLine = L.polyline([], { color: '#1b8a8f', weight: 4, dashArray: '6 6' }).addTo(map);
      map.on('click', onRouteClick);
      updateDrawBar();
    }
  }
  function cancelMode() {
    map.off('click', onDeviceClick); map.off('click', onRouteClick);
    if (drawLine) { drawLine.remove(); drawLine = null; }
    drawPoints = [];
    mode = null;
    mapDiv.classList.remove('crosshair');
    modebar.classList.remove('on');
  }
  const onDeviceClick = (e) => { if (mode === 'device') { const at = e.latlng; cancelMode(); deviceForm(at); } };
  const onRouteClick = (e) => addVertex(e.latlng);
  function addVertex(latlng) { drawPoints.push(latlng); drawLine.setLatLngs(drawPoints); updateDrawBar(); }
  function updateDrawBar() {
    modebar.replaceChildren(el('span', {}, `Click to add points along the route (${drawPoints.length} so far). Click a device to start or end exactly on it.`),
      el('button', { class: 'btn small', type: 'button', onclick: () => { drawPoints.pop(); drawLine.setLatLngs(drawPoints); updateDrawBar(); } }, 'Undo'),
      el('button', { class: 'btn small primary', id: 'finish-route', type: 'button', disabled: drawPoints.length < 2, onclick: finishRoute }, 'Finish'),
      el('button', { class: 'btn small', type: 'button', onclick: cancelMode }, 'Cancel'));
  }

  function deviceForm(at) {
    const f = {
      code: el('input', { type: 'text', maxlength: 40, placeholder: 'For example LAG-TWR-20' }), name: el('input', { type: 'text', maxlength: 120 }),
      type: select(optionsOf('deviceType', ['tower', 'olt', 'pop', 'splice_enclosure', 'distribution_point']), 'splice_enclosure'),
      status: select(optionsOf('status', DEVICE_STATUS), 'active'), vis: select(optionsOf('visibility', ['private', 'shared']), 'private'),
      date: el('input', { type: 'date' }), lng: el('input', { type: 'number', step: 'any' }), lat: el('input', { type: 'number', step: 'any' }),
    };
    f.lng.value = at.lng.toFixed(6); f.lat.value = at.lat.toFixed(6);
    openModal({ title: 'Register a device',
      body: el('div', {}, field('Device code', f.code, 'Letters, numbers, dot, dash and underscore'), field('Name', f.name), el('div', { class: 'row2' }, field('Type', f.type), field('Status', f.status)),
        el('div', { class: 'row2' }, field('Visibility', f.vis, 'Shared devices show location, type and status to other operators'), field('Installed on', f.date)),
        el('div', { class: 'row2' }, field('Longitude', f.lng), field('Latitude', f.lat))),
      actions: [{ label: 'Cancel' }, { label: 'Register', kind: 'primary', onClick: async () => {
        await api('POST', '/devices', { device_code: f.code.value, name: f.name.value, device_type: f.type.value, status: f.status.value, visibility: f.vis.value,
          install_date: f.date.value || undefined, longitude: Number(f.lng.value), latitude: Number(f.lat.value) });
        toast('Device registered', 'success'); await load();
      } }] });
  }

  function nearestDevice(latlng) {
    let best = null; let bestD = 60;
    state.devices.forEach((d) => { const dist = latlng.distanceTo(L.latLng(ll(d.geometry.coordinates))); if (dist < bestD) { best = d; bestD = dist; } });
    return best ? best.properties.device_code : '';
  }

  function finishRoute() {
    const pts = drawPoints.slice();
    cancelMode();
    const devOptions = [['', 'None'], ...state.devices.map((d) => [d.properties.device_code, `${d.properties.device_code}: ${d.properties.name}`])];
    const f = {
      code: el('input', { type: 'text', maxlength: 40, placeholder: 'For example LAG-IKR-BB-09' }), name: el('input', { type: 'text', maxlength: 120 }),
      type: select(optionsOf('routeType', ['backbone', 'feeder', 'distribution', 'drop']), 'distribution'),
      status: select(optionsOf('status', ['active', 'planned']), 'active'), vis: select(optionsOf('visibility', ['private', 'shared']), 'private'),
      total: el('input', { type: 'number', min: 0, max: 10000, value: 24 }), spare: el('input', { type: 'number', min: 0, max: 10000, value: 0 }),
      start: select(devOptions, nearestDevice(pts[0])), end: select(devOptions, nearestDevice(pts[pts.length - 1])), date: el('input', { type: 'date' }),
    };
    const tmp = L.polyline(pts, { color: '#1b8a8f', weight: 4, dashArray: '6 6' }).addTo(map);
    openModal({ title: 'Register a fibre route', wide: true, onClose: () => tmp.remove(),
      body: el('div', {}, field('Route code', f.code), field('Name', f.name),
        el('div', { class: 'row2' }, field('Type', f.type), field('Status', f.status)),
        el('div', { class: 'row2' }, field('Total fibres', f.total), field('Spare fibres', f.spare, 'Unused fibres you could make available to others')),
        el('div', { class: 'row2' }, field('Starts at device', f.start, 'Preselected if you started on a device'), field('Ends at device', f.end)),
        el('div', { class: 'row2' }, field('Visibility', f.vis, 'Shared routes are visible to other operators with limited fields'), field('Installed on', f.date))),
      actions: [{ label: 'Cancel' }, { label: 'Register', kind: 'primary', onClick: async () => {
        await api('POST', '/routes', { route_code: f.code.value, name: f.name.value, route_type: f.type.value, status: f.status.value, visibility: f.vis.value,
          total_fibres: Number(f.total.value), spare_capacity_fibres: Number(f.spare.value), start_device: f.start.value || undefined, end_device: f.end.value || undefined,
          install_date: f.date.value || undefined, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) } });
        toast('Route registered', 'success'); await load();
      } }] });
  }

  // ------------------------------------------------------------ start
  try { await load(); } catch (e) { toast(e.message, 'error'); }
  if (unmounted) return {};
  fitMine();
  const target = ctx.params.get('alert');
  if (target) {
    const a = state.alerts.find((x) => String(x.alert_id) === target);
    if (a && a.cut_location) { map.setView(ll(a.cut_location.coordinates), 16, { animate: false }); L.popup().setLatLng(ll(a.cut_location.coordinates)).setContent(alertPopup(a)).openOn(map); }
  }

  return {
    unmount() { unmounted = true; cancelMode(); window.removeEventListener('resize', onResize); map.stop(); map.remove(); },
    onNotifications() { reloadAlerts(); },
  };
}
