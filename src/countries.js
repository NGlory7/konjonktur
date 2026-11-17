/**
 * İzlenen bölge ülkeleri ve bir uçağın / geminin hangi ülkeye ait olduğunu bulma.
 *
 * Uçak: ICAO 24-bit adres blokları (ICAO Annex 10 tahsisleri) — uçağın tescil ülkesini verir.
 * Gemi: MMSI'nin ilk üç hanesi (MID, ITU tahsisi) — geminin bayrak devletini verir.
 * Not: tescil/bayrak ülkesi işletmeciyle aynı olmayabilir (kiralık uçak, kolaylık bayrağı).
 */

const REGION_COUNTRIES = [
  { code: "IL", name: "İsrail", flag: "🇮🇱", color: "#4dabf7", icao: [[0x738000, 0x73ffff]], mid: [428], opensky: "Israel" },
  { code: "IR", name: "İran", flag: "🇮🇷", color: "#51cf66", icao: [[0x730000, 0x737fff]], mid: [422], opensky: "Iran, Islamic Republic of" },
  { code: "SA", name: "Suudi Arabistan", flag: "🇸🇦", color: "#20c997", icao: [[0x710000, 0x717fff]], mid: [403], opensky: "Saudi Arabia" },
  { code: "AE", name: "BAE", flag: "🇦🇪", color: "#e8b04b", icao: [[0x896000, 0x896fff]], mid: [470, 471], opensky: "United Arab Emirates" },
  { code: "QA", name: "Katar", flag: "🇶🇦", color: "#c2255c", icao: [[0x06a000, 0x06a3ff]], mid: [466], opensky: "Qatar" },
  { code: "KW", name: "Kuveyt", flag: "🇰🇼", color: "#f08c00", icao: [[0x706000, 0x706fff]], mid: [447], opensky: "Kuwait" },
  { code: "BH", name: "Bahreyn", flag: "🇧🇭", color: "#ff6b6b", icao: [[0x894000, 0x894fff]], mid: [408], opensky: "Bahrain" },
  { code: "OM", name: "Umman", flag: "🇴🇲", color: "#da77f2", icao: [[0x70c000, 0x70c3ff]], mid: [461], opensky: "Oman" }
];

function countryFromHex(hex) {
  const n = parseInt(String(hex || "").replace(/^~/, ""), 16);
  if (!Number.isFinite(n)) return null;
  const c = REGION_COUNTRIES.find((c) => c.icao.some(([a, b]) => n >= a && n <= b));
  return c ? c.code : null;
}

function countryFromMmsi(mmsi) {
  const mid = Number(String(mmsi).slice(0, 3));
  const c = REGION_COUNTRIES.find((c) => c.mid.includes(mid));
  return c ? c.code : null;
}

const OPENSKY_NAMES = new Set(REGION_COUNTRIES.map((c) => c.opensky));

module.exports = { REGION_COUNTRIES, countryFromHex, countryFromMmsi, OPENSKY_NAMES };
