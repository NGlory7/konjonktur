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
const { findPlaces } = require("./gazetteer");
const { classify } = require("./classify");
const { dedupeKey, mapLimit } = { ...require("./text"), ...require("./net") };

class Hub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.news = new Map(); // id -> item
    this.dedupe = new Map(); // başlık anahtarı -> id
    this.aircraft = [];
    this.quakes = [];
    this.markets = [];
    this.sirens = { active: [], history: [] };
    this.sources = {}; // kaynak sağlık durumu
    this.startedAt = Date.now();
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
    for (const item of enriched) this.news.set(item.id, item);
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

  async pollAircraft() {
    try {
      this.aircraft = await fetchMilitaryAircraft(config.aircraftBox);
      this.setStatus("aircraft", { ok: true, count: this.aircraft.length, name: "Askeri uçak (adsb.lol)", at: Date.now() });
    } catch (err) {
      this.setStatus("aircraft", { ok: false, error: err.message, name: "Askeri uçak (adsb.lol)", at: Date.now() });
    }
    this.emit("update", { type: "aircraft", aircraft: this.aircraft });
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
    loop("aircraft", this.pollAircraft, iv.aircraft);
    loop("quakes", this.pollQuakes, iv.quakes);
    loop("markets", this.pollMarkets, iv.markets);
    loop("sirens", this.pollSirens, iv.sirens);
    loop("sirenHistory", this.pollSirenHistory, iv.sirenHistory);
  }
}

module.exports = new Hub();
