const { fetchJson, mapLimit } = require("../net");
const { countryFromHex } = require("../countries");

const inBox = (lat, lon, b) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;

/**
 * Askeri uçaklar — adsb.fi (açık, anahtarsız, topluluk ADS-B ağı).
 * Kutu içindekiler + dünyanın neresinde olursa olsun bölge ülkelerinde tescilli askeri uçaklar.
 */
async function fetchMilitaryAircraft(box) {
  const { adsbGet, API } = require("./air");
  const data = await adsbGet(`${API}/mil`);
  return (data.ac || data.aircraft || [])
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && (inBox(a.lat, a.lon, box) || countryFromHex(a.hex)))
    .map((a) => ({
      country: countryFromHex(a.hex),
      military: true,
      seenAt: Date.now() - (a.seen || 0) * 1000,
      source: "adsb.fi",
      hex: a.hex,
      callsign: (a.flight || "").trim() || null,
      reg: a.r || null,
      type: a.t || null,
      desc: a.desc || null,
      lat: a.lat,
      lon: a.lon,
      alt: a.alt_baro === "ground" ? 0 : a.alt_baro ?? a.alt_geom ?? null,
      onGround: a.alt_baro === "ground",
      speed: a.gs != null ? Math.round(a.gs) : null,
      track: a.track ?? a.true_heading ?? null,
      squawk: a.squawk || null,
      emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
      seen: a.seen ?? null
    }));
}

/** Depremler — USGS, son 24 saat M2.5+ */
async function fetchQuakes(box) {
  const data = await fetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", {
    timeoutMs: 15000
  });
  return (data.features || [])
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place,
      ts: f.properties.time,
      url: f.properties.url,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2]
    }))
    .filter((q) => inBox(q.lat, q.lon, box))
    .sort((a, b) => b.ts - a.ts);
}

/** Piyasalar — Yahoo Finance grafik uç noktası */
async function fetchMarkets(list) {
  const results = await mapLimit(list, 4, async (m) => {
    try {
      const data = await fetchJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.symbol)}?range=1d&interval=15m`,
        { timeoutMs: 10000 }
      );
      const r = data?.chart?.result?.[0];
      if (!r) throw new Error("veri yok");
      const meta = r.meta;
      const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
      const price = meta.regularMarketPrice ?? closes[closes.length - 1];
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? closes[0];
      return {
        ...m,
        price,
        prev,
        changePct: prev ? ((price - prev) / prev) * 100 : 0,
        spark: closes.slice(-48),
        marketTime: (meta.regularMarketTime || 0) * 1000,
        ok: true
      };
    } catch (err) {
      return { ...m, ok: false, error: err.message };
    }
  });
  return results;
}

// ---------------- İsrail siren uyarıları (Tzeva Adom) ----------------

// Tzeva Adom tehdit kodları
const THREATS = {
  0: "Roket / füze",
  1: "Tehlikeli madde",
  2: "Terörist sızması",
  3: "Deprem",
  4: "Tsunami",
  5: "Düşman hava aracı (İHA)",
  6: "Radyolojik olay",
  7: "Konvansiyonel olmayan füze",
  8: "Genel uyarı",
  9: "Tatbikat"
};

let cityIndex = null;
async function loadCityIndex() {
  if (cityIndex) return cityIndex;
  try {
    const data = await fetchJson("https://www.tzevaadom.co.il/static/cities.json", { timeoutMs: 20000 });
    cityIndex = data.cities || {};
  } catch (_) {
    cityIndex = null;
  }
  return cityIndex || {};
}

function enrichCities(names, index) {
  return names.map((he) => {
    const c = index[he];
    return c ? { he, en: c.en, lat: c.lat, lon: c.lng } : { he, en: he, lat: null, lon: null };
  });
}

/** Şu an aktif siren uyarıları */
async function fetchActiveSirens() {
  const [data, index] = await Promise.all([
    fetchJson("https://api.tzevaadom.co.il/notifications", { timeoutMs: 6000 }),
    loadCityIndex()
  ]);
  return (Array.isArray(data) ? data : [])
    .filter((n) => !n.isDrill)
    .map((n) => ({
      id: n.notificationId || `${n.time}_${(n.cities || []).join(",")}`,
      ts: (n.time || 0) * 1000,
      threat: n.threat,
      threatName: THREATS[n.threat] || `Kod ${n.threat}`,
      cities: enrichCities(n.cities || [], index)
    }));
}

/** Son siren olayları (geçmiş) */
async function fetchSirenHistory() {
  const [data, index] = await Promise.all([
    fetchJson("https://api.tzevaadom.co.il/alerts-history", { timeoutMs: 12000 }),
    loadCityIndex()
  ]);
  const events = [];
  for (const group of Array.isArray(data) ? data.slice(0, 30) : []) {
    for (const a of group.alerts || []) {
      if (a.isDrill) continue;
      events.push({
        id: `${group.id}_${a.time}`,
        ts: a.time * 1000,
        threat: a.threat,
        threatName: THREATS[a.threat] || `Kod ${a.threat}`,
        cities: enrichCities(a.cities || [], index)
      });
    }
  }
  return events.sort((a, b) => b.ts - a.ts).slice(0, 60);
}

module.exports = { fetchMilitaryAircraft, fetchQuakes, fetchMarkets, fetchActiveSirens, fetchSirenHistory };
