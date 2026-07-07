import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { initDb, getDb, save, saveNow, UPLOADS_DIR } from './db.js';
import { startMqtt, mqttStatus } from './mqttClient.js';
import { sseHandler, broadcast } from './sse.js';
import { ensurePerson, publicPerson, haversineMeters, groupCenter } from './people.js';
import { fetchFlightStatus } from './flights.js';
import { findFood } from './food.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

initDb();
startMqtt();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 6);
      cb(null, `bill-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

const id = () => crypto.randomBytes(6).toString('hex');

// ---------- live events ----------
app.get('/api/events', sseHandler);
app.get('/api/status', (req, res) => res.json({ mqtt: mqttStatus(), now: Date.now() }));

// ---------- trip + itinerary ----------
app.get('/api/trip', (req, res) => {
  const db = getDb();
  res.json({ trip: db.trip, flights: db.flights, itinerary: db.itinerary });
});

app.put('/api/trip', (req, res) => {
  const db = getDb();
  const { name, startDate, endDate, notes } = req.body || {};
  db.trip = { ...db.trip, ...(name != null && { name }), ...(startDate != null && { startDate }), ...(endDate != null && { endDate }), ...(notes != null && { notes }) };
  saveNow();
  res.json(db.trip);
});

app.post('/api/itinerary', (req, res) => {
  const db = getDb();
  const day = { id: id(), date: '', city: '', title: '', stay: null, items: [], ...req.body };
  db.itinerary.push(day);
  db.itinerary.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  saveNow();
  res.json(day);
});

app.put('/api/itinerary/:id', (req, res) => {
  const db = getDb();
  const day = db.itinerary.find((d) => d.id === req.params.id);
  if (!day) return res.status(404).json({ error: 'not found' });
  Object.assign(day, req.body, { id: day.id });
  db.itinerary.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  saveNow();
  res.json(day);
});

app.delete('/api/itinerary/:id', (req, res) => {
  const db = getDb();
  db.itinerary = db.itinerary.filter((d) => d.id !== req.params.id);
  saveNow();
  res.json({ ok: true });
});

// ---------- flights ----------
app.post('/api/flights', (req, res) => {
  const db = getDb();
  const f = { id: id(), flightNumber: '', airline: '', date: '', from: '', to: '', depTimeLocal: '', arrTimeLocal: '', notes: '', status: null, ...req.body };
  if (!f.flightNumber) return res.status(400).json({ error: 'flightNumber required' });
  db.flights.push(f);
  db.flights.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  saveNow();
  res.json(f);
});

app.put('/api/flights/:id', (req, res) => {
  const db = getDb();
  const f = db.flights.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  Object.assign(f, req.body, { id: f.id });
  saveNow();
  res.json(f);
});

app.delete('/api/flights/:id', (req, res) => {
  const db = getDb();
  db.flights = db.flights.filter((x) => x.id !== req.params.id);
  saveNow();
  res.json({ ok: true });
});

app.get('/api/flights/:id/status', async (req, res) => {
  const db = getDb();
  const f = db.flights.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  const status = await fetchFlightStatus(f);
  if (status.available && status.found) {
    f.status = status;
    save();
  }
  res.json(status);
});

// ---------- people, preferences, sharing ----------
app.get('/api/people', (req, res) => {
  const db = getDb();
  res.json(Object.values(db.people).map(publicPerson));
});

app.post('/api/people', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'valid name required' });
  const p = ensurePerson(name);
  saveNow();
  broadcast('person', publicPerson(p));
  res.json(publicPerson(p));
});

app.put('/api/people/:name/prefs', (req, res) => {
  const p = getDb().people[req.params.name];
  if (!p) return res.status(404).json({ error: 'not found' });
  const clean = (arr) =>
    Array.isArray(arr) ? arr.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
  p.prefs = { preferred: clean(req.body?.preferred), okay: clean(req.body?.okay), no: clean(req.body?.no) };
  saveNow();
  broadcast('person', publicPerson(p));
  res.json(publicPerson(p));
});

app.put('/api/people/:name/sharing', (req, res) => {
  const p = getDb().people[req.params.name];
  if (!p) return res.status(404).json({ error: 'not found' });
  p.sharing = Boolean(req.body?.sharing);
  if (!p.sharing) {
    // Turning sharing off also forgets the stored position and trail.
    p.location = null;
    p.trail = [];
  }
  saveNow();
  broadcast('person', publicPerson(p));
  res.json(publicPerson(p));
});

// Manual position update from the browser (for people without OwnTracks —
// the web page can post its own geolocation).
app.post('/api/people/:name/location', (req, res) => {
  const p = ensurePerson(req.params.name);
  const { lat, lon, acc } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  p.lastSeen = Date.now();
  if (p.sharing) {
    p.location = { lat, lon, acc: Number.isFinite(acc) ? acc : null, batt: p.location?.batt ?? null, at: Date.now() };
    p.trail = p.trail || [];
    p.trail.push({ lat, lon, at: p.location.at });
    if (p.trail.length > 50) p.trail.splice(0, p.trail.length - 50);
    broadcast('location', { name: p.name, location: p.location });
  }
  save();
  res.json(publicPerson(p));
});

// ---------- food matching ----------
app.get('/api/food/search', async (req, res) => {
  let lat = Number(req.query.lat);
  let lon = Number(req.query.lon);
  const radius = Math.min(Math.max(Number(req.query.radius) || 800, 100), 3000);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const center = groupCenter();
    if (!center) return res.status(400).json({ error: 'No shared locations yet — pass lat/lon or start sharing.' });
    lat = center.lat;
    lon = center.lon;
  }
  try {
    res.json(await findFood({ lat, lon, radius }));
  } catch (err) {
    res.status(502).json({ error: `Restaurant search failed: ${err.message}` });
  }
});

// ---------- bills ----------
app.get('/api/bills', (req, res) => {
  res.json({ bills: getDb().bills, summary: settle(getDb().bills) });
});

// People near a point (default: payer's last position) — used to pre-select
// who was at the restaurant.
app.get('/api/bills/nearby', (req, res) => {
  const db = getDb();
  let lat = Number(req.query.lat);
  let lon = Number(req.query.lon);
  const payer = req.query.payer && db.people[req.query.payer];
  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && payer?.sharing && payer.location) {
    lat = payer.location.lat;
    lon = payer.location.lon;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.json({ detected: [], reason: 'no reference position' });
  const radius = Math.min(Math.max(Number(req.query.radius) || 150, 30), 2000);
  const staleMs = 45 * 60 * 1000; // only count positions from the last 45 min
  const detected = Object.values(db.people)
    .filter((p) => p.sharing && p.location && Date.now() - p.location.at < staleMs)
    .map((p) => ({ name: p.name, distance: Math.round(haversineMeters(lat, lon, p.location.lat, p.location.lon)) }))
    .filter((p) => p.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  res.json({ detected, center: { lat, lon }, radius });
});

app.post('/api/bills', upload.single('photo'), (req, res) => {
  const db = getDb();
  const amount = Number(req.body.amount);
  const paidBy = String(req.body.paidBy || '').trim();
  let participants;
  try {
    participants = JSON.parse(req.body.participants || '[]');
  } catch {
    participants = [];
  }
  participants = [...new Set(participants.map((s) => String(s).trim()).filter(Boolean))];
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!paidBy) return res.status(400).json({ error: 'paidBy required' });
  if (!participants.includes(paidBy)) participants.push(paidBy);
  if (participants.length < 1) return res.status(400).json({ error: 'at least one participant' });

  const bill = {
    id: id(),
    title: String(req.body.title || 'Meal').slice(0, 80),
    amount,
    currency: String(req.body.currency || 'KRW').slice(0, 5).toUpperCase(),
    paidBy,
    participants,
    photo: req.file ? `/uploads/${req.file.filename}` : null,
    createdAt: Date.now()
  };
  db.bills.unshift(bill);
  saveNow();
  broadcast('bill', bill);
  res.json({ bill, summary: settle(db.bills) });
});

app.delete('/api/bills/:id', (req, res) => {
  const db = getDb();
  db.bills = db.bills.filter((b) => b.id !== req.params.id);
  saveNow();
  broadcast('bill', { deleted: req.params.id });
  res.json({ ok: true, summary: settle(db.bills) });
});

// Even split per bill -> net balance per person -> minimal transfer list.
function settle(bills) {
  const net = {}; // +ve = is owed money
  const byCurrency = {};
  for (const b of bills) {
    const cur = b.currency || 'KRW';
    byCurrency[cur] = byCurrency[cur] || {};
    const n = byCurrency[cur];
    const share = b.amount / b.participants.length;
    for (const person of b.participants) n[person] = (n[person] || 0) - share;
    n[b.paidBy] = (n[b.paidBy] || 0) + b.amount;
  }
  const settlements = {};
  for (const [cur, n] of Object.entries(byCurrency)) {
    const debtors = Object.entries(n).filter(([, v]) => v < -0.01).map(([k, v]) => [k, -v]).sort((a, b) => b[1] - a[1]);
    const creditors = Object.entries(n).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i][1], creditors[j][1]);
      transfers.push({ from: debtors[i][0], to: creditors[j][0], amount: Math.round(pay * 100) / 100 });
      debtors[i][1] -= pay;
      creditors[j][1] -= pay;
      if (debtors[i][1] < 0.01) i++;
      if (creditors[j][1] < 0.01) j++;
    }
    settlements[cur] = { balances: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * 100) / 100])), transfers };
  }
  net.byCurrency = settlements;
  return settlements;
}

app.listen(PORT, () => {
  console.log(`Korea Trip Companion running on http://localhost:${PORT}`);
});
