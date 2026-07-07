# 🇰🇷 Korea Trip Companion

A self-hosted web app for a group trip, styled like a paper travel journal.
Two pages, works great on phones and desktop, designed to sit behind a reverse
proxy on your home server.

| Page | What it does |
|---|---|
| **🗓 Itinerary** (`/`) | Countdown to takeoff, your flights with **live delay lookups**, an at-a-glance strip of the trip's legs, and a day-by-day timeline of stays and plans. Everything editable in the UI. |
| **📍 Find Us** (`/map.html`) | Find-My-style live map fed by your **Mosquitto (MQTT) broker**, per-person location sharing toggles, **group food matching** (preferred / okay / absolutely-not), and **bill splitting** — snap a photo, **Claude reads the total and line items**, participants are auto-detected by location, split evenly or by item. |

Data lives in a single JSON file (`data/db.json`), bill photos in `data/uploads/`.
Fonts are vendored — the app makes no third-party requests except map tiles,
Overpass restaurant search, and the APIs you configure.

---

## How to run it

### Option A — Docker Compose (recommended: includes the Mosquitto broker)

```bash
git clone <this repo> && cd Trip-planner
cp .env.example .env        # optional: add API keys (see below)
docker compose up -d
# app:    http://<server>:3000
# broker: mqtt://<server>:1883
```

The compose file wires the app to the bundled broker automatically. Uncomment
the `FLIGHT_API_*` / add `ANTHROPIC_API_KEY` under `environment:` (or use an
`env_file:`) to enable the optional integrations.

### Option B — bare Node (18+)

```bash
npm install
cp .env.example .env        # set MQTT_URL to your broker + any API keys
npm start                   # http://localhost:3000
```

Run it under systemd / pm2 / your usual supervisor. Behind nginx nothing
special is needed beyond long-lived responses for the live map (SSE):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_read_timeout 1h;
}
```

**Auth:** the app itself has none by design — put it behind your reverse
proxy's auth (basic auth, Authelia, Tailscale…). It shows people's locations;
don't expose it bare.

---

## Which MQTT broker, and how phones send location

**Broker: [Eclipse Mosquitto](https://mosquitto.org/).** It's the de-facto
standard, tiny, and the docker-compose here ships it preconfigured. You don't
need anything fancier for a handful of phones.

**Phone app: [OwnTracks](https://owntracks.org/) — it covers both Android and
iPhone**, free and open source, and speaks MQTT natively:

1. Preferences → Connection → **Mode: MQTT**, host/port of your broker,
   plus username/password if the broker requires them.
2. Preferences → Identification → **Username = your name in the app** — that's
   how the map knows which pin is you.
3. Friends install OwnTracks, point it at the same broker with their own
   name, and appear on the map automatically.

**Important — you'll be in Korea, your broker is at home.** The phones must
reach the broker over the internet. Two good setups:

- **Tailscale (easiest & safest):** put your home server and everyone's phones
  on a tailnet; OwnTracks connects to the server's tailscale IP on plain
  `1883`. Nothing is exposed to the public internet.
- **Public broker with TLS + passwords:** expose `8883` with TLS
  (`certbot` certs work fine in mosquitto) and a `password_file`, and give each
  person credentials. Never expose an open, anonymous broker to the internet —
  the bundled config (`allow_anonymous true`) is for trusted LAN / VPN only.

Alternatives that also work: any MQTT publisher can send
`{"lat":37.55,"lon":126.99}` to `trip/location/<name>` (Tasker, a script), and
the **📡 Send my location** button on the Find Us page streams the browser's
geolocation with no app at all.

## Flight delays

Add one free API key to `.env` and *Check status* returns live status, delay
minutes, gates and terminals:

- **AeroDataBox** (recommended): [RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) →
  `FLIGHT_API_PROVIDER=aerodatabox`, `FLIGHT_API_KEY=<rapidapi key>`
- **aviationstack**: [aviationstack.com](https://aviationstack.com) →
  `FLIGHT_API_PROVIDER=aviationstack`, `FLIGHT_API_KEY=<access key>`

Without a key flights still show their scheduled info. Results are cached for
5 minutes to stay inside free-tier quotas.

## Receipt scanning (Claude vision)

Set `ANTHROPIC_API_KEY` in `.env` (from [console.anthropic.com](https://console.anthropic.com))
and the bill dialog gets a **✨ Scan with Claude** button: photograph the bill
(Korean receipts are fine), and it fills in the total, currency, a title, and
the individual line items. You can then split **evenly** or **by items** — tap
names under each item to assign it; unassigned items are shared by everyone,
and any tax/service remainder is split evenly. Model defaults to
`claude-opus-4-8` (`BILL_SCAN_MODEL` to override). Without a key, bills work
fine with manually entered totals.

## Group food matching

Everyone sets three lists on the Find Us page: **😍 preferred**, **🙂 okay**,
and **🚫 absolutely not**. *Find food near us* queries OpenStreetMap's Overpass
API (no key needed) for restaurants around the group's live center (or the map
center if nobody is sharing) and ranks them: places nobody vetoed first, then
by preferred-hits, then distance — showing who each place works for and who
vetoed it. Terms understand synonyms and Korean (e.g. `beef` also matches
bulgogi/갈비/BBQ, `fish` matches 회/sushi/seafood).

## Bill splitting & settlement

Participants are pre-selected from whoever's live location was within ~150 m of
the payer in the last 45 minutes. The Bills section keeps a running ledger and
shows the minimal set of "X pays Y" transfers per currency.

## Privacy

Every person has a sharing switch on the Find Us page. Off = their stored
position and trail are deleted immediately and further MQTT updates for them
are discarded until they switch back on.

---

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | db.json + uploaded photos |
| `MQTT_URL` | *(unset)* | e.g. `mqtt://192.168.1.10:1883` — live location off until set |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | *(unset)* | broker credentials |
| `FLIGHT_API_PROVIDER` / `FLIGHT_API_KEY` | *(unset)* | `aerodatabox` or `aviationstack` + key |
| `ANTHROPIC_API_KEY` | *(unset)* | enables receipt scanning |
| `BILL_SCAN_MODEL` | `claude-opus-4-8` | Claude model for receipt scanning |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | self-hosted Overpass if you have one |

MQTT topics consumed: `owntracks/+/+` (OwnTracks JSON) and `trip/location/+`.
Seeded with the autumn 2026 DFW → Busan → Jeju → EDC Korea → Seoul trip —
edit or delete everything from the page itself.
