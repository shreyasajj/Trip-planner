// Resolves route-leg endpoints ("DFW", "Busan", "Tokyo") to coordinates.
// Known airport/city codes come from a small gazetteer; anything else is
// geocoded once via OpenStreetMap Nominatim and cached in the db.
import { getDb, save } from './db.js';

const GAZETTEER = {
  // Korea
  ICN: { label: 'Seoul · Incheon', lat: 37.469, lon: 126.451 },
  GMP: { label: 'Seoul · Gimpo', lat: 37.558, lon: 126.791 },
  SEL: { label: 'Seoul', lat: 37.5665, lon: 126.978 },
  PUS: { label: 'Busan', lat: 35.179, lon: 129.076 },
  CJU: { label: 'Jeju', lat: 33.511, lon: 126.493 },
  TAE: { label: 'Daegu', lat: 35.894, lon: 128.659 },
  KWJ: { label: 'Gwangju', lat: 35.126, lon: 126.809 },
  // US
  DFW: { label: 'Dallas/Fort Worth', lat: 32.897, lon: -97.038 },
  ORD: { label: 'Chicago', lat: 41.974, lon: -87.907 },
  LAX: { label: 'Los Angeles', lat: 33.942, lon: -118.408 },
  SFO: { label: 'San Francisco', lat: 37.622, lon: -122.379 },
  SEA: { label: 'Seattle', lat: 47.449, lon: -122.309 },
  JFK: { label: 'New York', lat: 40.641, lon: -73.778 },
  ATL: { label: 'Atlanta', lat: 33.640, lon: -84.427 },
  IAH: { label: 'Houston', lat: 29.990, lon: -95.337 },
  DEN: { label: 'Denver', lat: 39.856, lon: -104.673 },
  // Asia / elsewhere
  NRT: { label: 'Tokyo · Narita', lat: 35.772, lon: 140.393 },
  HND: { label: 'Tokyo · Haneda', lat: 35.549, lon: 139.780 },
  KIX: { label: 'Osaka', lat: 34.434, lon: 135.233 },
  FUK: { label: 'Fukuoka', lat: 33.586, lon: 130.451 },
  TPE: { label: 'Taipei', lat: 25.078, lon: 121.233 },
  HKG: { label: 'Hong Kong', lat: 22.308, lon: 113.918 },
  SIN: { label: 'Singapore', lat: 1.359, lon: 103.989 },
  BKK: { label: 'Bangkok', lat: 13.690, lon: 100.750 },
  LHR: { label: 'London', lat: 51.470, lon: -0.454 },
  CDG: { label: 'Paris', lat: 49.010, lon: 2.548 }
};

export async function resolvePlace(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('empty place');

  const code = q.toUpperCase();
  if (GAZETTEER[code]) return { code, label: GAZETTEER[code].label, lat: GAZETTEER[code].lat, lon: GAZETTEER[code].lon };

  const db = getDb();
  db.placeCache = db.placeCache || {};
  const key = q.toLowerCase();
  if (db.placeCache[key]) return db.placeCache[key];

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'korea-trip-companion/1.0 (self-hosted trip planner)' }
  });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status} for "${q}"`);
  const hits = await res.json();
  if (!hits.length) throw new Error(`Couldn't find "${q}" — try an airport code or a bigger city name`);

  const place = {
    code: /^[A-Za-z]{3}$/.test(q) ? code : null,
    label: hits[0].display_name.split(',')[0],
    lat: Number(hits[0].lat),
    lon: Number(hits[0].lon)
  };
  db.placeCache[key] = place;
  save();
  return place;
}
