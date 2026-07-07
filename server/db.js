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
    name: 'Korea, autumn 2026',
    startDate: '2026-09-24',
    endDate: '2026-10-11',
    notes: 'Dallas → Seoul → Busan → Jeju → EDC Korea → Seoul → Dallas.\nPassports, T-money cards, Naver Map installed. EDC wristbands in carry-on.'
  },
  flights: [
    {
      id: 'f1',
      flightNumber: 'KE32',
      airline: 'Korean Air',
      date: '2026-09-24',
      from: 'DFW',
      to: 'ICN',
      depTimeLocal: '10:50',
      arrTimeLocal: '15:10 (+1)',
      notes: 'Outbound — ~14h. Then KTX south to Busan. (Edit with your real flight!)',
      status: null
    },
    {
      id: 'f2',
      flightNumber: 'BX8102',
      airline: 'Air Busan',
      date: '2026-09-29',
      from: 'PUS',
      to: 'CJU',
      depTimeLocal: '09:30',
      arrTimeLocal: '10:25',
      notes: 'Short hop to volcanic Jeju (placeholder — edit)',
      status: null
    },
    {
      id: 'f3',
      flightNumber: '7C121',
      airline: 'Jeju Air',
      date: '2026-10-02',
      from: 'CJU',
      to: 'ICN',
      depTimeLocal: '11:00',
      arrTimeLocal: '12:10',
      notes: 'To Seoul for EDC Korea ✦ (placeholder — edit)',
      status: null
    },
    {
      id: 'f4',
      flightNumber: 'KE31',
      airline: 'Korean Air',
      date: '2026-10-09',
      from: 'ICN',
      to: 'DFW',
      depTimeLocal: '11:00',
      arrTimeLocal: '10:05',
      notes: 'Homeward, with the sun',
      status: null
    }
  ],
  itinerary: [
    {
      id: 'd1',
      date: '2026-09-25',
      city: 'Busan',
      title: 'Land + KTX south',
      stay: { name: 'Stay near Haeundae Beach', address: 'Haeundae-gu, Busan', checkIn: '2026-09-25', checkOut: '2026-09-29' },
      items: [
        { time: '15:10', text: 'Land at Incheon, immigration + T-money cards' },
        { time: '18:00', text: 'KTX Seoul → Busan (~2h 40m along the spine of the peninsula)' },
        { time: '21:30', text: 'Check in, late-night dwaeji gukbap at Seomyeon' }
      ]
    },
    {
      id: 'd2',
      date: '2026-09-26',
      city: 'Busan',
      title: 'By the harbor',
      stay: null,
      items: [
        { time: '08:00', text: 'Haeundae beach morning' },
        { time: '11:00', text: 'Gamcheon Culture Village — the painted hillside' },
        { time: '17:00', text: 'Jagalchi fish market' },
        { time: '20:00', text: 'Gwangalli Beach — bridge lights' }
      ]
    },
    {
      id: 'd3',
      date: '2026-09-29',
      city: 'Jeju',
      title: 'To volcanic Jeju',
      stay: { name: 'Jeju stay', address: 'Jeju-si, Jeju-do', checkIn: '2026-09-29', checkOut: '2026-10-02' },
      items: [
        { time: '09:30', text: 'Fly PUS → CJU (~50m), pick up rental car' },
        { time: '13:00', text: 'Coastal Olle path walk' },
        { time: '18:00', text: 'Black pork street for dinner' }
      ]
    },
    {
      id: 'd4',
      date: '2026-09-30',
      city: 'Jeju',
      title: 'Sunrise peak',
      stay: null,
      items: [
        { time: '05:30', text: 'Seongsan Ilchulbong at sunrise' },
        { time: '10:00', text: 'Tangerine orchards + haenyeo divers offshore' },
        { time: '15:00', text: 'Hallasan lower trails' }
      ]
    },
    {
      id: 'd5',
      date: '2026-10-02',
      city: 'EDC Korea',
      title: 'Night 01 — the opening ✦',
      stay: { name: 'Stay near the festival grounds', address: 'Incheon / Seoul area', checkIn: '2026-10-02', checkOut: '2026-10-05' },
      items: [
        { time: '11:00', text: 'Fly CJU → ICN' },
        { time: '17:00', text: 'Gates. Hydrate. Pace yourself — three nights is a marathon.' }
      ]
    },
    {
      id: 'd6',
      date: '2026-10-03',
      city: 'EDC Korea',
      title: 'Night 02 — the deepest night ✦',
      stay: null,
      items: [
        { time: '18:00', text: 'Headliner sets. kineticFIELD. The middle is always the loudest.' }
      ]
    },
    {
      id: 'd7',
      date: '2026-10-04',
      city: 'EDC Korea',
      title: 'Night 03 — the closing ✦',
      stay: null,
      items: [
        { time: '18:00', text: 'Final sets, last fireworks. Walk out into a Seoul morning.' }
      ]
    },
    {
      id: 'd8',
      date: '2026-10-05',
      city: 'Seoul',
      title: 'Recovery',
      stay: { name: 'Hotel in Myeongdong', address: 'Myeongdong, Jung-gu, Seoul', checkIn: '2026-10-05', checkOut: '2026-10-09' },
      items: [
        { time: '13:00', text: 'Sleep in. Long jjimjilbang afternoon.' },
        { time: '19:00', text: 'Cheonggyecheon stream as the lanterns come on' }
      ]
    },
    {
      id: 'd9',
      date: '2026-10-06',
      city: 'Seoul',
      title: 'The old city',
      stay: null,
      items: [
        { time: '09:30', text: "Gyeongbokgung's painted gates (guard ceremony 10:00)" },
        { time: '12:00', text: 'Tea in Insadong' },
        { time: '14:00', text: 'Bukchon Hanok Village' },
        { time: '18:00', text: 'Sunset at Namsan Tower' }
      ]
    },
    {
      id: 'd10',
      date: '2026-10-08',
      city: 'Seoul',
      title: 'The wandering day',
      stay: null,
      items: [
        { time: '07:00', text: 'Han River at first light' },
        { time: '11:00', text: 'Dongdaemun Design Plaza' },
        { time: '19:00', text: 'Long Korean BBQ farewell dinner. Then: pack.' }
      ]
    }
  ],
  route: [
    { id: 'r1', from: { code: 'DFW', label: 'Dallas', lat: 32.897, lon: -97.038 }, to: { code: 'ICN', label: 'Seoul · Incheon', lat: 37.469, lon: 126.451 }, mode: 'flight' },
    { id: 'r2', from: { code: 'SEL', label: 'Seoul', lat: 37.5665, lon: 126.978 }, to: { code: 'PUS', label: 'Busan', lat: 35.179, lon: 129.076 }, mode: 'rail' },
    { id: 'r3', from: { code: 'PUS', label: 'Busan', lat: 35.179, lon: 129.076 }, to: { code: 'CJU', label: 'Jeju', lat: 33.511, lon: 126.493 }, mode: 'flight' },
    { id: 'r4', from: { code: 'CJU', label: 'Jeju', lat: 33.511, lon: 126.493 }, to: { code: 'ICN', label: 'Seoul · Incheon', lat: 37.469, lon: 126.451 }, mode: 'flight' },
    { id: 'r5', from: { code: 'ICN', label: 'Seoul · Incheon', lat: 37.469, lon: 126.451 }, to: { code: 'DFW', label: 'Dallas', lat: 32.897, lon: -97.038 }, mode: 'return' }
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
