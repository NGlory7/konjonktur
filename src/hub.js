/**
 * Merkez: tüm kaynakları arka planda periyodik olarak yoklar, haberleri
 * zenginleştirir (çeviri + konum + önem) ve değişiklikleri abonelere yayınlar.
 */
const { EventEmitter } = require("node:events");
const config = require("../config");
const { fetchRssFeeds, fetchTelegramChannels } = require("./sources/news");
const {
  fetchMilitaryAircraft,
  fetchQuakes,
  fetchMarkets,
  fetchActiveSirens,
  fetchSirenHistory
} = require("./sources/live");
const { translate } = require("./translate");
const { fetchCityIncidents, summarize } = require("./sources/traffic");
const { TrafficMonitor } = require("./traffic");
const db = require("./db");
const { ZoneMonitor } = require("./zones");
const { fetchAirZones, fetchByHex, countByZone, adsbBlocked } = require("./sources/air");
const { fetchNationalAircraft } = require("./sources/opensky");
const { RouteCache, plausible } = require("./sources/routes");
const { REGION_COUNTRIES } = require("./countries");
const { AisStream } = require("./sources/ais");
const { METRICS: TRAFFIC_METRICS } = require("./traffic");

const AIR_METRICS = {
  airborne: { label: "Havadaki uçak", unit: "", floor: 3 },
  military: { label: "Askeri uçak", unit: "", floor: 1 }
};
const SEA_METRICS = {
  vessels: { label: "Gemi", unit: "", floor: 3 },
  tankers: { label: "Tanker", unit: "", floor: 2 },
  underway: { label: "Seyirdeki gemi", unit: "", floor: 3 }
};
const { findPlaces } = require("./gazetteer");
const { classify } = require("./classify");
const { Clusterer } = require("./cluster");
const { dedupeKey, mapLimit } = { ...require("./text"), ...require("./net") };

class Hub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.news = new Map(); // id -> item
    this.clusterer = new Clusterer(); // aynı olayı anlatan haberleri gruplar
    this.dedupe = new Map(); // başlık anahtarı -> id
    this.aircraft = [];
    this.quakes = [];
    this.markets = [];
    this.sirens = { active: [], history: [] };
    this.sources = {}; // kaynak sağlık durumu
    this.startedAt = Date.now();
    const database = db.open();
    const rule = {
      minBaselineSamples: config.traffic.minBaselineSamples,
      baselineDays: config.traffic.baselineDays,
      openZ: config.traffic.openZ,
      closeZ: config.traffic.closeZ
    };
    this.traffic = new TrafficMonitor(database, config.traffic);
    this.airMon = new ZoneMonitor(database, { domain: "air", metrics: AIR_METRICS, ...rule });
    this.seaMon = new ZoneMonitor(database, { domain: "sea", metrics: SEA_METRICS, ...rule });
    this.ais = new AisStream(config.marine);
    this.routes = new RouteCache(database);
    this.nationalAir = new Map(); // bölge ülkelerinde tescilli uçaklar (dünya geneli), hex -> son konum
    this.lastAirSample = 0;
  }

  setStatus(id, s) {
    this.sources[id] = { ...(this.sources[id] || {}), ...s };
  }

  async enrich(raw) {
    let titleTr = null;
    if (config.translate && raw.lang !== config.targetLang) {
      const t = await translate(raw.title, config.targetLang);
      if (t && t.text && t.text !== raw.title) titleTr = t.text;
    }
    const places = findPlaces(raw.title, titleTr);
    const { severity, topics } = classify(raw.title, titleTr);
    const me = raw.category === "me" || places.some((p) => p.me);
    const { summary, ...rest } = raw;
    return { ...rest, titleTr, places, severity, topics, me, dupes: 0 };
  }

  async ingest(rawItems) {
    const cutoff = Date.now() - config.newsRetentionHours * 3600_000;
    const fresh = [];
    for (const r of rawItems) {
      if (r.ts < cutoff || this.news.has(r.id)) continue;
      const key = dedupeKey(r.title);
      const existingId = this.dedupe.get(key);
      if (existingId && this.news.has(existingId)) {
        const existing = this.news.get(existingId);
        if (existing) existing.dupes++; // null = aynı başlık şu an işleniyor
        continue;
      }
      this.dedupe.set(key, r.id);
      this.news.set(r.id, null); // yer tut — paralel turlarda tekrar işlenmesin
      fresh.push(r);
    }
    if (!fresh.length) return [];

    const enriched = await mapLimit(fresh, 5, (r) => this.enrich(r));
    enriched.sort((a, b) => a.ts - b.ts);
    for (const item of enriched) {
      item.cluster = this.clusterer.assign(item);
      this.news.set(item.id, item);
    }
    this.prune();
    return enriched;
  }

  prune() {
    const cutoff = Date.now() - config.newsRetentionHours * 3600_000;
    const all = [...this.news.values()].filter(Boolean).sort((a, b) => b.ts - a.ts);
    const keep = new Set(all.filter((i) => i.ts >= cutoff).slice(0, config.maxNewsItems).map((i) => i.id));
    for (const [id, item] of this.news) {
      if (item && !keep.has(id)) this.news.delete(id);
    }
    for (const [key, id] of this.dedupe) {
      if (!this.news.has(id)) this.dedupe.delete(key);
    }
  }

  newsList() {
    return [...this.news.values()].filter(Boolean).sort((a, b) => b.ts - a.ts);
  }

  snapshot() {
    return {
      serverTime: Date.now(),
      startedAt: this.startedAt,
      news: this.newsList(),
      aircraft: this.aircraft,
      quakes: this.quakes,
      markets: this.markets,
      sirens: this.sirens,
      sources: this.sources,
      traffic: this.trafficSnapshot(),
      air: this.airSnapshot(),
      marine: this.marineSnapshot(),
      countries: REGION_COUNTRIES.map(({ code, name, flag, color }) => ({ code, name, flag, color })),
      tv: config.tv
    };
  }

  // ---------------- Yoklayıcılar ----------------

  async pollNews() {
    const { items, status } = await fetchRssFeeds(config.rss);
    Object.entries(status).forEach(([k, v]) => this.setStatus(k, v));
    const added = await this.ingest(items);
    this.emit("update", { type: "news", added, sources: this.sources });
  }

  async pollTelegram() {
    if (!config.telegram.length) return;
    const { items, status } = await fetchTelegramChannels(config.telegram);
    Object.entries(status).forEach(([k, v]) => this.setStatus(k, v));
    const added = await this.ingest(items);
    this.emit("update", { type: "news", added, sources: this.sources });
  }

  // ---------------- Anomali listesi (trafik + hava + deniz, adlarıyla) ----------------
  labeledAnomalies(rows) {
    const cityName = Object.fromEntries(config.traffic.cities.map((c) => [c.id, c.name]));
    const airName = Object.fromEntries(config.air.zones.map((z) => [z.id, z.name]));
    const seaName = Object.fromEntries(config.marine.zones.map((z) => [z.id, z.name]));
    return rows.map((a) => {
      const [domain, zone] = a.city.includes(":") ? a.city.split(":") : ["traffic", a.city];
      const meta = (domain === "air" ? AIR_METRICS : domain === "sea" ? SEA_METRICS : TRAFFIC_METRICS)[a.metric] || { label: a.metric, unit: "" };
      const name = (domain === "air" ? airName : domain === "sea" ? seaName : cityName)[zone] || zone;
      return { ...a, domain, zone, name, label: meta.label, unit: meta.unit };
    });
  }

  trafficSnapshot() {
    const t = this.traffic.snapshot();
    t.anomalies = this.labeledAnomalies(t.anomalies);
    t.cities = t.cities.map((c) => ({ ...c, place: config.traffic.cities.find((x) => x.id === c.id)?.place || c.id }));
    return t;
  }

  airSnapshot() {
    return { metrics: AIR_METRICS, zones: this.airMon.snapshot(config.air.zones) };
  }

  marineSnapshot() {
    return {
      enabled: !!config.marine.apiKey,
      status: this.ais.status,
      metrics: SEA_METRICS,
      zones: this.seaMon.snapshot(config.marine.zones.map(({ id, name, bbox, tz }) => ({ id, name, bbox, tz }))),
      vessels: this.ais.list().map(({ mmsi, name, cls, type, lat, lon, sog, cog, heading, destination, zone, seen, length, country, national }) =>
        ({ mmsi, name, cls, type, lat, lon, sog, cog, heading, destination, zone, seen, length, country, national }))
    };
  }

  async pollAircraft() {
    const name = "Hava trafiği (adsb.fi)";
    const now = Date.now();
    let zoneAircraft = [];
    let zoneStatus = {};
    try {
      ({ aircraft: zoneAircraft, status: zoneStatus } = await fetchAirZones(config.air.zones));
    } catch (_) {}
    // Bölge dışındaki askeri uçaklar (ör. Doğu Akdeniz, Irak, Türkiye) haritada gösterilir, sayıma girmez
    let military = [];
    try {
      military = await fetchMilitaryAircraft(config.aircraftBox);
    } catch (_) {}
    // Bölge ülkelerinin dünya genelindeki uçakları: OpenSky'nin bulduklarının güncel konumunu adsb.fi'den iste
    const known = new Set([...zoneAircraft, ...military].map((a) => a.hex));
    // Kota için: 3 dakikada bir, en eski konumlular önce, en fazla 120 uçak
    let refreshed = [];
    if (now - (this.lastHexRefresh || 0) >= 180_000 && !adsbBlocked()) {
      this.lastHexRefresh = now;
      const stale = [...this.nationalAir.values()].filter((a) => !known.has(a.hex)).sort((x, y) => (x.seenAt || 0) - (y.seenAt || 0));
      try {
        refreshed = await fetchByHex(stale.map((a) => a.hex), 3);
      } catch (_) {}
    }
    for (const a of [...zoneAircraft, ...military, ...refreshed]) {
      if (a.country) this.nationalAir.set(a.hex, a);
    }
    for (const [hex, a] of this.nationalAir) if (now - (a.seenAt || 0) > 20 * 60_000) this.nationalAir.delete(hex);

    const byHex = new Map();
    for (const a of zoneAircraft) byHex.set(a.hex, a);
    for (const m of military) if (!byHex.has(m.hex)) byHex.set(m.hex, { ...m, zone: null });
    for (const a of [...refreshed, ...this.nationalAir.values()]) if (!byHex.has(a.hex)) byHex.set(a.hex, { ...a, zone: null });

    // Kalkış / varış meydanı (önbellekten; eksikler arka planda sorgulanır, önce bölge ülkelerininkiler)
    const need = [];
    this.aircraft = [...byHex.values()].map((a) => {
      const out = { ...a, national: !!a.country, stale: now - (a.seenAt || now) > 3 * 60_000 };
      if (a.callsign && !a.onGround) {
        const r = this.routes.cached(a.callsign);
        if (r === undefined) need.push({ cs: a.callsign, pri: a.country ? 0 : 1 });
        else if (r) out.route = { ...r, plausible: plausible(r, a.lat, a.lon) };
      }
      return out;
    });
    this.routes.request(need.sort((x, y) => x.pri - y.pri).map((n) => n.cs));

    const okZones = config.air.zones.filter((z) => zoneStatus[z.id]?.ok);
    this.setStatus("aircraft", {
      ok: okZones.length > 0,
      count: this.aircraft.length,
      name,
      error: okZones.length ? undefined : (Object.values(zoneStatus).find((z) => z.error)?.error || "bölge sorguları başarısız"),
      at: now
    });

    // Sayımları kaydet — yalnızca sorgusu başarılı olan bölgeler (başarısız sorgu 0 sayılırsa sahte "hava sahası boşaldı" anomalisi doğar)
    const events = [];
    if (now - this.lastAirSample >= config.air.sampleSec * 1000 && okZones.length) {
      this.lastAirSample = now;
      const counts = countByZone(zoneAircraft, config.air.zones);
      for (const z of okZones) {
        const res = this.airMon.record(z.id, z.tz, counts[z.id], now);
        for (const o of res.opened) events.push({ kind: "anomaly", domain: "air", city: z.name, ...o });
      }
    }
    this.emit("update", { type: "aircraft", aircraft: this.aircraft, air: this.airSnapshot(), events,
      anomalies: this.labeledAnomalies(this.traffic.snapshot().anomalies), sources: this.sources });
  }

  /** OpenSky'den bölge ülkelerinin dünya genelindeki uçaklarını bul (15 dk'da bir; anonim kota sınırlı) */
  async pollNationalAir() {
    const name = "Bölge ülkeleri uçakları (OpenSky)";
    try {
      const list = await fetchNationalAircraft();
      for (const a of list) {
        const prev = this.nationalAir.get(a.hex);
        if (!prev || (prev.seenAt || 0) < a.seenAt) this.nationalAir.set(a.hex, { ...prev, ...a });
      }
      this.setStatus("opensky", { ok: true, count: list.length, name, at: Date.now() });
    } catch (err) {
      this.setStatus("opensky", { ok: false, error: err.message, name, at: Date.now() });
    }
  }

  async pollMarine() {
    if (!config.marine.apiKey) {
      this.setStatus("marine", { ok: false, error: "AISSTREAM_KEY tanımlı değil (.env)", name: "Deniz trafiği (aisstream)", at: Date.now() });
      return;
    }
    const st = this.ais.status;
    this.setStatus("marine", {
      ok: st.connected, count: this.ais.list().length, name: "Deniz trafiği (aisstream)", error: st.error || undefined, at: Date.now()
    });
    // Bağlantı en az staleMin kadar açık kalmadıysa sayımlar eksik olur — kaydetme
    const events = [];
    const warm = st.connected && st.since && Date.now() - st.since >= config.marine.staleMin * 60_000;
    if (warm) {
      const counts = this.ais.countByZone();
      for (const z of config.marine.zones) {
        const res = this.seaMon.record(z.id, z.tz, counts[z.id]);
        for (const o of res.opened) events.push({ kind: "anomaly", domain: "sea", city: z.name, ...o });
      }
    }
    this.emit("update", { type: "marine", marine: this.marineSnapshot(), events,
      anomalies: this.labeledAnomalies(this.traffic.snapshot().anomalies), sources: this.sources });
  }

  pushVessels() {
    if (!config.marine.apiKey) return;
    this.emit("update", { type: "vessels", vessels: this.marineSnapshot().vessels, status: this.ais.status });
  }

  async pollQuakes() {
    try {
      this.quakes = await fetchQuakes(config.quakeBox);
      this.setStatus("quakes", { ok: true, count: this.quakes.length, name: "Deprem (USGS)", at: Date.now() });
    } catch (err) {
      this.setStatus("quakes", { ok: false, error: err.message, name: "Deprem (USGS)", at: Date.now() });
    }
    this.emit("update", { type: "quakes", quakes: this.quakes });
  }

  async pollMarkets() {
    const res = await fetchMarkets(config.markets);
    // Başarısız sembolde eski değeri koru
    this.markets = res.map((m) => (m.ok ? m : this.markets.find((o) => o.symbol === m.symbol && o.ok) || m));
    const okCount = res.filter((m) => m.ok).length;
    this.setStatus("markets", {
      ok: okCount > 0,
      count: okCount,
      name: "Piyasalar (Yahoo)",
      error: okCount ? undefined : res[0]?.error,
      at: Date.now()
    });
    this.emit("update", { type: "markets", markets: this.markets });
  }

  async pollSirens() {
    try {
      const active = await fetchActiveSirens();
      const changed = JSON.stringify(active.map((a) => a.id)) !== JSON.stringify(this.sirens.active.map((a) => a.id));
      this.sirens.active = active;
      this.setStatus("sirens", { ok: true, count: active.length, name: "İsrail sirenleri (Tzeva Adom)", at: Date.now() });
      if (changed) {
        // Yeni aktif uyarıları geçmişe de ekle
        for (const a of active) {
          if (!this.sirens.history.some((h) => h.id === a.id)) this.sirens.history.unshift(a);
        }
        this.emit("update", { type: "sirens", sirens: this.sirens });
      }
    } catch (err) {
      this.setStatus("sirens", { ok: false, error: err.message, name: "İsrail sirenleri (Tzeva Adom)", at: Date.now() });
    }
  }

  async pollSirenHistory() {
    try {
      this.sirens.history = await fetchSirenHistory();
      this.emit("update", { type: "sirens", sirens: this.sirens });
    } catch (_) {}
  }

  async pollTraffic() {
    const name = "Trafik (TomTom)";
    if (!config.traffic.apiKey) {
      this.setStatus("traffic", { ok: false, error: "TOMTOM_KEY tanımlı değil (.env)", name, at: Date.now() });
      this.emit("update", { type: "traffic", traffic: this.trafficSnapshot(), sources: this.sources });
      return;
    }
    const events = [];
    let ok = 0;
    for (const city of config.traffic.cities) {
      try {
        const incidents = await fetchCityIncidents(city, config.traffic.apiKey);
        const res = this.traffic.record(city.id, incidents, summarize(incidents));
        ok++;
        for (const a of res.opened) events.push({ kind: "anomaly", city: city.name, ...a });
        for (const i of res.newIncidents.filter((x) => x.categoryCode === 8)) {
          events.push({ kind: "closure", city: city.name, road: i.road, from: i.from, to: i.to, lat: i.lat, lon: i.lon });
        }
      } catch (err) {
        this.traffic.lastError[city.id] = err.message;
      }
      await new Promise((r) => setTimeout(r, 800)); // API'ye nazik davran
    }
    this.setStatus("traffic", {
      ok: ok > 0, count: ok, name,
      error: ok ? undefined : Object.values(this.traffic.lastError)[0],
      at: Date.now()
    });
    this.emit("update", { type: "traffic", traffic: this.trafficSnapshot(), events, sources: this.sources });
  }

  start() {
    const loop = (name, fn, seconds) => {
      let running = false;
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          await fn.call(this);
        } catch (err) {
          console.warn(`[${name}]`, err.message);
        } finally {
          running = false;
        }
      };
      tick();
      setInterval(tick, seconds * 1000);
    };
    const iv = config.intervals;
    loop("news", this.pollNews, iv.news);
    loop("telegram", this.pollTelegram, iv.telegram);
    loop("nationalAir", this.pollNationalAir, config.air.nationalPollSec);
    loop("aircraft", this.pollAircraft, config.air.pollSec);
    this.ais.start();
    loop("marine", this.pollMarine, config.marine.sampleSec);
    loop("vessels", this.pushVessels, 30);
    loop("quakes", this.pollQuakes, iv.quakes);
    loop("markets", this.pollMarkets, iv.markets);
    loop("sirens", this.pollSirens, iv.sirens);
    loop("sirenHistory", this.pollSirenHistory, iv.sirenHistory);
    loop("traffic", this.pollTraffic, config.traffic.intervalSec);
  }
}

module.exports = new Hub();
