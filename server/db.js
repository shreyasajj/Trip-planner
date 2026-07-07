// Tiny JSON-file datastore. Good enough for a handful of travellers on a home server.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const SEED = {
  trip: {
    name: 'Korea Trip',
    startDate: '2026-09-18',
    endDate: '2026-09-28',
    notes: 'Have passports, T-money cards, and Naver Map installed.'
  },
  flights: [
    {
      id: 'f1',
      flightNumber: 'KE82',
      airline: 'Korean Air',
      date: '2026-09-18',
      from: 'ORD',
      to: 'ICN',
      depTimeLocal: '12:30',
      arrTimeLocal: '16:40 (+1)',
      notes: 'Outbound — arrive 3h early',
      status: null
    },
    {
      id: 'f2',
      flightNumber: 'KE81',
      airline: 'Korean Air',
      date: '2026-09-28',
      from: 'ICN',
      to: 'ORD',
      depTimeLocal: '10:20',
      arrTimeLocal: '09:10',
      notes: 'Return',
      status: null
    }
  ],
  itinerary: [
    {
      id: 'd1',
      date: '2026-09-19',
      city: 'Seoul',
      title: 'Land + settle in',
      stay: { name: 'Hotel in Myeongdong', address: 'Myeongdong, Jung-gu, Seoul', checkIn: '2026-09-19', checkOut: '2026-09-23' },
      items: [
        { time: '17:30', text: 'AREX express train from Incheon to Seoul Station' },
        { time: '19:00', text: 'Check in, drop bags' },
        { time: '20:00', text: 'Myeongdong street food night market' }
      ]
    },
    {
      id: 'd2',
      date: '2026-09-20',
      city: 'Seoul',
      title: 'Palaces & Bukchon',
      stay: null,
      items: [
        { time: '09:00', text: 'Gyeongbokgung Palace (guard ceremony at 10:00)' },
        { time: '12:00', text: 'Lunch in Insadong' },
        { time: '14:00', text: 'Bukchon Hanok Village' },
        { time: '18:00', text: 'N Seoul Tower at sunset' }
      ]
    },
    {
      id: 'd3',
      date: '2026-09-23',
      city: 'Busan',
      title: 'KTX to Busan',
      stay: { name: 'Stay near Haeundae Beach', address: 'Haeundae-gu, Busan', checkIn: '2026-09-23', checkOut: '2026-09-27' },
      items: [
        { time: '10:00', text: 'KTX from Seoul Station (~2h40m)' },
        { time: '14:00', text: 'Haeundae Beach walk' },
        { time: '19:00', text: 'Gwangalli Beach — bridge lights' }
      ]
    }
  ],
  people: {},
  bills: []
};

let db = null;
let writeTimer = null;

export function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      console.error('[db] db.json is corrupt, backing it up and reseeding:', err.message);
      fs.renameSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now());
      db = structuredClone(SEED);
      flush();
    }
  } else {
    db = structuredClone(SEED);
    flush();
  }
  // Forward-compat: make sure top-level keys exist
  for (const key of Object.keys(SEED)) {
    if (db[key] === undefined) db[key] = structuredClone(SEED[key]);
  }
  return db;
}

export function getDb() {
  if (!db) initDb();
  return db;
}

// Debounced save so bursts of MQTT updates don't hammer the disk.
export function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 500);
}

function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function saveNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flush();
}

process.on('exit', () => {
  try {
    if (db) saveNow();
  } catch {}
});
