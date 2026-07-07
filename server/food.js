// Group food matching: pulls restaurants around a point from OpenStreetMap's
// Overpass API (no key needed) and scores each one against everyone's
// preferences. "Absolutely not" is a hard veto; "preferred" earns points.
import { getDb } from './db.js';
import { haversineMeters } from './people.js';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

// Maps a free-text preference term ("fish", "beef"...) to keywords looked up
// in OSM cuisine tags and restaurant names (English + common Korean words).
const KEYWORDS = {
  beef: ['beef', 'steak', 'burger', 'barbecue', 'bbq', 'bulgogi', 'galbi', 'gogi', '소고기', '불고기', '갈비', 'hamburger'],
  pork: ['pork', 'samgyeopsal', 'tonkatsu', 'donkatsu', '돼지', '삼겹살', '돈까스', 'barbecue', 'bbq'],
  chicken: ['chicken', 'fried_chicken', 'dakgalbi', 'samgyetang', '치킨', '닭', '삼계탕'],
  fish: ['fish', 'seafood', 'sushi', 'sashimi', 'hoe', 'fish_and_chips', '회', '생선', '해물', '수산'],
  seafood: ['seafood', 'fish', 'sushi', 'sashimi', 'crab', 'shrimp', '해물', '해산물', '조개'],
  sushi: ['sushi', 'sashimi', 'japanese', '초밥', '스시'],
  noodles: ['noodle', 'ramen', 'ramyeon', 'naengmyeon', 'kalguksu', 'udon', '국수', '라면', '냉면', '칼국수', '우동'],
  vegetarian: ['vegetarian', 'vegan', 'salad', 'temple', '채식'],
  vegan: ['vegan', 'vegetarian', '채식'],
  spicy: ['spicy', 'tteokbokki', 'jjamppong', '떡볶이', '짬뽕', 'buldak', '불닭'],
  korean: ['korean', '한식', 'kimchi', 'bibimbap', '비빔밥'],
  japanese: ['japanese', 'sushi', 'ramen', 'izakaya', '일식'],
  chinese: ['chinese', 'jjajang', 'jjamppong', '중식', '짜장'],
  pizza: ['pizza', '피자'],
  dessert: ['dessert', 'cafe', 'bakery', 'ice_cream', 'bingsu', '빙수', '카페', '베이커리'],
  soup: ['soup', 'stew', 'jjigae', 'tang', 'gukbap', '찌개', '국밥', '탕']
};

function keywordsFor(term) {
  const t = term.trim().toLowerCase();
  return KEYWORDS[t] || [t];
}

function matches(term, haystack) {
  return keywordsFor(term).some((kw) => haystack.includes(kw));
}

export async function findFood({ lat, lon, radius = 800 }) {
  const query = `
    [out:json][timeout:20];
    (
      node["amenity"~"restaurant|fast_food|food_court"](around:${radius},${lat},${lon});
      way["amenity"~"restaurant|fast_food|food_court"](around:${radius},${lat},${lon});
    );
    out center tags 120;
  `;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass rejects UA-less requests with 406 — identify ourselves per their usage policy.
      'User-Agent': 'korea-trip-companion/1.0 (self-hosted trip planner)'
    },
    body: 'data=' + encodeURIComponent(query)
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const body = await res.json();

  const db = getDb();
  const people = Object.values(db.people).filter(
    (p) => p.prefs && (p.prefs.preferred.length || p.prefs.okay.length || p.prefs.no.length)
  );

  const results = [];
  for (const el of body.elements || []) {
    const tags = el.tags || {};
    if (!tags.name && !tags['name:en']) continue;
    const rlat = el.lat ?? el.center?.lat;
    const rlon = el.lon ?? el.center?.lon;
    if (rlat == null) continue;

    const haystack = [tags.name, tags['name:en'], tags['name:ko'], tags.cuisine, tags.amenity]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/;/g, ' ');

    let score = 0;
    const okPeople = [];
    const vetoedBy = [];
    const likedBy = [];
    for (const p of people) {
      const veto = p.prefs.no.find((t) => matches(t, haystack));
      if (veto) {
        vetoedBy.push({ name: p.name, term: veto });
        continue;
      }
      okPeople.push(p.name);
      const liked = p.prefs.preferred.filter((t) => matches(t, haystack));
      const okayed = p.prefs.okay.filter((t) => matches(t, haystack));
      if (liked.length) likedBy.push({ name: p.name, terms: liked });
      score += liked.length * 2 + okayed.length;
    }

    results.push({
      id: `${el.type}/${el.id}`,
      name: tags['name:en'] || tags.name,
      nameKo: tags['name:ko'] || (tags['name:en'] ? tags.name : null),
      cuisine: (tags.cuisine || '').replace(/;/g, ', ').replace(/_/g, ' ') || null,
      amenity: tags.amenity,
      lat: rlat,
      lon: rlon,
      distance: Math.round(haversineMeters(lat, lon, rlat, rlon)),
      score,
      okCount: okPeople.length,
      totalPeople: people.length,
      vetoedBy,
      likedBy,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`
    });
  }

  // Rank: most people OK with it, then preference score, then distance.
  results.sort((a, b) => b.okCount - a.okCount || b.score - a.score || a.distance - b.distance);
  return { center: { lat, lon }, radius, peopleConsidered: people.map((p) => p.name), results: results.slice(0, 40) };
}
