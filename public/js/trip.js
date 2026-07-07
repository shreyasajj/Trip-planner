let tripData = null;
let editingFlight = null;
let editingDay = null;

init();

async function init() {
  document.getElementById('who-btn').addEventListener('click', () => promptMe(true).then(updateWho));
  updateWho();
  wireDialogs();
  await load();
  checkFlightApi();
}

function updateWho() {
  document.getElementById('who-btn').textContent = `👤 ${getMe() || 'Set your name'}`;
}

async function load() {
  tripData = await api.get('/api/trip');
  renderHeader();
  renderFlights();
  renderItinerary();
}

async function checkFlightApi() {
  // Ask the server about one flight to learn whether an API key is configured.
  const note = document.getElementById('flight-api-note');
  const f = tripData.flights[0];
  if (!f) return;
  try {
    const s = await api.get(`/api/flights/${f.id}/status`);
    if (!s.available) {
      note.innerHTML = '⚠️ No flight API key configured — statuses are manual. See the README to enable live delays.';
    } else {
      applyStatus(f.id, s);
    }
  } catch {}
}

/* ---------- header ---------- */
function renderHeader() {
  const t = tripData.trip;
  document.getElementById('trip-name').textContent = t.name;
  document.title = `${t.name} · Itinerary`;
  document.getElementById('trip-dates').textContent =
    t.startDate && t.endDate ? `${fmtDate(t.startDate)} → ${fmtDate(t.endDate)}` : '';

  const cd = document.getElementById('countdown');
  if (t.startDate) {
    const now = new Date();
    const start = new Date(t.startDate + 'T00:00:00');
    const end = t.endDate ? new Date(t.endDate + 'T23:59:59') : start;
    const days = Math.ceil((start - now) / 86400000);
    cd.hidden = false;
    if (now < start) cd.innerHTML = `<strong>${days}</strong> day${days === 1 ? '' : 's'} until takeoff 🛫`;
    else if (now <= end) cd.innerHTML = `🇰🇷 <strong>We're in Korea!</strong> Enjoy day ${Math.floor((now - start) / 86400000) + 1}`;
    else cd.innerHTML = `Trip complete — <strong>안녕히!</strong> Time to plan the next one`;
  } else cd.hidden = true;

  const notes = document.getElementById('notes-card');
  notes.hidden = !t.notes;
  document.getElementById('trip-notes').textContent = t.notes || '';
}

/* ---------- flights ---------- */
function renderFlights() {
  const el = document.getElementById('flights');
  if (!tripData.flights.length) {
    el.innerHTML = '<div class="empty">No flights yet — add your first one.</div>';
    return;
  }
  el.innerHTML = tripData.flights.map((f) => `
    <div class="flight" data-id="${f.id}">
      <div class="flight-top">
        <div class="flight-route">
          <span>${esc(f.from || '???')}<span class="times">${esc(f.depTimeLocal || '')}</span></span>
          <span class="plane">✈</span>
          <span>${esc(f.to || '???')}<span class="times">${esc(f.arrTimeLocal || '')}</span></span>
        </div>
        <span class="badge muted status-badge">Scheduled</span>
      </div>
      <div class="flight-meta">
        <strong>${esc(f.flightNumber)}</strong>${f.airline ? ' · ' + esc(f.airline) : ''} · ${fmtDate(f.date)}${f.notes ? ' · ' + esc(f.notes) : ''}
      </div>
      <div class="flight-status" hidden></div>
      <div class="section-actions">
        <button class="btn small primary" data-act="status">Check status</button>
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small danger" data-act="del">Delete</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.flight').forEach((card) => {
    const f = tripData.flights.find((x) => x.id === card.dataset.id);
    if (f.status?.found) applyStatus(f.id, f.status);
    card.querySelector('[data-act=status]').addEventListener('click', () => checkStatus(f.id, card));
    card.querySelector('[data-act=edit]').addEventListener('click', () => openFlightDialog(f));
    card.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!confirm(`Delete flight ${f.flightNumber}?`)) return;
      await api.del(`/api/flights/${f.id}`);
      await load();
    });
  });
}

async function checkStatus(fid, card) {
  const btn = card.querySelector('[data-act=status]');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const s = await api.get(`/api/flights/${fid}/status`);
    applyStatus(fid, s);
  } catch (err) {
    alert('Status check failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check status';
  }
}

function applyStatus(fid, s) {
  const card = document.querySelector(`.flight[data-id="${fid}"]`);
  if (!card) return;
  const badge = card.querySelector('.status-badge');
  const detail = card.querySelector('.flight-status');

  if (!s.available) {
    badge.className = 'badge muted status-badge';
    badge.textContent = 'No live data';
    detail.hidden = false;
    detail.textContent = s.reason || 'Flight API not configured.';
    return;
  }
  if (!s.found) {
    badge.className = 'badge muted status-badge';
    badge.textContent = 'Not found yet';
    detail.hidden = false;
    detail.textContent = 'The provider has no data for this flight/date yet — try closer to departure.';
    return;
  }

  const delay = s.depDelayMin ?? 0;
  const cancelled = /cancel/i.test(s.status || '');
  badge.className = 'badge status-badge ' + (cancelled ? 'bad' : delay >= 30 ? 'bad' : delay >= 10 ? 'warn' : 'ok');
  badge.textContent = cancelled ? 'Cancelled' : delay >= 10 ? `Delayed ${delay} min` : (s.status || 'On time');

  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  detail.hidden = false;
  detail.innerHTML = `
    <div class="row">
      <span>Status: <strong>${esc(s.status)}</strong></span>
      <span>Dep: ${fmt(s.depScheduled)}${s.depEstimated ? ` → <span class="delay-num">${fmt(s.depEstimated)}</span>` : ''}</span>
      <span>Arr: ${fmt(s.arrScheduled)}${s.arrEstimated ? ` → <span class="delay-num">${fmt(s.arrEstimated)}</span>` : ''}</span>
      ${s.depGate ? `<span>Gate <strong>${esc(s.depGate)}</strong>${s.depTerminal ? ' · T' + esc(s.depTerminal) : ''}</span>` : ''}
    </div>
    <div style="margin-top:4px; color: var(--ink-faint); font-size:12px;">via ${esc(s.provider)} · ${timeAgo(s.fetchedAt)}</div>
  `;
}

/* ---------- itinerary ---------- */
function renderItinerary() {
  const el = document.getElementById('itinerary');
  if (!tripData.itinerary.length) {
    el.innerHTML = '<div class="empty">No days planned yet.</div>';
    return;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  el.innerHTML = tripData.itinerary.map((d) => `
    <div class="day ${d.date === todayIso ? 'today' : ''}" data-id="${d.id}">
      <div class="day-head">
        <span class="day-date">${fmtDate(d.date)}</span>
        ${d.city ? `<span class="day-city">${esc(d.city)}</span>` : ''}
        ${d.title ? `<span class="day-title">${esc(d.title)}</span>` : ''}
        ${d.date === todayIso ? '<span class="badge ok">Today</span>' : ''}
      </div>
      ${d.stay ? `
        <div class="stay">🏨 <strong>${esc(d.stay.name)}</strong>
          ${d.stay.address ? `<div class="addr">${esc(d.stay.address)}</div>` : ''}
          ${d.stay.checkIn ? `<div class="addr">Check-in ${fmtDate(d.stay.checkIn)}${d.stay.checkOut ? ` · out ${fmtDate(d.stay.checkOut)}` : ''}</div>` : ''}
        </div>` : ''}
      ${(d.items || []).map((it) => `
        <div class="plan-item"><span class="t">${esc(it.time || '·')}</span><span>${esc(it.text)}</span></div>
      `).join('')}
      <div class="day-tools">
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small danger" data-act="del">Delete</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.day').forEach((node) => {
    const d = tripData.itinerary.find((x) => x.id === node.dataset.id);
    node.querySelector('[data-act=edit]').addEventListener('click', () => openDayDialog(d));
    node.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!confirm(`Delete ${fmtDate(d.date)}?`)) return;
      await api.del(`/api/itinerary/${d.id}`);
      await load();
    });
  });
}

/* ---------- dialogs ---------- */
function wireDialogs() {
  document.querySelectorAll('dialog [data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  document.getElementById('add-flight-btn').addEventListener('click', () => openFlightDialog(null));
  document.getElementById('add-day-btn').addEventListener('click', () => openDayDialog(null));
  document.getElementById('edit-trip-btn').addEventListener('click', openTripDialog);
  document.getElementById('refresh-all-btn').addEventListener('click', async () => {
    for (const f of tripData.flights) {
      const card = document.querySelector(`.flight[data-id="${f.id}"]`);
      if (card) await checkStatus(f.id, card);
    }
  });

  document.getElementById('flight-form').addEventListener('submit', async (e) => {
    const data = Object.fromEntries(new FormData(e.target));
    if (editingFlight) await api.put(`/api/flights/${editingFlight.id}`, data);
    else await api.post('/api/flights', data);
    await load();
  });

  document.getElementById('day-form').addEventListener('submit', async (e) => {
    const fd = new FormData(e.target);
    const items = String(fd.get('plan') || '').split('\n').map((line) => {
      const m = line.trim().match(/^(\d{1,2}:\d{2})\s+(.*)$/);
      if (m) return { time: m[1], text: m[2] };
      return line.trim() ? { time: '', text: line.trim() } : null;
    }).filter(Boolean);
    const stayName = String(fd.get('stayName') || '').trim();
    const day = {
      date: fd.get('date'),
      city: fd.get('city'),
      title: fd.get('title'),
      items,
      stay: stayName ? { name: stayName, address: String(fd.get('stayAddress') || '').trim() } : null
    };
    if (editingDay) await api.put(`/api/itinerary/${editingDay.id}`, day);
    else await api.post('/api/itinerary', day);
    await load();
  });

  document.getElementById('trip-form').addEventListener('submit', async (e) => {
    await api.put('/api/trip', Object.fromEntries(new FormData(e.target)));
    await load();
  });
}

function openFlightDialog(flight) {
  editingFlight = flight;
  const dlg = document.getElementById('flight-dialog');
  document.getElementById('flight-dialog-title').textContent = flight ? `Edit ${flight.flightNumber}` : 'Add flight';
  const form = document.getElementById('flight-form');
  form.reset();
  if (flight) for (const [k, v] of Object.entries(flight)) if (form.elements[k]) form.elements[k].value = v ?? '';
  dlg.showModal();
}

function openDayDialog(day) {
  editingDay = day;
  const dlg = document.getElementById('day-dialog');
  document.getElementById('day-dialog-title').textContent = day ? `Edit ${fmtDate(day.date)}` : 'Add a day';
  const form = document.getElementById('day-form');
  form.reset();
  if (day) {
    form.elements.date.value = day.date || '';
    form.elements.city.value = day.city || '';
    form.elements.title.value = day.title || '';
    form.elements.stayName.value = day.stay?.name || '';
    form.elements.stayAddress.value = day.stay?.address || '';
    form.elements.plan.value = (day.items || []).map((i) => (i.time ? i.time + ' ' : '') + i.text).join('\n');
  }
  dlg.showModal();
}

function openTripDialog() {
  const form = document.getElementById('trip-form');
  const t = tripData.trip;
  form.elements.name.value = t.name || '';
  form.elements.startDate.value = t.startDate || '';
  form.elements.endDate.value = t.endDate || '';
  form.elements.notes.value = t.notes || '';
  document.getElementById('trip-dialog').showModal();
}
