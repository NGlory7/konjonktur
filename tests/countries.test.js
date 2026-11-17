const test = require("node:test");
const assert = require("node:assert");
const { countryFromHex, countryFromMmsi } = require("../src/countries");
const { plausible } = require("../src/sources/routes");

test("ICAO adres bloğundan tescil ülkesi", () => {
  assert.equal(countryFromHex("738a1b"), "IL");
  assert.equal(countryFromHex("716ffc"), "SA");
  assert.equal(countryFromHex("896123"), "AE");
  assert.equal(countryFromHex("06a0aa"), "QA");
  assert.equal(countryFromHex("4b8123"), null); // Türkiye bloğu → izlenen bölge ülkesi değil
});

test("MMSI'den bayrak devleti", () => {
  assert.equal(countryFromMmsi(422123456), "IR");
  assert.equal(countryFromMmsi(470999000), "AE");
  assert.equal(countryFromMmsi(271000000), null);
});

test("tarifeli rota konumla uyuşmuyorsa doğrulanamaz", () => {
  const dxbLhr = { from: { lat: 25.25, lon: 55.36 }, to: { lat: 51.47, lon: -0.45 } };
  assert.equal(plausible(dxbLhr, 38.5, 35.0), true); // Türkiye üzerinden normal güzergâh
  assert.equal(plausible(dxbLhr, 1.3, 103.9), false); // Singapur — rotayla ilgisiz
});
