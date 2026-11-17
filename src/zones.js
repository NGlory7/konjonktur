/**
 * Bölge sayaçları için anomali motoru (hava ve deniz trafiği).
 *
 * Her kayıtta bölge başına birkaç sayı (ör. toplam uçak, askeri uçak; gemi, tanker) zone_samples
 * tablosuna yazılır. Trafik modülüyle aynı kural uygulanır: aynı yerel saat dilimindeki (hafta içi/sonu
 * ayrı) geçmiş ölçümlerin medyanı ve MAD'ına göre robust Z-skoru; |z| ≥ openZ anomali açar, |z| < closeZ
 * kapatır. Anomaliler trafik anomalileriyle aynı tabloda (traffic_anomalies) "<alan>:<bölge>" anahtarıyla
 * saklanır. Hava sahası kapanması gibi olaylar *negatif* anomali olarak görünür.
 */
const { bucketFor, robustStats } = require("./traffic");

class ZoneMonitor {
  constructor(db, { domain, metrics, minBaselineSamples = 8, baselineDays = 28, openZ = 3, closeZ = 1.5 }) {
    Object.assign(this, { db, domain, metrics, minBaselineSamples, baselineDays, openZ, closeZ });
    db.exec(`
      CREATE TABLE IF NOT EXISTS zone_samples (
        domain TEXT NOT NULL, zone TEXT NOT NULL, ts INTEGER NOT NULL, bucket TEXT NOT NULL,
        metric TEXT NOT NULL, value REAL NOT NULL,
        PRIMARY KEY (domain, zone, ts, metric)
      );
      CREATE INDEX IF NOT EXISTS ix_zone_bucket ON zone_samples(domain, zone, metric, bucket, ts);
    `);
    const q = (s) => db.prepare(s);
    this.sql = {
      insert: q(`INSERT OR REPLACE INTO zone_samples (domain, zone, ts, bucket, metric, value) VALUES (?, ?, ?, ?, ?, ?)`),
      history: q(`SELECT value FROM zone_samples WHERE domain = ? AND zone = ? AND metric = ? AND bucket = ? AND ts >= ? AND ts < ?`),
      latest: q(`SELECT ts, bucket FROM zone_samples WHERE domain = ? AND zone = ? ORDER BY ts DESC LIMIT 1`),
      atTs: q(`SELECT metric, value FROM zone_samples WHERE domain = ? AND zone = ? AND ts = ?`),
      series: q(`SELECT ts, metric, value FROM zone_samples WHERE domain = ? AND zone = ? AND ts >= ? ORDER BY ts`),
      count: q(`SELECT COUNT(DISTINCT ts) n FROM zone_samples WHERE domain = ? AND zone = ?`),
      active: q(`SELECT * FROM traffic_anomalies WHERE city = ? AND metric = ? AND active = 1`),
      open: q(`INSERT INTO traffic_anomalies (city, metric, started_at, peak_z, peak_value, baseline_median, last_z, active)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)`),
      update: q(`UPDATE traffic_anomalies SET peak_z = ?, peak_value = ?, last_z = ? WHERE id = ?`),
      close: q(`UPDATE traffic_anomalies SET active = 0, ended_at = ?, last_z = ? WHERE id = ?`),
      prune: q(`DELETE FROM zone_samples WHERE domain = ? AND ts < ?`)
    };
  }

  key(zone) {
    return `${this.domain}:${zone}`;
  }

  evaluate(zone, bucket, values, ts) {
    const out = {};
    let samples = 0;
    for (const [m, meta] of Object.entries(this.metrics)) {
      const hist = this.sql.history.all(this.domain, zone, m, bucket, ts - this.baselineDays * 86400_000, ts).map((r) => r.value);
      samples = Math.max(samples, hist.length);
      if (hist.length < this.minBaselineSamples) {
        out[m] = { value: values[m], z: null, median: null, samples: hist.length };
        continue;
      }
      const { median, mad } = robustStats(hist);
      const scale = Math.max(1.4826 * mad, meta.floor);
      out[m] = { value: values[m], z: Math.round(((values[m] - median) / scale) * 100) / 100, median, samples: hist.length };
    }
    return { ready: samples >= this.minBaselineSamples, samples, metrics: out };
  }

  /** values: { metric: number } */
  record(zone, tz, values, ts = Date.now()) {
    const bucket = bucketFor(ts, tz);
    const { db, sql } = this;
    db.exec("BEGIN");
    try {
      const evaluation = this.evaluate(zone, bucket, values, ts);
      for (const [m, v] of Object.entries(values)) sql.insert.run(this.domain, zone, ts, bucket, m, v);

      const opened = [];
      const closed = [];
      const key = this.key(zone);
      for (const [m, e] of Object.entries(evaluation.metrics)) {
        if (e.z == null) continue;
        let active = sql.active.get(key, m);
        if (active) {
          const sameSide = Math.sign(e.z) === Math.sign(active.peak_z);
          if (Math.abs(e.z) < this.closeZ || !sameSide) {
            sql.close.run(ts, e.z, active.id);
            closed.push({ ...active, ended_at: ts });
            active = null;
          } else {
            const peak = Math.abs(e.z) > Math.abs(active.peak_z);
            sql.update.run(peak ? e.z : active.peak_z, peak ? e.value : active.peak_value, e.z, active.id);
          }
        }
        if (!active && Math.abs(e.z) >= this.openZ) {
          sql.open.run(key, m, ts, e.z, e.value, e.median, e.z);
          opened.push({ zone, metric: m, z: e.z, value: e.value, median: e.median });
        }
      }
      sql.prune.run(this.domain, ts - (this.baselineDays + 7) * 86400_000);
      db.exec("COMMIT");
      return { bucket, evaluation, opened, closed };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  snapshot(zones) {
    const now = Date.now();
    return zones.map((z) => {
      const last = this.sql.latest.get(this.domain, z.id);
      let latest = null;
      let evaluation = null;
      if (last) {
        latest = { ts: last.ts, ...Object.fromEntries(this.sql.atTs.all(this.domain, z.id, last.ts).map((r) => [r.metric, r.value])) };
        evaluation = this.evaluate(z.id, last.bucket, latest, last.ts);
      }
      const rows = this.sql.series.all(this.domain, z.id, now - 36 * 3600_000);
      const byTs = new Map();
      for (const r of rows) {
        if (!byTs.has(r.ts)) byTs.set(r.ts, { ts: r.ts });
        byTs.get(r.ts)[r.metric] = r.value;
      }
      return { ...z, latest, evaluation, series: [...byTs.values()], totalSamples: this.sql.count.get(this.domain, z.id).n };
    });
  }
}

module.exports = { ZoneMonitor };
