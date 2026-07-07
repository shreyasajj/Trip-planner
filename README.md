# 🇰🇷 Korea Trip Companion

A self-hosted web app for a group trip. Two pages, mobile-first, designed to sit
behind a reverse proxy on your home server.

| Page | What it does |
|---|---|
| **🗓️ Itinerary** (`/`) | Countdown to takeoff, your flights with **live delay lookups**, and a day-by-day timeline of where you're staying and what's next. Everything editable in the UI. |
| **📍 Find Us** (`/map.html`) | Apple-Find-My-style live map fed by your **Mosquitto (MQTT) broker**, per-person location sharing toggles, **group food matching** (preferred / okay / absolutely-not), and **bill splitting** with photo upload and automatic "who was at the restaurant" detection. |

Data lives in a single JSON file (`data/db.json`), bill photos in `data/uploads/`.
No external database.

---

## Quick start

### Docker (recommended — includes a Mosquitto broker)

```bash
docker compose up -d
# app: http://<server>:3000   broker: mqtt://<server>:1883
```

### Bare Node (18+)

```bash
npm install
cp .env.example .env   # edit: MQTT_URL, flight API key
npm start
```

Put it behind your reverse proxy as usual. The live map uses Server-Sent Events;
for nginx nothing special is needed (the app already sends `X-Accel-Buffering: no`),
just make sure proxy buffering/timeouts allow long-lived responses:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_read_timeout 1h;
}
```

---

## Sending your location from Android (the answer to "how will I do that")

Use **[OwnTracks](https://owntracks.org/)** (free, open source, Play Store):

1. Preferences → Connection → **Mode: MQTT**, host/port of your Mosquitto broker
   (plus username/password if your broker requires them).
2. Preferences → Identification → **Username = your name in the app** (that's how
   the map knows which dot is you).
3. Done. OwnTracks publishes to `owntracks/<name>/<device>` and the server picks
   it up live.

Friends install OwnTracks, point it at the same broker with their own name, and
they appear on the map automatically — no account setup needed on the web app.

**Alternatives:**
- Any MQTT publisher works: send `{"lat":37.55,"lon":126.99}` (or just `"37.55,126.99"`)
  to `trip/location/<name>` — easy from Tasker, MacroDroid, or a shell script.
- No app at all? The **📡 Send my location** button on the Find Us page streams the
  browser's geolocation to the server directly.

**Privacy:** every person has a sharing toggle on the Find Us page. Switching it
off immediately deletes their stored position and trail, and the server discards
any further MQTT updates for them until they switch back on.

## Flight delays

Add one free API key to `.env` and the *Check status* button returns live
status, delay minutes, gates and terminals:

- **AeroDataBox** (recommended): sign up at
  [RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox), then
  `FLIGHT_API_PROVIDER=aerodatabox`, `FLIGHT_API_KEY=<rapidapi key>`
- **aviationstack**: [aviationstack.com](https://aviationstack.com), then
  `FLIGHT_API_PROVIDER=aviationstack`, `FLIGHT_API_KEY=<access key>`

Without a key the itinerary still works — flights just show their scheduled info.
Results are cached for 5 minutes to stay inside free-tier quotas.

## Group food matching

Everyone sets three lists on the Find Us page: **😍 preferred** (fish, chicken…),
**🙂 okay**, and **🚫 absolutely not** (beef…). *Find food near us* then queries
OpenStreetMap's Overpass API (no key needed) for restaurants around the group's
current center (or the map center if nobody is sharing), and ranks them:

1. Places nobody has vetoed come first — a 🚫 is a hard no for that person.
2. Then by how many "preferred" hits the group gets.
3. Then by distance.

Each result shows who it works for and who vetoed it and why. Terms understand
common synonyms and Korean words (e.g. `beef` also matches barbecue/bulgogi/갈비,
`fish` matches seafood/sushi/회).

## Bill splitting

*Add a bill* on the Find Us page: snap a photo, enter the total, and the app
pre-selects everyone whose live location was within ~150 m of the payer in the
last 45 minutes — adjust with a tap if needed. Bills are split evenly, and the
page shows a minimal "who pays whom" settlement per currency.

---

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | db.json + uploaded photos |
| `MQTT_URL` | *(unset)* | e.g. `mqtt://192.168.1.10:1883` — live location off until set |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | *(unset)* | broker credentials |
| `FLIGHT_API_PROVIDER` | *(unset)* | `aerodatabox` or `aviationstack` |
| `FLIGHT_API_KEY` | *(unset)* | key for the chosen provider |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | self-hosted Overpass if you have one |

## Notes

- **Auth:** the app itself has none — it's designed to live behind your reverse
  proxy's auth (basic auth, Authelia, Tailscale, …). Don't expose it bare.
- MQTT topics consumed: `owntracks/+/+` (OwnTracks JSON) and `trip/location/+`.
- Seeded with a sample Seoul/Busan itinerary so the UI isn't empty — edit or
  delete everything from the page itself.
