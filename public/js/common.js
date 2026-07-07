// Shared helpers: API wrapper, SSE connection, identity ("who am I on this phone").
const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await safeJson(r))?.error || `HTTP ${r.status}`);
    return r.json();
  },
  async send(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!r.ok) throw new Error((await safeJson(r))?.error || `HTTP ${r.status}`);
    return r.json();
  },
  post(url, body) { return this.send('POST', url, body); },
  put(url, body) { return this.send('PUT', url, body); },
  del(url) { return this.send('DELETE', url); }
};

async function safeJson(r) {
  try { return await r.json(); } catch { return null; }
}

// --- identity ---
function getMe() {
  return localStorage.getItem('trip.me') || '';
}
async function setMe(name) {
  name = name.trim();
  if (!name) return;
  localStorage.setItem('trip.me', name);
  try { await api.post('/api/people', { name }); } catch {}
  document.dispatchEvent(new CustomEvent('me-changed', { detail: name }));
}
async function promptMe(force = false) {
  const current = getMe();
  if (current && !force) return current;
  const name = prompt('What should we call you? (used for locations, food picks & bills)', current || '');
  if (name && name.trim()) {
    await setMe(name);
    return name.trim();
  }
  return current;
}

// --- live updates ---
function connectEvents(handlers) {
  const es = new EventSource('/api/events');
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => {
      try { fn(JSON.parse(e.data)); } catch {}
    });
  }
  return es;
}

// --- misc ---
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
