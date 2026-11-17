/**
 * OpenSky Network — dünya genelindeki anlık uçak durumu (anahtarsız, anonim).
 * Anonim kota: günde 400 kredi; dünya geneli sorgu 4 kredi → en fazla ~100 sorgu/gün (15 dk aralık).
 * Yalnızca izlenen bölge ülkelerinde tescilli uçaklar tutulur.
 */
const { fetchJson } = require("../net");
const { OPENSKY_NAMES, countryFromHex } = require("../countries");

async function fetchNationalAircraft() {
  const data = await fetchJson("https://opensky-network.org/api/states/all", { timeoutMs: 30000 });
  const out = [];
  for (const s of data.states || []) {
    // [icao24, callsign, origin_country, time_position, last_contact, lon, lat, baro_alt(m), on_ground, velocity(m/s), track, ...]
    if (!OPENSKY_NAMES.has(s[2]) || s[5] == null || s[6] == null) continue;
    const hex = s[0];
    out.push({
      hex,
      callsign: (s[1] || "").trim() || null,
      lat: s[6],
      lon: s[5],
      alt: s[7] != null ? Math.round(s[7] * 3.28084) : null,
      onGround: !!s[8],
      speed: s[9] != null ? Math.round(s[9] * 1.94384) : null,
      track: s[10],
      country: countryFromHex(hex),
      seenAt: (s[4] || data.time) * 1000,
      source: "opensky"
    });
  }
  return out;
}

module.exports = { fetchNationalAircraft };
