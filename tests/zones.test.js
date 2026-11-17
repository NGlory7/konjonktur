const test = require("node:test");
const assert = require("node:assert");
const db = require("../src/db");
const { ZoneMonitor } = require("../src/zones");
const { countByZone } = require("../src/sources/air");
const { AisStream } = require("../src/sources/ais");

const DAY = 86400_000;
const METRICS = { airborne: { label: "uçak", unit: "", floor: 3 }, military: { label: "askeri", unit: "", floor: 1 } };

test("hava sahası boşalması negatif anomali açar ve SQL'de saklanır", () => {
  const d = db.open(":memory:");
  const mon = new ZoneMonitor(d, { domain: "air", metrics: METRICS, minBaselineSamples: 8 });
  let t = Date.UTC(2026, 0, 4, 8); // Pazar — İsrail'de hafta içi
  for (const n of [42, 38, 45, 40, 41, 39, 44, 43, 40, 42]) {
    mon.record("israel", "Asia/Jerusalem", { airborne: n, military: 1 }, t);
    do t += DAY; while ([5, 6].includes(new Date(t).getUTCDay())); // İsrail hafta içi, aynı saat → aynı kova
  }
  const r = mon.record("israel", "Asia/Jerusalem", { airborne: 3, military: 0 }, t);
  const o = r.opened.find((x) => x.metric === "airborne");
  assert.ok(o && o.z <= -3, JSON.stringify(r.evaluation.metrics.airborne));
  const row = d.prepare("SELECT * FROM traffic_anomalies WHERE city = 'air:israel'").get();
  assert.equal(row.peak_value, 3);
  assert.equal(row.active, 1);
});

test("uçaklar bölgeye göre sayılır; yerdekiler sayılmaz", () => {
  const zones = [{ id: "a" }, { id: "b" }];
  const c = countByZone(
    [
      { zone: "a", onGround: false, military: true },
      { zone: "a", onGround: true, military: false },
      { zone: "b", onGround: false, military: false },
      { zone: null, onGround: false, military: true }
    ],
    zones
  );
  assert.deepEqual(c, { a: { airborne: 1, military: 1 }, b: { airborne: 1, military: 0 } });
});

test("AIS mesajları gemiyi doğru bölgeye ve sınıfa yerleştirir", () => {
  const ais = new AisStream({ apiKey: "", zones: [{ id: "hormuz", bbox: [[25.4, 55.4], [27.3, 57.3]] }] });
  // aisstream her mesajın MetaData'sında konum gönderir
  const meta = (mmsi, lat, lon) => ({ MMSI: mmsi, ShipName: "TEST ", latitude: lat, longitude: lon });
  ais.handle({ MessageType: "ShipStaticData", MetaData: meta(1, 26.5, 56.3), Message: { ShipStaticData: { Type: 84, Destination: "FUJAIRAH" } } });
  ais.handle({ MessageType: "PositionReport", MetaData: meta(1, 26.5, 56.3), Message: { PositionReport: { Latitude: 26.5, Longitude: 56.3, Sog: 12, Cog: 90, TrueHeading: 511 } } });
  const [v] = ais.list();
  assert.equal(v.zone, "hormuz");
  assert.equal(v.cls, "tanker");
  assert.equal(v.heading, null);
  assert.deepEqual(ais.countByZone().hormuz, { vessels: 1, tankers: 1, cargo: 0, underway: 1 });
});

test("bölge dışındaki yabancı gemi atılır, bölge ülkesi bayraklı gemi her yerde tutulur", () => {
  const ais = new AisStream({ apiKey: "", zones: [{ id: "hormuz", bbox: [[25.4, 55.4], [27.3, 57.3]] }] });
  const pos = (mmsi, lat, lon) => ({
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, latitude: lat, longitude: lon },
    Message: { PositionReport: { Latitude: lat, Longitude: lon, Sog: 10, Cog: 0, TrueHeading: 0 } }
  });
  ais.handle(pos(271000001, 1.2, 103.8)); // Türk bayraklı, Singapur'da → tutulmaz
  ais.handle(pos(422000001, 1.2, 103.8)); // İran bayraklı, Singapur'da → tutulur
  const list = ais.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].country, "IR");
  assert.equal(list[0].zone, null);
});
