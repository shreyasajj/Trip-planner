// Live flight status / delay lookup.
//
// Two free-tier providers are supported — pick one and set it in .env:
//
//   FLIGHT_API_PROVIDER=aerodatabox     (recommended; free tier via RapidAPI)
//   FLIGHT_API_KEY=<your RapidAPI key>  https://rapidapi.com/aedbx-aedbx/api/aerodatabox
//
//   FLIGHT_API_PROVIDER=aviationstack
//   FLIGHT_API_KEY=<your access key>    https://aviationstack.com (free plan)
//
// Without a key the app still works — flights just show scheduled info.

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

export async function fetchFlightStatus(flight) {
  const provider = (process.env.FLIGHT_API_PROVIDER || '').toLowerCase();
  const key = process.env.FLIGHT_API_KEY;
  if (!provider || !key) {
    return { available: false, reason: 'No flight API configured. Set FLIGHT_API_PROVIDER and FLIGHT_API_KEY in .env (see README).' };
  }

  const cacheKey = `${flight.flightNumber}|${flight.date}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let data;
  try {
    if (provider === 'aerodatabox') data = await aerodatabox(flight, key);
    else if (provider === 'aviationstack') data = await aviationstack(flight, key);
    else return { available: false, reason: `Unknown FLIGHT_API_PROVIDER "${provider}"` };
  } catch (err) {
    return { available: false, reason: `Lookup failed: ${err.message}` };
  }

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

function minutesLate(scheduled, actualOrEstimated) {
  if (!scheduled || !actualOrEstimated) return null;
  const diff = (new Date(actualOrEstimated) - new Date(scheduled)) / 60000;
  return Math.round(diff);
}

async function aerodatabox(flight, key) {
  const num = flight.flightNumber.replace(/\s+/g, '');
  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(num)}/${flight.date}?withAircraftImage=false&withLocation=false`;
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'
    }
  });
  if (res.status === 404) return { available: true, found: false };
  if (!res.ok) throw new Error(`AeroDataBox HTTP ${res.status}`);
  const list = await res.json();
  const f = Array.isArray(list) ? list[0] : null;
  if (!f) return { available: true, found: false };

  const depSched = f.departure?.scheduledTime?.local || f.departure?.scheduledTime?.utc;
  const depRevised = f.departure?.revisedTime?.local || f.departure?.runwayTime?.local;
  const arrSched = f.arrival?.scheduledTime?.local || f.arrival?.scheduledTime?.utc;
  const arrRevised = f.arrival?.revisedTime?.local || f.arrival?.predictedTime?.local || f.arrival?.runwayTime?.local;

  return {
    available: true,
    found: true,
    provider: 'AeroDataBox',
    status: f.status || 'Unknown',
    depScheduled: depSched || null,
    depEstimated: depRevised || null,
    depDelayMin: minutesLate(depSched, depRevised),
    arrScheduled: arrSched || null,
    arrEstimated: arrRevised || null,
    arrDelayMin: minutesLate(arrSched, arrRevised),
    depTerminal: f.departure?.terminal || null,
    depGate: f.departure?.gate || null,
    arrTerminal: f.arrival?.terminal || null,
    arrGate: f.arrival?.gate || null,
    aircraft: f.aircraft?.model || null,
    fetchedAt: Date.now()
  };
}

async function aviationstack(flight, key) {
  const num = flight.flightNumber.replace(/\s+/g, '');
  const url = `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(num)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`aviationstack HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'aviationstack error');
  const rows = body.data || [];
  // Prefer the row matching our date; fall back to the first.
  const f = rows.find((r) => r.flight_date === flight.date) || rows[0];
  if (!f) return { available: true, found: false };

  return {
    available: true,
    found: true,
    provider: 'aviationstack',
    status: f.flight_status ? f.flight_status[0].toUpperCase() + f.flight_status.slice(1) : 'Unknown',
    depScheduled: f.departure?.scheduled || null,
    depEstimated: f.departure?.estimated || f.departure?.actual || null,
    depDelayMin: f.departure?.delay ?? minutesLate(f.departure?.scheduled, f.departure?.estimated),
    arrScheduled: f.arrival?.scheduled || null,
    arrEstimated: f.arrival?.estimated || f.arrival?.actual || null,
    arrDelayMin: f.arrival?.delay ?? minutesLate(f.arrival?.scheduled, f.arrival?.estimated),
    depTerminal: f.departure?.terminal || null,
    depGate: f.departure?.gate || null,
    arrTerminal: f.arrival?.terminal || null,
    arrGate: f.arrival?.gate || null,
    aircraft: f.aircraft?.iata || null,
    fetchedAt: Date.now()
  };
}
