let map, markers = {}, trails = {}, foodMarkers = [];
let people = [];
let browserWatchId = null;

const SEOUL = [37.5665, 126.978];

init();

async function init() {
  map = L.map('map', { zoomControl: false }).setView(SEOUL, 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  for (const id of ['who-btn', 'who-btn-m'])
    document.getElementById(id)?.addEventListener('click', () => promptMe(true).then(refreshAll));
  for (const id of ['browser-loc-btn', 'browser-loc-btn-m'])
    document.getElementById(id)?.addEventListener('click', toggleBrowserLocation);
  document.getElementById('find-food-btn').addEventListener('click', findFood);
  document.getElementById('add-bill-btn').addEventListener('click', openBillDialog);
  document.querySelectorAll('dialog [data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));
  document.getElementById('prefs-form').addEventListener('submit', savePrefs);
  document.getElementById('bill-form').addEventListener('submit', submitBill);
  document.getElementById('scan-btn').addEventListener('click', scanBill);
  document.querySelectorAll('#split-toggle button').forEach((b) =>
    b.addEventListener('click', () => setSplitMode(b.dataset.mode)));

  await adoptServerIdentity();
  updateWho();
  await refreshAll();
  fitToPeople();
  pollMqttStatus();

  connectEvents({
    location: (d) => {
      const p = people.find((x) => x.name === d.name);
      if (p) { p.location = d.location; p.lastSeen = d.location.at; }
      else refreshPeople();
      updateMarker(d.name, d.location);
      renderPeople();
    },
    person: () => refreshPeople(),
    bill: () => refreshBills(),
    mqtt: (s) => renderMqttStatus(s)
  });
}

function updateWho() {
  const label = `👤 ${getMe() || 'Set your name'}`;
  for (const id of ['who-btn', 'who-btn-m']) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

async function refreshAll() {
  updateWho();
  const me = getMe();
  if (me) await api.post('/api/people', { name: me }).catch(() => {});
  await refreshPeople();
  await refreshBills();
}

async function refreshPeople() {
  people = await api.get('/api/people');
  renderPeople();
  renderPrefs();
  for (const p of people) {
    if (p.location) updateMarker(p.name, p.location, p);
    else removeMarker(p.name);
  }
}

/* ---------- MQTT status pill ---------- */
async function pollMqttStatus() {
  try {
    const s = await api.get('/api/status');
    renderMqttStatus(s.mqtt);
    window.scanAvailable = s.scan;
  } catch {}
  setTimeout(pollMqttStatus, 30000);
}

function renderMqttStatus(s) {
  const el = document.getElementById('mqtt-status');
  if (!s.configured) {
    el.className = 'map-status off';
    el.innerHTML = '<span class="dot"></span>MQTT not configured';
  } else if (s.connected) {
    el.className = 'map-status on';
    el.innerHTML = '<span class="dot"></span>Live via MQTT';
  } else {
    el.className = 'map-status off';
    el.innerHTML = '<span class="dot"></span>MQTT reconnecting…';
  }
}

/* ---------- markers ---------- */
function personIcon(p) {
  const initial = p.name.slice(0, 1).toUpperCase();
  return L.divIcon({
    className: '',
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    html: `<div style="width:38px;height:38px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);
             background:${p.color};box-shadow:0 3px 8px rgba(26,22,18,.4);border:2.5px solid #f4ede1;
             display:flex;align-items:center;justify-content:center;">
             <span style="transform:rotate(45deg);color:#f4ede1;font-weight:700;font-family:Fraunces,serif;font-size:16px;">${esc(initial)}</span>
           </div>`
  });
}

function updateMarker(name, loc, personHint) {
  const p = personHint || people.find((x) => x.name === name);
  if (!p || !loc) return;
  const pos = [loc.lat, loc.lon];
  if (markers[name]) {
    markers[name].setLatLng(pos);
  } else {
    markers[name] = L.marker(pos, { icon: personIcon(p) }).addTo(map);
  }
  markers[name].bindPopup(
    `<strong>${esc(name)}</strong><br>${timeAgo(loc.at)}${loc.batt != null ? ` · 🔋${loc.batt}%` : ''}${loc.acc ? ` · ±${Math.round(loc.acc)}m` : ''}`
  );
  const trail = (p.trail || []).map((t) => [t.lat, t.lon]);
  if (trail.length > 1) {
    if (trails[name]) trails[name].setLatLngs(trail);
    else trails[name] = L.polyline(trail, { color: p.color, weight: 3, opacity: 0.35, dashArray: '4 6' }).addTo(map);
  }
}

function removeMarker(name) {
  if (markers[name]) { map.removeLayer(markers[name]); delete markers[name]; }
  if (trails[name]) { map.removeLayer(trails[name]); delete trails[name]; }
}

function fitToPeople() {
  const pts = people.filter((p) => p.location).map((p) => [p.location.lat, p.location.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 16 });
}

/* ---------- people list ---------- */
function renderPeople() {
  const el = document.getElementById('people-list');
  if (!people.length) {
    el.innerHTML = '<div class="empty">Nobody here yet — set your name above to join.</div>';
    return;
  }
  const me = getMe();
  el.innerHTML = people.map((p) => `
    <div class="person-row" data-name="${esc(p.name)}">
      <div class="avatar" style="background:${p.color}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
      <div class="person-main">
        <div class="nm">${esc(p.name)} ${p.name === me ? '<span class="tag">you</span>' : ''}</div>
        <div class="meta">
          ${p.sharing
            ? p.location
              ? `📍 ${timeAgo(p.location.at)}${p.location.batt != null ? ` · 🔋${p.location.batt}%` : ''}`
              : '📍 sharing — waiting for first position…'
            : '🙈 location hidden'}
        </div>
      </div>
      <div class="person-actions">
        ${p.location ? `<button class="btn small" data-act="focus">◎</button>` : ''}
        <label class="switch" title="Location sharing">
          <input type="checkbox" data-act="share" ${p.sharing ? 'checked' : ''}>
          <span class="track"></span>
        </label>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.person-row').forEach((row) => {
    const name = row.dataset.name;
    row.querySelector('[data-act=share]').addEventListener('change', async (e) => {
      const sharing = e.target.checked;
      if (!sharing && !confirm(`Stop sharing ${name}'s location? Their position is removed from the map.`)) {
        e.target.checked = true;
        return;
      }
      await api.put(`/api/people/${encodeURIComponent(name)}/sharing`, { sharing });
      await refreshPeople();
    });
    row.querySelector('[data-act=focus]')?.addEventListener('click', () => {
      const p = people.find((x) => x.name === name);
      if (p?.location) {
        map.setView([p.location.lat, p.location.lon], 16);
        markers[name]?.openPopup();
      }
    });
  });
}

/* ---------- browser geolocation fallback ---------- */
async function toggleBrowserLocation() {
  const btns = ['browser-loc-btn', 'browser-loc-btn-m'].map((id) => document.getElementById(id)).filter(Boolean);
  const me = await promptMe();
  if (!me) return;
  if (browserWatchId != null) {
    navigator.geolocation.clearWatch(browserWatchId);
    browserWatchId = null;
    btns.forEach((b) => (b.textContent = '📡 Send my location'));
    return;
  }
  if (!navigator.geolocation) return alert('This browser has no geolocation.');
  browserWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      await api.post(`/api/people/${encodeURIComponent(me)}/location`, {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        acc: pos.coords.accuracy
      }).catch(() => {});
    },
    (err) => {
      alert('Location error: ' + err.message);
      navigator.geolocation.clearWatch(browserWatchId);
      browserWatchId = null;
      btns.forEach((b) => (b.textContent = '📡 Send my location'));
    },
    { enableHighAccuracy: true, maximumAge: 15000 }
  );
  btns.forEach((b) => (b.textContent = '⏹ Stop sending'));
}

/* ---------- food preferences ---------- */
function renderPrefs() {
  const el = document.getElementById('prefs-box');
  el.innerHTML = people.map((p) => `
    <div class="person-row">
      <div class="avatar" style="background:${p.color}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
      <div class="person-main">
        <div class="nm">${esc(p.name)}</div>
        <div class="chips">
          ${p.prefs.preferred.map((t) => `<span class="chip love">😍 ${esc(t)}</span>`).join('')}
          ${p.prefs.okay.map((t) => `<span class="chip">🙂 ${esc(t)}</span>`).join('')}
          ${p.prefs.no.map((t) => `<span class="chip no">🚫 ${esc(t)}</span>`).join('')}
          ${!p.prefs.preferred.length && !p.prefs.okay.length && !p.prefs.no.length ? '<span class="chip">no preferences yet</span>' : ''}
        </div>
      </div>
      <button class="btn small" data-name="${esc(p.name)}">Edit</button>
    </div>
  `).join('') || '<div class="empty">Add people first.</div>';

  el.querySelectorAll('button[data-name]').forEach((b) =>
    b.addEventListener('click', () => openPrefsDialog(b.dataset.name)));
}

let prefsFor = null;
function openPrefsDialog(name) {
  prefsFor = name;
  const p = people.find((x) => x.name === name);
  document.getElementById('prefs-dialog-title').textContent = `${name} — food preferences`;
  const f = document.getElementById('prefs-form');
  f.elements.preferred.value = p.prefs.preferred.join(', ');
  f.elements.okay.value = p.prefs.okay.join(', ');
  f.elements.no.value = p.prefs.no.join(', ');
  document.getElementById('prefs-dialog').showModal();
}

async function savePrefs(e) {
  const fd = new FormData(e.target);
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  await api.put(`/api/people/${encodeURIComponent(prefsFor)}/prefs`, {
    preferred: split(fd.get('preferred')),
    okay: split(fd.get('okay')),
    no: split(fd.get('no'))
  });
  await refreshPeople();
}

/* ---------- food search ---------- */
async function findFood() {
  const btn = document.getElementById('find-food-btn');
  const out = document.getElementById('food-results');
  const radius = document.getElementById('food-radius').value;
  btn.disabled = true;
  btn.textContent = 'Searching…';
  out.innerHTML = '<div class="empty">Asking OpenStreetMap for restaurants nearby…</div>';
  try {
    let url = `/api/food/search?radius=${radius}`;
    const center = map.getCenter();
    const anyShared = people.some((p) => p.sharing && p.location);
    if (!anyShared) url += `&lat=${center.lat}&lon=${center.lng}`;
    const data = await api.get(url);
    renderFood(data);
  } catch (err) {
    out.innerHTML = `<div class="empty">😕 ${esc(err.message)}<br><small>Tip: with no shared locations we search the map center — pan the map first.</small></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔎 Find food near us';
  }
}

function renderFood(data) {
  const out = document.getElementById('food-results');
  foodMarkers.forEach((m) => map.removeLayer(m));
  foodMarkers = [];

  if (!data.results.length) {
    out.innerHTML = '<div class="empty">No restaurants found in this radius — try a bigger one.</div>';
    return;
  }
  const top = data.results.slice(0, 12);
  const total = data.peopleConsidered.length;

  out.innerHTML = `
    <p class="hint" style="margin-top:1.2rem;">Ranked for ${total ? `${total} ${total === 1 ? 'person' : 'people'} with preferences` : 'the group'} · ${data.results.length} places found</p>
    ${top.map((r, i) => `
      <div class="food-row" data-i="${i}">
        <div class="food-rank ${i === 0 ? 'gold' : ''}">${i + 1}.</div>
        <div class="food-main">
          <div class="nm">${esc(r.name)} ${r.nameKo && r.nameKo !== r.name ? `<span class="ko">${esc(r.nameKo)}</span>` : ''}</div>
          <div class="meta">${r.cuisine ? esc(r.cuisine) + ' · ' : ''}${r.distance} m away</div>
          ${total ? `
            <div class="match-bar"><div style="width:${Math.round((r.okCount / total) * 100)}%"></div></div>
            <div class="meta" style="margin-top:0.25rem;">
              works for ${r.okCount}/${total}
              ${r.likedBy.length ? ' · 😍 ' + r.likedBy.map((l) => esc(l.name)).join(', ') : ''}
              ${r.vetoedBy.length ? ` · <span class="veto-note">🚫 ${r.vetoedBy.map((v) => `${esc(v.name)} (${esc(v.term)})`).join(', ')}</span>` : ''}
            </div>` : ''}
        </div>
        <button class="btn small" data-act="show">◎</button>
      </div>
    `).join('')}
  `;

  top.forEach((r, i) => {
    const m = L.circleMarker([r.lat, r.lon], {
      radius: 9,
      color: '#f4ede1',
      weight: 2,
      fillColor: i === 0 ? '#b8893a' : '#8a2818',
      fillOpacity: 0.92
    }).addTo(map).bindPopup(
      `<strong>${i + 1}. ${esc(r.name)}</strong><br>${r.cuisine ? esc(r.cuisine) + '<br>' : ''}${r.distance} m · <a href="${r.osmUrl}" target="_blank" rel="noopener">OSM</a>`
    );
    foodMarkers.push(m);
  });

  out.querySelectorAll('[data-act=show]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.closest('.food-row').dataset.i);
      map.setView([top[i].lat, top[i].lon], 17);
      foodMarkers[i]?.openPopup();
    }));

  if (top.length) {
    map.fitBounds(L.latLngBounds(top.map((r) => [r.lat, r.lon])).pad(0.2), { maxZoom: 16 });
  }
}

/* ---------- bills ---------- */
let scanState = { items: [], photoPath: null, splitMode: 'even' };

async function openBillDialog() {
  const me = await promptMe();
  const dlg = document.getElementById('bill-dialog');
  const form = document.getElementById('bill-form');
  form.reset();
  scanState = { items: [], photoPath: null, splitMode: 'even' };
  document.getElementById('scan-status').textContent = '';
  document.getElementById('split-toggle').hidden = true;
  document.getElementById('scan-items').hidden = true;
  document.getElementById('items-note').hidden = true;
  setSplitMode('even');

  const paidBy = document.getElementById('bill-paidby');
  paidBy.innerHTML = people.map((p) => `<option ${p.name === me ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

  // Detect who's at the restaurant right now (near the payer).
  const note = document.getElementById('detect-note');
  note.textContent = '· detecting from locations…';
  let detected = [];
  try {
    const d = await api.get(`/api/bills/nearby?payer=${encodeURIComponent(me || '')}`);
    detected = d.detected.map((x) => x.name);
    note.textContent = detected.length
      ? `· 📍 auto-detected ${detected.length} nearby`
      : '· no one detected nearby — pick manually';
  } catch {
    note.textContent = '';
  }

  const box = document.getElementById('bill-participants');
  box.innerHTML = people.map((p) => {
    const on = detected.includes(p.name) || p.name === me;
    return `<span class="detect-chip ${on ? 'on' : ''}" data-name="${esc(p.name)}">${on ? '✓ ' : ''}${esc(p.name)}</span>`;
  }).join('') || '<span class="chip">Add people first</span>';
  box.querySelectorAll('.detect-chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      chip.textContent = (chip.classList.contains('on') ? '✓ ' : '') + chip.dataset.name;
      renderScanItems(); // assignment chips depend on who's included
    }));

  dlg.showModal();
}

function currentParticipants() {
  return [...document.querySelectorAll('#bill-participants .detect-chip.on')].map((c) => c.dataset.name);
}

async function scanBill() {
  const form = document.getElementById('bill-form');
  const file = form.elements.photo.files[0];
  const status = document.getElementById('scan-status');
  if (!file) {
    status.textContent = 'Pick or snap a photo first.';
    return;
  }
  const btn = document.getElementById('scan-btn');
  btn.disabled = true;
  status.textContent = 'Claude is reading the bill…';
  try {
    const fd = new FormData();
    fd.append('photo', file);
    const r = await fetch('/api/bills/scan', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'scan failed');
    scanState.photoPath = data.photoPath;
    if (!data.is_receipt) {
      status.textContent = "That doesn't look like a receipt — enter the amount manually.";
      return;
    }
    if (data.total > 0) form.elements.amount.value = data.total;
    if (data.currency) form.elements.currency.value = data.currency.toUpperCase();
    if (data.title && !form.elements.title.value) form.elements.title.value = data.title;
    scanState.items = (data.items || []).map((it) => ({ ...it, assignedTo: [] }));
    if (scanState.items.length) {
      document.getElementById('split-toggle').hidden = false;
      status.textContent = `Read ${scanState.items.length} items · total ${data.total} ${data.currency}`;
    } else {
      status.textContent = `Read total ${data.total} ${data.currency} (no line items found)`;
    }
    renderScanItems();
  } catch (err) {
    status.textContent = '⚠ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

function setSplitMode(mode) {
  scanState.splitMode = mode;
  document.querySelectorAll('#split-toggle button').forEach((b) =>
    b.classList.toggle('on', b.dataset.mode === mode));
  const showItems = mode === 'items' && scanState.items.length;
  document.getElementById('scan-items').hidden = !showItems;
  document.getElementById('items-note').hidden = !showItems;
  if (showItems) renderScanItems();
}

function renderScanItems() {
  const box = document.getElementById('scan-items');
  if (scanState.splitMode !== 'items' || !scanState.items.length) return;
  const participants = currentParticipants();
  box.innerHTML = scanState.items.map((it, i) => `
    <div class="scan-item" data-i="${i}">
      <span class="nm">${esc(it.name)}${it.quantity > 1 ? ` ×${it.quantity}` : ''}</span>
      <span class="pr">${it.price.toLocaleString()}</span>
      <span class="assign">
        ${participants.map((p) => `
          <span class="assign-chip ${it.assignedTo.includes(p) ? 'on' : ''}" data-p="${esc(p)}">${esc(p)}</span>
        `).join('')}
        ${!participants.length ? '<span class="chip">pick participants above</span>' : ''}
      </span>
    </div>
  `).join('');
  box.querySelectorAll('.scan-item').forEach((row) => {
    const item = scanState.items[Number(row.dataset.i)];
    row.querySelectorAll('.assign-chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const p = chip.dataset.p;
        const idx = item.assignedTo.indexOf(p);
        if (idx >= 0) item.assignedTo.splice(idx, 1);
        else item.assignedTo.push(p);
        chip.classList.toggle('on');
      }));
  });
}

async function submitBill(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  fd.set('participants', JSON.stringify(currentParticipants()));
  fd.set('splitMode', scanState.splitMode);
  fd.set('items', JSON.stringify(scanState.splitMode === 'items' ? scanState.items : []));
  if (scanState.photoPath) {
    // Photo already uploaded during scan — reference it instead of re-uploading.
    fd.delete('photo');
    fd.set('photoPath', scanState.photoPath);
  } else if (!form.elements.photo.files[0]) {
    fd.delete('photo');
  }
  const r = await fetch('/api/bills', { method: 'POST', body: fd });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    alert(err.error || 'Failed to save bill');
    return;
  }
  document.getElementById('bill-dialog').close();
  await refreshBills();
}

async function refreshBills() {
  const { bills, summary } = await api.get('/api/bills');
  const list = document.getElementById('bills-list');
  const sEl = document.getElementById('settlement');

  const currencies = Object.entries(summary || {});
  sEl.innerHTML = currencies.map(([cur, s]) =>
    s.transfers.length
      ? `<p class="hint" style="margin:1.2rem 0 0.2rem;">To settle up (${cur}):</p>` +
        s.transfers.map((t) => `
          <div class="transfer"><em>${esc(t.from)}</em> pays <em>${esc(t.to)}</em><span class="amt">${fmtMoney(t.amount, cur)}</span></div>
        `).join('')
      : ''
  ).join('') || '';

  list.innerHTML = bills.length ? bills.map((b) => {
    const shareNote = b.splitMode === 'items'
      ? 'by items'
      : `split ${b.participants.length} way${b.participants.length === 1 ? '' : 's'}`;
    const sharesDetail = b.shares
      ? Object.entries(b.shares).map(([n, v]) => `${n}: ${fmtMoney(v, b.currency)}`).join(' · ')
      : '';
    return `
    <div class="bill-row">
      ${b.photo
        ? `<a href="${b.photo}" target="_blank" rel="noopener"><img class="bill-thumb" src="${b.photo}" alt="bill"></a>`
        : '<div class="bill-thumb">🧾</div>'}
      <div class="bill-main">
        <div class="amt">${fmtMoney(b.amount, b.currency)} <span class="ttl">· ${esc(b.title)}</span></div>
        <div class="meta" title="${esc(sharesDetail)}">${esc(b.paidBy)} paid · ${shareNote} (${b.participants.map(esc).join(', ')}) · ${timeAgo(b.createdAt)}</div>
      </div>
      <button class="btn small danger" data-id="${b.id}">✕</button>
    </div>`;
  }).join('') : '<div class="empty">No bills yet — go eat something great.</div>';

  list.querySelectorAll('button[data-id]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this bill?')) return;
      await api.del(`/api/bills/${btn.dataset.id}`);
      await refreshBills();
    }));
}
