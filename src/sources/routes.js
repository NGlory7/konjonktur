/**
 * Uçuş rotası (kalkış / varış meydanı) — adsbdb.com (anahtarsız).
 * Kaynak, çağrı koduna göre *tarifeli* rotayı verir; bu yüzden uçağın konumu rotaya uymuyorsa
 * rota "doğrulanamadı" olarak işaretlenir. Sonuçlar SQLite'ta 24 saat önbelleğe alınır.
 */
const { fetchJson } = require("../net");
const { haversineNm } = require("../geo");

const TTL = 24 * 3600_000;
const NEG_TTL = 6 * 3600_000;

function airport(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || null,
    icao: a.icao_code || null,
    name: a.name || null,
    city: a.municipality || null,
    country: a.country_name || null,
    lat: a.latitude,
    lon: a.longitude
  };
}

class RouteCache {
  constructor(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS flight_routes (callsign TEXT PRIMARY KEY, data TEXT, fetched_at INTEGER NOT NULL)`);
    this.get = db.prepare(`SELECT data, fetched_at FROM flight_routes WHERE callsign = ?`);
    this.put = db.prepare(`INSERT OR REPLACE INTO flight_routes (callsign, data, fetched_at) VALUES (?, ?, ?)`);
    this.memo = new Map();
    this.queue = [];
    this.queued = new Set();
    this.running = false;
  }

  /** Önbellekteki rota (yoksa null) */
  cached(callsign) {
    if (!callsign) return null;
    if (this.memo.has(callsign)) return this.memo.get(callsign);
    const row = this.get.get(callsign);
    if (!row) return undefined;
    const age = Date.now() - row.fetched_at;
    const val = row.data ? JSON.parse(row.data) : null;
    if ((val && age > TTL) || (!val && age > NEG_TTL)) return undefined; // süresi dolmuş
    this.memo.set(callsign, val);
    return val;
  }

  /** Önbellekte olmayanları sıraya al; yavaşça (≈2/sn) çek */
  request(callsigns) {
    for (const cs of callsigns) {
      if (!cs || this.queued.has(cs) || this.cached(cs) !== undefined) continue;
      this.queued.add(cs);
      this.queue.push(cs);
    }
    if (!this.running) this.drain();
  }

  async drain() {
    this.running = true;
    while (this.queue.length) {
      const cs = this.queue.shift();
      try {
        const data = await fetchJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, { timeoutMs: 10000 });
        const fr = data?.response?.flightroute;
        const val = fr
          ? { airline: fr.airline?.name || null, from: airport(fr.origin), to: airport(fr.destination), via: airport(fr.midpoint) }
          : null;
        this.put.run(cs, val ? JSON.stringify(val) : null, Date.now());
        this.memo.set(cs, val);
      } catch (err) {
        if (/HTTP 429/.test(err.message)) {
          this.queue.unshift(cs);
          await new Promise((r) => setTimeout(r, 60_000));
          continue;
        }
        // Bilinmeyen çağrı kodu 404 döner: olumsuz sonucu da önbelleğe al
        if (/HTTP 404/.test(err.message)) {
          this.put.run(cs, null, Date.now());
          this.memo.set(cs, null);
        }
      }
      this.queued.delete(cs);
      await new Promise((r) => setTimeout(r, 500));
    }
    this.running = false;
  }
}

/** Uçağın konumu tarifeli rotaya uyuyor mu? (kalkış→uçak→varış yolu, düz rotadan çok uzun değilse) */
function plausible(route, lat, lon) {
  if (!route?.from || !route?.to || route.from.lat == null || route.to.lat == null) return false;
  const direct = haversineNm(route.from.lat, route.from.lon, route.to.lat, route.to.lon);
  const via = haversineNm(route.from.lat, route.from.lon, lat, lon) + haversineNm(lat, lon, route.to.lat, route.to.lon);
  return via <= direct * 1.25 + 150;
}

module.exports = { RouteCache, plausible };
