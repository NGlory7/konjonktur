// node --test   (Node 22+ yerleşik test koşucusu; ek paket yok)
const test = require("node:test");
const assert = require("node:assert");
const db = require("../src/db");
const { TrafficMonitor, bucketFor, robustStats } = require("../src/traffic");

const CFG = {
  apiKey: "test",
  minBaselineSamples: 8,
  baselineDays: 28,
  openZ: 3,
  closeZ: 1.5,
  cities: [{ id: "x", name: "X", lat: 0, lon: 0, bbox: [0, 0, 1, 1], tz: "Europe/Istanbul" }]
};
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const summary = (jam, extra = {}) => ({ jam_km: jam, delay_min: jam * 2, closures: 0, accidents: 1, incidents: 5, ...extra });

// Aynı saat kovasına düşen ölçümler: her hafta içi günü aynı saatte (İstanbul hafta sonu atlanır)
function nextWeekday(t) {
  do t += DAY; while ([0, 6].includes(new Date(t).getUTCDay()));
  return t;
}
function seed(mon, values, t0) {
  let t = t0;
  for (const v of values) {
    mon.record("x", [], summary(v), t);
    t = nextWeekday(t);
  }
  return t;
}

test("hafta içi / hafta sonu ve yerel saat kovası", () => {
  // 2026-11-16 Pazartesi 09:00 İstanbul = 06:00 UTC
  assert.equal(bucketFor(Date.UTC(2026, 10, 16, 6), "Europe/Istanbul"), "wd-09");
  // Cuma İsrail'de hafta sonu
  assert.equal(bucketFor(Date.UTC(2026, 10, 20, 10), "Asia/Jerusalem").slice(0, 2), "we");
});

test("robust istatistik aykırı değerden etkilenmez", () => {
  const { median, mad } = robustStats([10, 11, 9, 10, 12, 10, 500]);
  assert.equal(median, 10);
  assert.ok(mad <= 1);
});

test("yeterli geçmiş yokken z hesaplanmaz, anomali açılmaz", () => {
  const mon = new TrafficMonitor(db.open(":memory:"), CFG);
  const t = seed(mon, [10, 11, 9], Date.UTC(2026, 0, 5, 6));
  const r = mon.record("x", [], summary(80), t);
  assert.equal(r.evaluation.ready, false);
  assert.equal(r.evaluation.metrics.jam_km.z, null);
  assert.equal(r.opened.length, 0);
});

test("ani sıkışıklık anomali açar, normale dönünce kapanır ve SQL'de saklanır", () => {
  const d = db.open(":memory:");
  const mon = new TrafficMonitor(d, CFG);
  let t = seed(mon, [10, 12, 9, 11, 10, 13, 9, 11, 10, 12], Date.UTC(2026, 0, 5, 6));

  const spike = mon.record("x", [], summary(60), t);
  assert.ok(spike.evaluation.metrics.jam_km.z >= 3, `z=${spike.evaluation.metrics.jam_km.z}`);
  assert.ok(spike.opened.some((o) => o.metric === "jam_km"));

  t = nextWeekday(t);
  const calm = mon.record("x", [], summary(11), t);
  assert.ok(calm.closed.some((c) => c.metric === "jam_km"));

  const row = d.prepare("SELECT * FROM traffic_anomalies WHERE metric = 'jam_km'").get();
  assert.equal(row.active, 0);
  assert.equal(row.peak_value, 60);
  assert.ok(row.ended_at > row.started_at);
});

test("beklenenden çok sakin trafik negatif anomali olarak yakalanır", () => {
  const mon = new TrafficMonitor(db.open(":memory:"), CFG);
  const t = seed(mon, [40, 42, 38, 41, 39, 43, 40, 41, 42, 39], Date.UTC(2026, 0, 5, 6));
  const r = mon.record("x", [], summary(2), t);
  const o = r.opened.find((x) => x.metric === "jam_km");
  assert.ok(o && o.z <= -3);
});

test("olaylar ilk görülme zamanını korur, kaybolunca pasifleşir", () => {
  const d = db.open(":memory:");
  const mon = new TrafficMonitor(d, CFG);
  const inc = { id: "x:1", category: "yol kapalı", categoryCode: 8, magnitude: 4, description: "Closed", road: "D100",
                from: "A", to: "B", lat: 1, lon: 1, geometry: null, lengthM: 500, delayS: 0 };
  const t0 = Date.UTC(2026, 0, 5, 6);
  assert.equal(mon.record("x", [inc], summary(1, { closures: 1 }), t0).newIncidents.length, 1);
  assert.equal(mon.record("x", [inc], summary(1, { closures: 1 }), t0 + 900_000).newIncidents.length, 0);
  mon.record("x", [], summary(1), t0 + 1800_000);
  const row = d.prepare("SELECT * FROM traffic_incidents WHERE id = 'x:1'").get();
  assert.equal(row.first_seen, t0);
  assert.equal(row.last_seen, t0 + 900_000);
  assert.equal(row.active, 0);
});
