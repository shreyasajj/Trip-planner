let tripData = null;
let editingFlight = null;
let editingDay = null;

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
const roman = (n) => ROMAN[n] || String(n + 1);

init();

async function init() {
  for (const id of ['who-btn', 'who-btn-m'])
    document.getElementById(id)?.addEventListener('click', () => promptMe(true).then(updateWho));
  for (const id of ['edit-trip-btn', 'edit-trip-btn-m'])
    document.getElementById(id)?.addEventListener('click', openTripDialog);
  updateWho();
  wireDialogs();
  await load();
  checkFlightApi();
}

function updateWho() {
  const label = `👤 ${getMe() || 'Set your name'}`;
  for (const id of ['who-btn', 'who-btn-m']) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

async function load() {
  tripData = await api.get('/api/trip');
  renderHeader();
  renderGlance();
  renderFlights();
  renderItinerary();
}

async function checkFlightApi() {
  const note = document.getElementById('flight-api-note');
  const f = tripData.flights[0];
  if (!f) return;
  try {
    const s = await api.get(`/api/flights/${f.id}/status`);
    if (!s.available) {
      note.textContent = '⚠ No flight API key configured — see the README to enable live delays.';
    } else {
      applyStatus(f.id, s);
    }
  } catch {}
}

/* ---------- header ---------- */
function fmtShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function renderHeader() {
  const t = tripData.trip;
  document.title = `${t.name} · Itinerary`;
  document.getElementById('brand-label').textContent = `Itinerary · ${t.name}`;

  // Title: last word gets the italic rouge treatment
  const words = t.name.split(' ');
  const last = words.pop();
  document.getElementById('trip-title').innerHTML =
    `${esc(words.join(' '))}${words.length ? '<br>' : ''}<em>${esc(last)}</em>`;

  const dates = document.getElementById('trip-dates');
  if (t.startDate && t.endDate) {
    const year = new Date(t.endDate + 'T00:00:00').getFullYear();
    dates.innerHTML = `<strong>${fmtShort(t.startDate)}</strong> ──────── <strong>${fmtShort(t.endDate)}</strong> · ${year}`;
    dates.hidden = false;
    document.getElementById('stamp-date').textContent = `${fmtShort(t.startDate)} — ${fmtShort(t.endDate)}`;
    document.getElementById('stamp-mid').textContent = `Autumn '${String(year).slice(2)}`;
    const nights = Math.round((new Date(t.endDate) - new Date(t.startDate)) / 86400000);
    document.getElementById('footer-meta').textContent =
      `Itinerary · ${t.name} · ${fmtShort(t.startDate)} — ${fmtShort(t.endDate)} · 안전한 여행 되세요`.toUpperCase();
    void nights;
  } else {
    dates.hidden = true;
  }

  const cd = document.getElementById('countdown');
  if (t.startDate) {
    const now = new Date();
    const start = new Date(t.startDate + 'T00:00:00');
    const end = t.endDate ? new Date(t.endDate + 'T23:59:59') : start;
    const days = Math.ceil((start - now) / 86400000);
    if (now < start) cd.innerHTML = `T−<strong>${days}</strong> day${days === 1 ? '' : 's'} until takeoff · 출발까지`;
    else if (now <= end) cd.innerHTML = `<strong>Day ${Math.floor((now - start) / 86400000) + 1}</strong> · we are in Korea 🇰🇷`;
    else cd.innerHTML = `Trip complete · <strong>완. 끝.</strong>`;
  } else cd.textContent = '';

  const notes = document.getElementById('notes-card');
  notes.hidden = !t.notes;
  document.getElementById('trip-notes').textContent = t.notes || '';
}

/* ---------- glance strip: consecutive itinerary days grouped by city ---------- */
function renderGlance() {
  const days = tripData.itinerary;
  const wrap = document.getElementById('glance');
  if (days.length < 2) { wrap.hidden = true; return; }

  const groups = [];
  for (const d of days) {
    const g = groups[groups.length - 1];
    if (g && g.city === (d.city || '—')) g.dates.push(d.date);
    else groups.push({ city: d.city || '—', dates: [d.date] });
  }
  if (groups.length < 2) { wrap.hidden = true; return; }

  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  wrap.hidden = false;
  document.getElementById('glance-grid').innerHTML = groups.map((g, i) => {
    const first = g.dates[0];
    // A leg "ends" when the next leg begins (or trip end for the last one)
    const next = groups[i + 1]?.dates[0] || tripData.trip.endDate || g.dates[g.dates.length - 1];
    const nights = Math.max(1, Math.round((new Date(next) - new Date(first)) / 86400000));
    return `
      <div class="glance-cell">
        <div class="glance-num">${roman(i)} / ${roman(groups.length - 1)}</div>
        <div class="glance-place">${esc(g.city)}</div>
        <div class="glance-dates">${fmt(first)} – ${fmt(next)}</div>
        <div class="glance-nights">${nights} night${nights === 1 ? '' : 's'}</div>
      </div>`;
  }).join('');
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
      <div>
        <div class="flight-route">
          <span><span class="code">${esc(f.from || '???')}</span><span class="times">${esc(f.depTimeLocal || '')}</span></span>
          <span class="arrow">→</span>
          <span><span class="code">${esc(f.to || '???')}</span><span class="times">${esc(f.arrTimeLocal || '')}</span></span>
        </div>
        <div class="flight-meta">
          <strong>${esc(f.flightNumber)}</strong> · ${fmtDate(f.date)}${f.airline ? ` · <span>${esc(f.airline)}</span>` : ''}${f.notes ? `<br>${esc(f.notes)}` : ''}
        </div>
        <div class="flight-tools" style="margin-top:0.8rem;">
          <button class="btn small primary" data-act="status">Check status</button>
          <button class="btn small" data-act="edit">Edit</button>
          <button class="btn small danger" data-act="del">✕</button>
        </div>
      </div>
      <div class="flight-side">
        <span class="badge muted status-badge">Scheduled</span>
        <div class="flight-status" hidden></div>
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
    detail.textContent = 'No data for this flight/date yet — try closer to departure.';
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
      <span><span>Status</span><span>${esc(s.status)}</span></span>
      <span><span>Departs</span><span>${fmt(s.depScheduled)}${s.depEstimated ? ` → <span class="delay-num">${fmt(s.depEstimated)}</span>` : ''}</span></span>
      <span><span>Arrives</span><span>${fmt(s.arrScheduled)}${s.arrEstimated ? ` → <span class="delay-num">${fmt(s.arrEstimated)}</span>` : ''}</span></span>
      ${s.depGate ? `<span><span>Gate</span><span>${esc(s.depGate)}${s.depTerminal ? ' · T' + esc(s.depTerminal) : ''}</span></span>` : ''}
    </div>
    <div class="src">via ${esc(s.provider)} · ${timeAgo(s.fetchedAt)}</div>
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
  el.innerHTML = tripData.itinerary.map((d, i) => `
    <div class="day ${d.date === todayIso ? 'today' : ''}" data-id="${d.id}">
      <div class="day-num">${roman(i)}<small>${d.stay ? 'Stay' : 'Day'}</small></div>
      <div>
        <div class="day-head">
          <span class="day-date">${fmtDate(d.date)}${d.date === todayIso ? ' · Today' : ''}</span>
          ${d.city ? `<span class="day-city">${esc(d.city)}</span>` : ''}
          ${d.title ? `<span class="day-title">${esc(d.title)}</span>` : ''}
        </div>
        ${d.stay ? `
          <div class="stay">⌂ <strong>${esc(d.stay.name)}</strong>
            ${d.stay.address ? `<div class="addr">${esc(d.stay.address)}</div>` : ''}
            ${d.stay.checkIn ? `<div class="addr">in ${fmtDate(d.stay.checkIn)}${d.stay.checkOut ? ` · out ${fmtDate(d.stay.checkOut)}` : ''}</div>` : ''}
          </div>` : ''}
        ${(d.items || []).map((it) => `
          <div class="plan-item"><span class="t">${esc(it.time || '·')}</span><span>${esc(it.text)}</span></div>
        `).join('')}
        <div class="day-tools">
          <button class="btn small" data-act="edit">Edit</button>
          <button class="btn small danger" data-act="del">✕</button>
        </div>
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
