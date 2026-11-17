/**
 * Kalıcı depolama — Node'un yerleşik SQLite modülü (node:sqlite, Node 22.5+). Ek paket gerekmez.
 * Dosya: data/konjonktur.db
 */
const fs = require("node:fs");
const path = require("node:path");

// node:sqlite ilk yüklemede "experimental" uyarısı basar; yalnızca o uyarıyı sustur
const origEmit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes("SQLite") ? undefined : origEmit.call(process, w, ...a));
const { DatabaseSync } = require("node:sqlite");
process.emitWarning = origEmit;

function open(file = path.join(__dirname, "..", "data", "konjonktur.db")) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;

    -- Her yoklamada şehir başına bir satır (anomali baz çizgisinin kaynağı)
    CREATE TABLE IF NOT EXISTS traffic_samples (
      city        TEXT    NOT NULL,
      ts          INTEGER NOT NULL,      -- ms
      bucket      TEXT    NOT NULL,      -- 'wd-08' / 'we-17' (yerel saate göre hafta içi/sonu + saat)
      jam_km      REAL    NOT NULL,      -- toplam sıkışıklık uzunluğu
      delay_min   REAL    NOT NULL,      -- toplam gecikme
      closures    INTEGER NOT NULL,      -- aktif yol kapanması sayısı
      accidents   INTEGER NOT NULL,
      incidents   INTEGER NOT NULL,
      PRIMARY KEY (city, ts)
    );
    CREATE INDEX IF NOT EXISTS ix_samples_bucket ON traffic_samples(city, bucket, ts);

    -- Görülen her trafik olayı (kapanma, kaza, sıkışıklık...) ilk/son görülme zamanıyla
    CREATE TABLE IF NOT EXISTS traffic_incidents (
      id          TEXT PRIMARY KEY,
      city        TEXT NOT NULL,
      category    TEXT NOT NULL,
      magnitude   INTEGER,
      description TEXT,
      road        TEXT,
      from_place  TEXT,
      to_place    TEXT,
      lat         REAL,
      lon         REAL,
      geometry    TEXT,                  -- JSON [[lon,lat],...]
      length_m    REAL,
      delay_s     REAL,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS ix_incidents_active ON traffic_incidents(active, city);

    -- Tespit edilen anomaliler (başlangıç, bitiş, tepe değeri)
    CREATE TABLE IF NOT EXISTS traffic_anomalies (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      city            TEXT    NOT NULL,
      metric          TEXT    NOT NULL,
      started_at      INTEGER NOT NULL,
      ended_at        INTEGER,
      peak_z          REAL    NOT NULL,
      peak_value      REAL    NOT NULL,
      baseline_median REAL    NOT NULL,
      last_z          REAL    NOT NULL,
      active          INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS ix_anomalies_active ON traffic_anomalies(active, city, metric);
  `);
  return db;
}

module.exports = { open };
