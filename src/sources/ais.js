/**
 * Canlı gemi trafiği — aisstream.io WebSocket akışı (ücretsiz anahtar).
 * https://aisstream.io/documentation
 *
 * Bağlantı açık kaldığı sürece seçili kutulardaki AIS konum ve statik veri mesajları gelir.
 * Gemiler MMSI'ye göre bellekte tutulur; staleMin dakikadır konum göndermeyen gemi düşer.
 */
const { EventEmitter } = require("node:events");
const { inBbox } = require("../geo");
const { countryFromMmsi } = require("../countries");

// AIS gemi tipi kodu → kaba sınıf
function shipClass(type) {
  if (type == null) return "bilinmiyor";
  if (type >= 80 && type <= 89) return "tanker";
  if (type >= 70 && type <= 79) return "kargo";
  if (type >= 60 && type <= 69) return "yolcu";
  if (type === 35) return "askeri";
  if (type === 30) return "balıkçı";
  if ([31, 32, 52].includes(type)) return "römorkör";
  return "diğer";
}

class AisStream extends EventEmitter {
  constructor({ apiKey, zones, staleMin = 30 }) {
    super();
    Object.assign(this, { apiKey, zones, staleMin });
    this.vessels = new Map();
    this.status = { ok: false, connected: false, error: apiKey ? null : "AISSTREAM_KEY tanımlı değil (.env)", messages: 0 };
    this.backoff = 5000;
  }

  start() {
    if (!this.apiKey) return;
    if (typeof WebSocket === "undefined") {
      this.status.error = "Bu Node sürümünde WebSocket yok (Node 22+ gerekli)";
      return;
    }
    this.connect();
    setInterval(() => this.prune(), 60_000).unref();
  }

  connect() {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    this.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        APIKey: this.apiKey,
        // Bölge ülkelerinin gemilerini dünyanın her yerinde görmek için tüm dünya istenir;
        // bölge dışındaki yabancı bayraklı gemiler aşağıda hemen atılır.
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"]
      }));
      this.status = { ...this.status, connected: true, ok: true, error: null, since: Date.now() };
      this.backoff = 5000;
    });
    ws.addEventListener("message", async (ev) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : await new Response(ev.data).text();
        this.handle(JSON.parse(text));
      } catch (_) {}
    });
    const retry = (reason) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.status = { ...this.status, connected: false, ok: false, error: reason };
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5 * 60_000);
    };
    ws.addEventListener("close", (e) => retry(`bağlantı kapandı (${e.code}${e.reason ? " " + e.reason : ""})`));
    ws.addEventListener("error", () => retry("bağlantı hatası"));
  }

  handle(msg) {
    if (msg.error) {
      this.status.error = msg.error;
      return;
    }
    const meta = msg.MetaData || {};
    const mmsi = meta.MMSI;
    if (!mmsi) return;
    this.status.messages++;
    const country = countryFromMmsi(mmsi);
    // Bölge dışında ve bölge ülkesi bayrağı taşımayan gemiyi hiç tutma
    if (!country && !this.vessels.has(mmsi)) {
      const lat = meta.latitude;
      const lon = meta.longitude;
      if (lat == null || !this.zones.some((z) => inBbox(lat, lon, z.bbox))) return;
    }
    const v = this.vessels.get(mmsi) || { mmsi, name: null, type: null, cls: "bilinmiyor", country, national: !!country };
    v.name = (meta.ShipName || v.name || "").trim() || null;

    if (msg.MessageType === "ShipStaticData") {
      const s = msg.Message.ShipStaticData;
      v.type = s.Type;
      v.cls = shipClass(s.Type);
      v.destination = (s.Destination || "").trim() || null;
      v.callsign = (s.CallSign || "").trim() || null;
      v.length = s.Dimension ? (s.Dimension.A || 0) + (s.Dimension.B || 0) : null;
    } else {
      const p = msg.Message[msg.MessageType];
      if (!p) return;
      v.lat = p.Latitude ?? meta.latitude;
      v.lon = p.Longitude ?? meta.longitude;
      v.sog = p.Sog;
      v.cog = p.Cog;
      v.heading = p.TrueHeading !== 511 ? p.TrueHeading : null;
      v.navStatus = p.NavigationalStatus;
      v.seen = Date.now();
    }
    if (v.lat != null) {
      const zone = this.zones.find((z) => inBbox(v.lat, v.lon, z.bbox));
      v.zone = zone ? zone.id : null;
      if (!v.zone && !v.national) {
        this.vessels.delete(mmsi); // bölgeden çıkan yabancı gemi
        return;
      }
      this.vessels.set(mmsi, v);
    } else if (!this.vessels.has(mmsi)) {
      this.vessels.set(mmsi, v); // konum gelince tamamlanır
    }
  }

  prune() {
    const cutoff = Date.now() - this.staleMin * 60_000;
    for (const [k, v] of this.vessels) if (!v.seen || v.seen < cutoff) this.vessels.delete(k);
  }

  list() {
    const cutoff = Date.now() - this.staleMin * 60_000;
    return [...this.vessels.values()].filter((v) => v.lat != null && v.seen >= cutoff);
  }

  /** Bölge başına sayımlar: toplam, tanker, kargo; seyir halinde (> 1 kn) olanlar ayrıca */
  countByZone() {
    const out = Object.fromEntries(this.zones.map((z) => [z.id, { vessels: 0, tankers: 0, cargo: 0, underway: 0 }]));
    for (const v of this.list()) {
      if (!v.zone) continue;
      const c = out[v.zone];
      c.vessels++;
      if (v.cls === "tanker") c.tankers++;
      if (v.cls === "kargo") c.cargo++;
      if ((v.sog || 0) > 1) c.underway++;
    }
    return out;
  }
}

module.exports = { AisStream, shipClass };
