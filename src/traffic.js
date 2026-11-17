/**
 * Şehir trafiği anomali motoru.
 *
 * Her yoklamada şehir başına göstergeler (sıkışıklık km'si, toplam gecikme, kapanma ve kaza sayısı)
 * SQLite'a yazılır. Baz çizgisi, aynı şehrin *aynı saat dilimindeki* (yerel saat, hafta içi/sonu ayrı)
 * son N gündeki ölçümlerinden hesaplanır: medyan ve MAD (aykırı değerlere dayanıklı).
 *
 *   z = (değer − medyan) / max(1.4826 × MAD, taban)
 *
 * |z| ≥ openZ olunca anomali açılır, |z| < closeZ olunca kapanır; başlangıç, bitiş ve tepe
 * değeri traffic_anomalies tablosunda saklanır. Yeterli geçmiş yoksa z hesaplanmaz
 * ("baz çizgisi oluşuyor") — hiçbir değer uydurulmaz. Negatif anomali (beklenenden çok sakin
 * trafik: sokağa çıkma yasağı, grev, tatil) de aynı kuralla yakalanır.
 */

const METRICS = {
  jam_km: { label: "Sıkışıklık", unit: "km", floor: 1.0 },
  delay_min: { label: "Toplam gecikme", unit: "dk", floor: 3.0 },
  closures: { label: "Yol kapanması", unit: "", floor: 1.0 },
  accidents: { label: "Kaza", unit: "", floor: 1.0 }
};

// Yerel hafta sonu günleri (0 = Pazar)
const WEEKEND = {
  "Europe/Istanbul": [6, 0],
  "Asia/Jerusalem": [5, 6],
  "Asia/Tehran": [5],
  "Asia/Beirut": [6, 0],
  default: [5, 6]
};

const DAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function bucketFor(ts, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value])
  );
  const weekend = (WEEKEND[tz] || WEEKEND.default).includes(DAY[parts.weekday]);
  return `${weekend ? "we" : "wd"}-${parts.hour}`;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function robustStats(values) {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return { median: med, mad };
}

class TrafficMonitor {
  constructor(db, cfg) {
    this.db = db;
    this.cfg = cfg;
    this.cityById = Object.fromEntries(cfg.cities.map((c) => [c.id, c]));
    this.lastPoll = {};
    this.lastError = {};
    const q = (sql) => db.prepare(sql);
    this.sql = {
      insertSample: q(`INSERT OR REPLACE INTO traffic_samples (city, ts, bucket, jam_km, delay_min, closures, accidents, incidents)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      history: q(`SELECT jam_km, delay_min, closures, accidents FROM traffic_samples
                  WHERE city = ? AND bucket = ? AND ts >= ? AND ts < ?`),
      upsertIncident: q(`INSERT INTO traffic_incidents
                           (id, city, category, magnitude, description, road, from_place, to_place, lat, lon, geometry, length_m, delay_s, first_seen, last_seen, active)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                         ON CONFLICT(id) DO UPDATE SET magnitude = excluded.magnitude, description = excluded.description,
                           geometry = excluded.geometry, length_m = excluded.length_m, delay_s = excluded.delay_s,
                           last_seen = excluded.last_seen, active = 1`),
      isKnown: q(`SELECT 1 FROM traffic_incidents WHERE id = ? AND active = 1`),
      deactivate: q(`UPDATE traffic_incidents SET active = 0 WHERE city = ? AND active = 1 AND last_seen < ?`),
      activeAnomaly: q(`SELECT * FROM traffic_anomalies WHERE city = ? AND metric = ? AND active = 1`),
      openAnomaly: q(`INSERT INTO traffic_anomalies (city, metric, started_at, peak_z, peak_value, baseline_median, last_z, active)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`),
      updateAnomaly: q(`UPDATE traffic_anomalies SET peak_z = ?, peak_value = ?, last_z = ? WHERE id = ?`),
      closeAnomaly: q(`UPDATE traffic_anomalies SET active = 0, ended_at = ?, last_z = ? WHERE id = ?`),
      prune: q(`DELETE FROM traffic_samples WHERE ts < ?`),
      pruneIncidents: q(`DELETE FROM traffic_incidents WHERE active = 0 AND last_seen < ?`)
    };
  }

  /**
   * Bir şehrin yeni ölçümünü işler. Dönen: { sample, evaluation, newIncidents, opened, closed }
   */
  record(cityId, incidents, summary, ts = Date.now()) {
    const city = this.cityById[cityId];
    const bucket = bucketFor(ts, city.tz);
    const { db, sql, cfg } = this;

    db.exec("BEGIN");
    try {
      // 1) Olaylar: yeni olanları ayıkla, görülmeyenleri pasifleştir
      const newIncidents = [];
      for (const i of incidents) {
        if (!sql.isKnown.get(i.id)) newIncidents.push(i);
        sql.upsertIncident.run(i.id, cityId, i.category, i.magnitude, i.description, i.road, i.from, i.to,
          i.lat, i.lon, i.geometry ? JSON.stringify(i.geometry) : null, i.lengthM, i.delayS, ts, ts);
      }
      sql.deactivate.run(cityId, ts);

      // 2) Bu ölçümü değerlendir (baz çizgisi bu ölçüm *hariç* geçmişten)
      const hist = sql.history.all(cityId, bucket, ts - cfg.baselineDays * 86400_000, ts);
      const evaluation = this.evaluate(summary, hist);

      // 3) Ölçümü kaydet
      sql.insertSample.run(cityId, ts, bucket, summary.jam_km, summary.delay_min, summary.closures, summary.accidents, summary.incidents);

      // 4) Anomali aç / güncelle / kapat
      const opened = [];
      const closed = [];
      for (const [metric, e] of Object.entries(evaluation.metrics)) {
        const active = sql.activeAnomaly.get(cityId, metric);
        if (e.z == null) continue;
        if (active) {
          const sameSide = Math.sign(e.z) === Math.sign(active.peak_z);
          if (Math.abs(e.z) < cfg.closeZ || !sameSide) {
            sql.closeAnomaly.run(ts, e.z, active.id);
            closed.push({ ...active, ended_at: ts });
          } else if (Math.abs(e.z) > Math.abs(active.peak_z)) {
            sql.updateAnomaly.run(e.z, e.value, e.z, active.id);
          } else {
            sql.updateAnomaly.run(active.peak_z, active.peak_value, e.z, active.id);
          }
        }
        if ((!active || closed.some((c) => c.id === active.id)) && Math.abs(e.z) >= cfg.openZ) {
          sql.openAnomaly.run(cityId, metric, ts, e.z, e.value, e.median, e.z);
          opened.push({ city: cityId, metric, z: e.z, value: e.value, median: e.median });
        }
      }

      // 5) Eski veriyi temizle
      sql.prune.run(ts - (cfg.baselineDays + 7) * 86400_000);
      sql.pruneIncidents.run(ts - 7 * 86400_000);
      db.exec("COMMIT");
      this.lastPoll[cityId] = ts;
      delete this.lastError[cityId];
      return { bucket, evaluation, newIncidents, opened, closed };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  evaluate(summary, history) {
    const metrics = {};
    for (const [m, meta] of Object.entries(METRICS)) {
      const value = summary[m];
      if (history.length < this.cfg.minBaselineSamples) {
        metrics[m] = { value, z: null, median: null, samples: history.length };
        continue;
      }
      const { median: med, mad } = robustStats(history.map((h) => h[m]));
      const scale = Math.max(1.4826 * mad, meta.floor);
      metrics[m] = { value, z: Math.round(((value - med) / scale) * 100) / 100, median: med, samples: history.length };
    }
    return { samples: history.length, ready: history.length >= this.cfg.minBaselineSamples, metrics };
  }

  // ---------------- arayüz için ----------------

  snapshot() {
    const now = Date.now();
    const { db } = this;
    const cities = this.cfg.cities.map((c) => {
      const latest = db.prepare(`SELECT * FROM traffic_samples WHERE city = ? ORDER BY ts DESC LIMIT 1`).get(c.id);
      const series = db
        .prepare(`SELECT ts, jam_km, delay_min, closures, accidents FROM traffic_samples WHERE city = ? AND ts >= ? ORDER BY ts`)
        .all(c.id, now - 36 * 3600_000);
      const totalSamples = db.prepare(`SELECT COUNT(*) n FROM traffic_samples WHERE city = ?`).get(c.id).n;
      let evaluation = null;
      if (latest) {
        const hist = db
          .prepare(`SELECT jam_km, delay_min, closures, accidents FROM traffic_samples WHERE city = ? AND bucket = ? AND ts >= ? AND ts < ?`)
          .all(c.id, latest.bucket, latest.ts - this.cfg.baselineDays * 86400_000, latest.ts);
        evaluation = this.evaluate(latest, hist);
      }
      return {
        id: c.id, name: c.name, lat: c.lat, lon: c.lon, bbox: c.bbox,
        latest: latest || null, evaluation, series, totalSamples,
        lastPoll: this.lastPoll[c.id] || latest?.ts || null,
        error: this.lastError[c.id] || null
      };
    });
    const incidents = db
      .prepare(`SELECT * FROM traffic_incidents WHERE active = 1 AND (category IN ('yol kapalı','kaza') OR magnitude >= 3)
                ORDER BY first_seen DESC LIMIT 600`)
      .all()
      .map((r) => ({ ...r, geometry: r.geometry ? JSON.parse(r.geometry) : null }));
    const anomalies = db
      .prepare(`SELECT * FROM traffic_anomalies WHERE active = 1 OR ended_at >= ? ORDER BY started_at DESC LIMIT 100`)
      .all(now - 7 * 86400_000);
    return { enabled: !!this.cfg.apiKey, intervalSec: this.cfg.intervalSec, metrics: METRICS, cities, incidents, anomalies };
  }
}

module.exports = { TrafficMonitor, bucketFor, robustStats, METRICS };
