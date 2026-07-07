import { getDb, save } from './db.js';

const PALETTE = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#6741d9'];

export function ensurePerson(name) {
  const db = getDb();
  const key = String(name).trim();
  if (!db.people[key]) {
    const used = Object.values(db.people).map((p) => p.color);
    const color = PALETTE.find((c) => !used.includes(c)) || PALETTE[Object.keys(db.people).length % PALETTE.length];
    db.people[key] = {
      name: key,
      color,
      sharing: true,
      prefs: { preferred: [], okay: [], no: [] },
      location: null,
      trail: [],
      lastSeen: null
    };
    save();
  }
  return db.people[key];
}

// Public view of a person — hides coordinates when sharing is off.
export function publicPerson(p) {
  return {
    name: p.name,
    color: p.color,
    sharing: p.sharing,
    prefs: p.prefs,
    lastSeen: p.lastSeen,
    location: p.sharing ? p.location : null,
    trail: p.sharing ? p.trail : []
  };
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Center of everyone currently sharing a location — used as the default
// search point for restaurants and for bill participant detection.
export function groupCenter() {
  const db = getDb();
  const pts = Object.values(db.people)
    .filter((p) => p.sharing && p.location)
    .map((p) => p.location);
  if (!pts.length) return null;
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    count: pts.length
  };
}
