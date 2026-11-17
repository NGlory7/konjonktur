/**
 * TomTom Traffic Incidents API v5 — bir şehir kutusundaki güncel trafik olayları.
 * https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details
 */
const { fetchJson } = require("../net");

// iconCategory → Türkçe tür
const CATEGORY = {
  0: "bilinmiyor", 1: "kaza", 2: "sis", 3: "tehlikeli koşul", 4: "yağmur", 5: "buzlanma",
  6: "sıkışıklık", 7: "şerit kapalı", 8: "yol kapalı", 9: "yol çalışması", 10: "rüzgar",
  11: "sel", 14: "arızalı araç"
};

const FIELDS =
  "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay," +
  "events{description,code},from,to,length,delay,roadNumbers}}}";

function midpoint(geometry) {
  const c = geometry?.coordinates;
  if (!c) return [null, null];
  if (geometry.type === "Point") return [c[1], c[0]];
  const p = c[Math.floor(c.length / 2)];
  return p ? [p[1], p[0]] : [null, null];
}

async function fetchCityIncidents(city, apiKey) {
  const url =
    `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(apiKey)}` +
    `&bbox=${city.bbox.map((v) => v.toFixed(4)).join(",")}` +
    `&fields=${encodeURIComponent(FIELDS)}&language=en-GB&timeValidityFilter=present`;
  const data = await fetchJson(url, { timeoutMs: 20000 });
  return (data.incidents || []).map((f) => {
    const p = f.properties || {};
    const [lat, lon] = midpoint(f.geometry);
    const coords = f.geometry?.type === "LineString" ? f.geometry.coordinates : null;
    return {
      id: `${city.id}:${p.id}`,
      city: city.id,
      category: CATEGORY[p.iconCategory] || `kod ${p.iconCategory}`,
      categoryCode: p.iconCategory,
      magnitude: p.magnitudeOfDelay ?? null, // 0 bilinmiyor, 1 hafif, 2 orta, 3 ağır, 4 belirsiz (kapanmalar)
      description: (p.events || []).map((e) => e.description).filter(Boolean).join("; "),
      road: (p.roadNumbers || []).join(", "),
      from: p.from || "",
      to: p.to || "",
      lat,
      lon,
      // Haritada çizmek için seyreltilmiş geometri
      geometry: coords ? coords.filter((_, i) => i % Math.ceil(coords.length / 40) === 0 || i === coords.length - 1) : null,
      lengthM: p.length || 0,
      delayS: p.delay || 0
    };
  });
}

/** Bir şehrin olay listesinden şehir düzeyinde göstergeler */
function summarize(incidents) {
  const jams = incidents.filter((i) => i.categoryCode === 6);
  return {
    jam_km: Math.round(jams.reduce((s, i) => s + i.lengthM, 0) / 100) / 10,
    delay_min: Math.round(incidents.reduce((s, i) => s + i.delayS, 0) / 6) / 10,
    closures: incidents.filter((i) => i.categoryCode === 8).length,
    accidents: incidents.filter((i) => i.categoryCode === 1).length,
    incidents: incidents.length
  };
}

module.exports = { fetchCityIncidents, summarize, CATEGORY };
