const test = require("node:test");
const assert = require("node:assert");
const { Clusterer, stems } = require("../src/cluster");

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 17, 12);
const israel = [{ id: "il" }];
const iran = [{ id: "ir" }];

test("kökler: büyük/küçük harf, noktalama, dolgu kelimeleri", () => {
  const s = stems("İsrail ordusu, Gazze'de bir okulu vurdu!");
  assert.deepEqual([...s], ["israi", "ordus", "gazze", "okulu", "vurdu"]);
});

test("aynı olayın farklı kaynaklardaki başlıkları tek kümede", () => {
  const c = new Clusterer();
  const a = c.assign({ id: "1", ts: T0, titleTr: "İran Devrim Muhafızları Bahreyn'deki ABD radarlarını vurduğunu açıkladı", places: iran });
  const b = c.assign({ id: "2", ts: T0 + 0.5 * H, titleTr: "Devrim Muhafızları: Bahreyn'deki ABD radarları vuruldu", places: iran });
  const x = c.assign({ id: "3", ts: T0 + 0.7 * H, titleTr: "Mısır Gazze'ye yeni yardım konvoyu gönderdi", places: [{ id: "eg" }] });
  assert.equal(a, b);
  assert.notEqual(a, x);
});

test("ortak kelime az olan farklı haberler birleşmez", () => {
  const c = new Clusterer();
  const a = c.assign({ id: "1", ts: T0, titleTr: "İsrail kabinesi ateşkes teklifini görüştü", places: israel });
  const b = c.assign({ id: "2", ts: T0 + H, titleTr: "İsrail ordusu Lübnan sınırına takviye gönderdi", places: israel });
  assert.notEqual(a, b);
});

test("zaman penceresi dışındaki benzer başlık yeni küme açar", () => {
  const c = new Clusterer({ windowHours: 8 });
  const t = "Hürmüz Boğazı'nda tanker trafiği durma noktasına geldi";
  const a = c.assign({ id: "1", ts: T0, titleTr: t, places: iran });
  const b = c.assign({ id: "2", ts: T0 + 20 * H, titleTr: t, places: iran });
  assert.notEqual(a, b);
});
