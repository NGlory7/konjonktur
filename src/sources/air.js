/**
 * Bölgesel hava trafiği — adsb.fi açık veri API'si (topluluk ADS-B ağı, anahtarsız).
 * (adsb.lol IP başına günde 500 istekle sınırlı olduğu için dakikalık tarama adsb.fi'ye taşındı.)
 * Yalnızca transponder yayını yapan ve bir alıcının menzilindeki uçaklar görünür.
 */
const { fetchJson, mapLimit } = require("../net");
const { haversineNm } = require("../geo");
const { countryFromHex } = require("../countries");

function normalize(a) {
  return {
    hex: a.hex,
    callsign: (a.flight || "").trim() || null,
    reg: a.r || null,
    type: a.t || null,
    lat: a.lat,
    lon: a.lon,
    alt: a.alt_baro === "ground" ? 0 : a.alt_baro ?? a.alt_geom ?? null,
    onGround: a.alt_baro === "ground",
    speed: a.gs != null ? Math.round(a.gs) : null,
    track: a.track ?? a.true_heading ?? null,
    squawk: a.squawk || null,
    emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
    military: Boolean(a.dbFlags & 1),
    country: countryFromHex(a.hex),
    seenAt: Date.now() - (a.seen || 0) * 1000,
    source: "adsb.fi",
    zone: null
  };
}

/**
 * adsb.fi ücretsiz ve anahtarsız; kural saniyede en fazla 1 istek. İstekler sırayla, 1,1 sn arayla atılır;
 * yine de 429 gelirse tüm istekler bir süre durdurulur.
 */
const API = "https://opendata.adsb.fi/api/v2";
const GAP_MS = 1100;
const BACKOFF_MS = 5 * 60_000;
let blockedUntil = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

async function adsbGet(url) {
  if (Date.now() < blockedUntil) throw new RateLimited(`adsb.fi hız sınırı — ${Math.ceil((blockedUntil - Date.now()) / 60000)} dk bekleniyor`);
  try {
    return await fetchJson(url, { timeoutMs: 15000 });
  } catch (err) {
    if (/HTTP 429/.test(err.message)) {
      blockedUntil = Date.now() + BACKOFF_MS;
      throw new RateLimited("adsb.fi hız sınırı (429) — 5 dk bekleniyor");
    }
    throw err;
  } finally {
    await sleep(GAP_MS);
  }
}

const adsbBlocked = () => Date.now() < blockedUntil;

/** Belirli uçakların güncel konumu (ICAO adresleriyle, 40'lık gruplar halinde, en fazla maxGroups istek) */
async function fetchByHex(hexes, maxGroups = 3) {
  const out = [];
  for (let i = 0; i < hexes.length && i / 40 < maxGroups; i += 40) {
    try {
      const data = await adsbGet(`${API}/icao/${hexes.slice(i, i + 40).join(",")}`);
      out.push(...(data.ac || data.aircraft || []).filter((a) => Number.isFinite(a.lat)).map(normalize));
    } catch (err) {
      if (err instanceof RateLimited) break;
    }
  }
  return out;
}

/** Her bölge için ayrı sorgu (sırayla); aynı uçak birden fazla bölgede çıkarsa merkezine en yakın bölgeye atanır. */
async function fetchAirZones(zones) {
  const status = {};
  const all = new Map();
  await mapLimit(zones, 1, async (z) => {
    try {
      const data = await adsbGet(`${API}/lat/${z.lat}/lon/${z.lon}/dist/${z.nm}`);
      for (const raw of data.ac || data.aircraft || []) {
        if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) continue;
        const a = normalize(raw);
        const d = haversineNm(z.lat, z.lon, a.lat, a.lon);
        const prev = all.get(a.hex);
        if (!prev || d < prev._d) all.set(a.hex, { ...a, zone: z.id, _d: d });
      }
      status[z.id] = { ok: true };
    } catch (err) {
      status[z.id] = { ok: false, error: err.message };
    }
  });
  const aircraft = [...all.values()].map(({ _d, ...a }) => a);
  return { aircraft, status };
}

/** Bölge başına sayımlar (anomali motoru için) */
function countByZone(aircraft, zones) {
  const out = Object.fromEntries(zones.map((z) => [z.id, { airborne: 0, military: 0 }]));
  for (const a of aircraft) {
    if (!a.zone || a.onGround) continue;
    out[a.zone].airborne++;
    if (a.military) out[a.zone].military++;
  }
  return out;
}

module.exports = { fetchAirZones, fetchByHex, countByZone, normalize, adsbGet, adsbBlocked, API };
