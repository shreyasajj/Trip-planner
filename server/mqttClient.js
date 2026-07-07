// Consumes location updates from a Mosquitto broker and feeds them into the
// people store. Two message shapes are supported:
//
// 1. OwnTracks (recommended Android app — set mode to MQTT):
//    topic:   owntracks/<username>/<device>
//    payload: {"_type":"location","lat":37.55,"lon":126.99,"acc":12,"batt":81,"tst":1726000000}
//
// 2. Simple custom publisher (Tasker, a shell script, anything):
//    topic:   trip/location/<name>
//    payload: {"lat":37.55,"lon":126.99}  or the string "37.55,126.99"
import mqtt from 'mqtt';
import { getDb, save } from './db.js';
import { broadcast } from './sse.js';
import { ensurePerson } from './people.js';

let client = null;

export function mqttStatus() {
  return {
    configured: Boolean(process.env.MQTT_URL),
    connected: Boolean(client && client.connected),
    url: process.env.MQTT_URL ? redact(process.env.MQTT_URL) : null
  };
}

function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

export function startMqtt() {
  const url = process.env.MQTT_URL;
  if (!url) {
    console.log('[mqtt] MQTT_URL not set — live location disabled until configured.');
    return;
  }
  const opts = {
    reconnectPeriod: 5000,
    connectTimeout: 10000
  };
  if (process.env.MQTT_USERNAME) opts.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) opts.password = process.env.MQTT_PASSWORD;

  client = mqtt.connect(url, opts);

  client.on('connect', () => {
    console.log('[mqtt] connected to', redact(url));
    client.subscribe(['owntracks/+/+', 'trip/location/+'], (err) => {
      if (err) console.error('[mqtt] subscribe failed:', err.message);
    });
    broadcast('mqtt', mqttStatus());
  });

  client.on('close', () => broadcast('mqtt', mqttStatus()));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));

  client.on('message', (topic, payload) => {
    try {
      handleMessage(topic, payload.toString());
    } catch (err) {
      console.error('[mqtt] bad message on', topic, '-', err.message);
    }
  });
}

function handleMessage(topic, raw) {
  const parts = topic.split('/');
  let name = null;
  let loc = null;

  if (parts[0] === 'owntracks' && parts.length >= 3) {
    const msg = JSON.parse(raw);
    if (msg._type !== 'location') return; // ignore waypoints, transitions, etc.
    name = parts[1];
    loc = {
      lat: Number(msg.lat),
      lon: Number(msg.lon),
      acc: msg.acc != null ? Number(msg.acc) : null,
      batt: msg.batt != null ? Number(msg.batt) : null,
      // OwnTracks tst is unix seconds
      at: msg.tst ? Number(msg.tst) * 1000 : Date.now()
    };
  } else if (parts[0] === 'trip' && parts[1] === 'location' && parts[2]) {
    name = parts[2];
    let msg;
    if (raw.trim().startsWith('{')) {
      msg = JSON.parse(raw);
    } else {
      const [lat, lon] = raw.split(',').map(Number);
      msg = { lat, lon };
    }
    loc = {
      lat: Number(msg.lat),
      lon: Number(msg.lon),
      acc: msg.acc != null ? Number(msg.acc) : null,
      batt: msg.batt != null ? Number(msg.batt) : null,
      at: msg.at ? Number(msg.at) : Date.now()
    };
  } else {
    return;
  }

  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return;

  const db = getDb();
  const person = ensurePerson(name);
  person.lastSeen = loc.at;

  // Respect the person's privacy toggle: when sharing is off we drop the
  // position entirely instead of storing it.
  if (!person.sharing) return;

  person.location = loc;
  // Keep a short breadcrumb trail for the map (last 50 points).
  person.trail = person.trail || [];
  const last = person.trail[person.trail.length - 1];
  if (!last || last.at !== loc.at) {
    person.trail.push({ lat: loc.lat, lon: loc.lon, at: loc.at });
    if (person.trail.length > 50) person.trail.splice(0, person.trail.length - 50);
  }
  save();
  broadcast('location', { name: person.name, location: loc, batt: loc.batt });
  void db;
}
