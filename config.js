/**
 * KONJONKTÜR — kaynak yapılandırması
 *
 * Buradaki tüm kaynaklar halka açık ve API anahtarı gerektirmez.
 * Kaynak eklemek / çıkarmak için sadece bu dosyayı düzenleyin.
 *
 * category: "me"    → Orta Doğu odaklı kaynak
 *           "world" → genel dünya haberleri (Orta Doğu ile ilgili olanlar konum eşleşmesiyle ayrıca etiketlenir)
 *           "tr"    → Türkiye kaynakları
 */

// .env dosyasını (varsa) yükle — bağımlılıksız basit ayrıştırıcı
try {
  const envText = require("node:fs").readFileSync(require("node:path").join(__dirname, ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (_) {}

// Şehir kutusu: merkez ± yarı genişlik (derece). TomTom kutu başına en fazla 10.000 km² kabul eder.
const box = (lat, lon, dLat = 0.14, dLon = 0.17) => [lon - dLon, lat - dLat, lon + dLon, lat + dLat];

const gnews = (q, hl, gl, ceid) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;

module.exports = {
  port: Number(process.env.PORT) || 8090,

  // Yenileme aralıkları (saniye)
  intervals: {
    news: 120,
    telegram: 120,
    aircraft: 30,
    markets: 60,
    quakes: 300,
    sirens: 5,
    sirenHistory: 90
  },

  // ---------------- Anomali kapsamı ----------------
  // Anomali tespiti (trafik, hava, deniz) yalnızca aşağıdaki İsrail, İran ve Körfez bölgelerinde yapılır.
  // Haritadaki diğer veriler (Türkiye dahil: askeri uçaklar, depremler, haberler) gösterilmeye devam eder,
  // ama onlar için baz çizgisi tutulmaz ve anomali üretilmez.

  // ---------------- Hava trafiği (adsb.fi, anahtarsız) ----------------
  // Yarıçap deniz mili (en fazla 250). Her bölgenin uçak sayısı sampleSec'te bir SQLite'a yazılır.
  air: {
    pollSec: 60, // 7 bölge + askeri sorgu sırayla, 1,1 sn arayla (adsb.fi: saniyede en fazla 1 istek)
    sampleSec: 300,
    // Bölge ülkelerinde tescilli uçakları dünya genelinde bulma (OpenSky anonim kotası: ~100 sorgu/gün)
    nationalPollSec: 900,
    zones: [
      { id: "israel", name: "İsrail hava sahası", lat: 31.6, lon: 34.9, nm: 140, tz: "Asia/Jerusalem" },
      { id: "iran_n", name: "İran (kuzey / Tahran)", lat: 35.6, lon: 51.4, nm: 250, tz: "Asia/Tehran" },
      { id: "iran_s", name: "İran (güney / İsfahan–Şiraz)", lat: 30.8, lon: 53.5, nm: 250, tz: "Asia/Tehran" },
      { id: "iran_e", name: "İran (doğu / Meşhed)", lat: 33.5, lon: 59.0, nm: 250, tz: "Asia/Tehran" },
      { id: "gulf_w", name: "Körfez batı (Kuveyt–Bahreyn–Katar)", lat: 26.6, lon: 50.4, nm: 250, tz: "Asia/Riyadh" },
      { id: "gulf_e", name: "Körfez doğu (BAE–Umman)", lat: 24.6, lon: 56.0, nm: 250, tz: "Asia/Dubai" },
      { id: "saudi", name: "Suudi Arabistan (Riyad–Cidde)", lat: 23.5, lon: 43.5, nm: 250, tz: "Asia/Riyadh" }
    ]
  },

  // ---------------- Deniz trafiği (aisstream.io, ücretsiz anahtar) ----------------
  // .env içine AISSTREAM_KEY=... (https://aisstream.io → GitHub ile giriş → API key)
  marine: {
    apiKey: process.env.AISSTREAM_KEY || "",
    sampleSec: 300,
    staleMin: 30, // bu kadar dakikadır konum göndermeyen gemi haritadan düşer
    // [[güney, batı], [kuzey, doğu]]
    zones: [
      { id: "east_med", name: "Doğu Akdeniz (İsrail kıyısı)", bbox: [[31.2, 33.6], [33.3, 35.2]], tz: "Asia/Jerusalem" },
      { id: "aqaba", name: "Akabe Körfezi (Eilat)", bbox: [[27.9, 34.2], [29.6, 35.1]], tz: "Asia/Jerusalem" },
      { id: "red_sea", name: "Kızıldeniz", bbox: [[12.4, 32.5], [27.9, 43.6]], tz: "Asia/Riyadh" },
      { id: "gulf", name: "Basra Körfezi", bbox: [[23.8, 47.6], [30.5, 55.4]], tz: "Asia/Dubai" },
      { id: "hormuz", name: "Hürmüz Boğazı", bbox: [[25.4, 55.4], [27.3, 57.3]], tz: "Asia/Dubai" },
      { id: "oman_gulf", name: "Umman Körfezi", bbox: [[22.4, 57.3], [25.7, 61.8]], tz: "Asia/Muscat" }
    ]
  },

  // ---------------- Trafik analizi ----------------
  // Kaynak: TomTom Traffic Incidents API (ücretsiz anahtar: developer.tomtom.com → .env içine TOMTOM_KEY=...)
  // Her şehir için tek çağrı; 8 şehir × 15 dk aralık ≈ 770 istek/gün (ücretsiz kota 2.500).
  traffic: {
    apiKey: process.env.TOMTOM_KEY || "",
    intervalSec: Number(process.env.TRAFFIC_INTERVAL_SEC) || 900,
    // Anomali kuralı: aynı saat dilimindeki (hafta içi/sonu ayrı) geçmiş ölçümlere göre robust Z-skoru
    minBaselineSamples: 8, // baz çizgisi bu kadar örnekten önce "oluşuyor" sayılır
    baselineDays: 28,
    openZ: 3.0, // anomali başlar
    closeZ: 1.5, // anomali biter
    // Not: TomTom'un İsrail ve İran için yol/trafik verisi yok (API "Point too far from nearest existing segment"
    // döndürüyor, olay listesi hep boş). Bu yüzden şehir trafiği yalnızca Körfez'de ölçülür; İsrail ve İran
    // hava/deniz trafiği ve haberlerle izlenir. Başka bir trafik kaynağı bulunursa buraya eklenebilir.
    cities: [
      // Körfez
      { id: "riyadh", name: "Riyad", lat: 24.71, lon: 46.68, bbox: box(24.71, 46.68, 0.18, 0.2), tz: "Asia/Riyadh" },
      { id: "jeddah", name: "Cidde", lat: 21.54, lon: 39.17, bbox: box(21.54, 39.17, 0.15, 0.12), tz: "Asia/Riyadh" },
      { id: "dubai", name: "Dubai", lat: 25.15, lon: 55.25, bbox: box(25.15, 55.25, 0.15, 0.2), tz: "Asia/Dubai" },
      { id: "abudhabi", name: "Abu Dabi", lat: 24.45, lon: 54.45, bbox: box(24.45, 54.45, 0.12, 0.18), tz: "Asia/Dubai" },
      { id: "doha", name: "Doha", lat: 25.29, lon: 51.50, bbox: box(25.29, 51.50, 0.12, 0.12), tz: "Asia/Qatar" },
      { id: "kuwait", place: "kw", name: "Kuveyt", lat: 29.33, lon: 47.98, bbox: box(29.33, 47.98, 0.12, 0.15), tz: "Asia/Kuwait" },
      { id: "manama", name: "Manama", lat: 26.21, lon: 50.57, bbox: box(26.21, 50.57, 0.08, 0.08), tz: "Asia/Bahrain" },
      { id: "muscat", name: "Maskat", lat: 23.59, lon: 58.40, bbox: box(23.59, 58.40, 0.1, 0.2), tz: "Asia/Muscat" }
    ]
  },

  // Haberler kaç saat hafızada tutulsun
  newsRetentionHours: 48,
  maxNewsItems: 1500,

  // Türkçe dışındaki başlıklar otomatik Türkçeye çevrilsin mi
  translate: true,
  targetLang: "tr",

  rss: [
    // ---- Orta Doğu odaklı ----
    { id: "aje", name: "Al Jazeera", lang: "en", category: "me", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    { id: "bbcme", name: "BBC Orta Doğu", lang: "en", category: "me", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
    { id: "guardianme", name: "Guardian ME", lang: "en", category: "me", url: "https://www.theguardian.com/world/middleeast/rss" },
    { id: "mee", name: "Middle East Eye", lang: "en", category: "me", url: "https://www.middleeasteye.net/rss" },
    { id: "f24me", name: "France 24 ME", lang: "en", category: "me", url: "https://www.france24.com/en/middle-east/rss" },
    { id: "iranintl", name: "Iran International", lang: "en", category: "me", url: "https://www.iranintl.com/en/feed" },

    // ---- Google News — yerel dillerde Orta Doğu taraması ----
    { id: "gn_he", name: "Google News · עברית", lang: "he", category: "me",
      url: gnews("איראן OR חיזבאללה OR עזה OR טילים OR צה\"ל when:1d", "iw", "IL", "IL:he") },
    { id: "gn_fa", name: "Google News · فارسی", lang: "fa", category: "me",
      url: gnews("اسرائیل OR سپاه OR حمله OR موشک when:1d", "fa", "IR", "IR:fa") },
    { id: "gn_ar", name: "Google News · العربية", lang: "ar", category: "me",
      url: gnews("غزة OR لبنان OR سوريا OR اليمن OR إيران when:1d", "ar", "EG", "EG:ar") },
    { id: "gn_en", name: "Google News · EN", lang: "en", category: "me",
      url: gnews("Middle East (Iran OR Israel OR Gaza OR Lebanon OR Syria OR Yemen OR Iraq) when:1d", "en-US", "US", "US:en") },
    { id: "gn_tr", name: "Google News · TR", lang: "tr", category: "me",
      url: gnews("(İran OR İsrail OR Gazze OR Lübnan OR Suriye OR Yemen OR Irak) when:1d", "tr", "TR", "TR:tr") },

    // ---- Dünya ----
    { id: "bbcworld", name: "BBC World", lang: "en", category: "world", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { id: "dw", name: "DW", lang: "en", category: "world", url: "https://rss.dw.com/rdf/rss-en-world" },
    { id: "guardianworld", name: "Guardian World", lang: "en", category: "world", url: "https://www.theguardian.com/world/rss" },
    { id: "gn_world", name: "Google News · World", lang: "en", category: "world",
      url: "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en" },

    // ---- Türkiye ----
    { id: "aa", name: "Anadolu Ajansı", lang: "tr", category: "tr", url: "https://www.aa.com.tr/tr/rss/default?cat=dunya" },
    { id: "trt", name: "TRT Haber", lang: "tr", category: "tr", url: "https://www.trthaber.com/dunya_articles.rss" }
  ],

  // Halka açık Telegram kanalları (t.me/s/<kanal> önizlemesinden okunur).
  // Not: Bunlar doğrulanmamış hızlı akışlardır; resmi kaynak değildir.
  telegram: [
    { id: "warmonitors", name: "War Monitor" },
    { id: "ClashReport", name: "Clash Report" },
    { id: "englishabuali", name: "Abu Ali Express (EN)" },
    { id: "manniefabian", name: "Mannie's War Room" },
    { id: "Middle_East_Spectator", name: "Middle East Spectator" },
    { id: "IranintlTV", name: "Iran International" },
    { id: "QudsNen", name: "Quds News Network" },
    { id: "PressTV", name: "Press TV" }
  ],

  // Yahoo Finance sembolleri
  markets: [
    { symbol: "BZ=F", name: "Brent", unit: "$" },
    { symbol: "CL=F", name: "WTI", unit: "$" },
    { symbol: "NG=F", name: "Doğalgaz", unit: "$" },
    { symbol: "GC=F", name: "Altın", unit: "$" },
    { symbol: "USDTRY=X", name: "USD/TRY", unit: "₺" },
    { symbol: "EURTRY=X", name: "EUR/TRY", unit: "₺" },
    { symbol: "XU100.IS", name: "BIST100", unit: "" },
    { symbol: "TA35.TA", name: "TA-35", unit: "" },
    { symbol: "^GSPC", name: "S&P500", unit: "" },
    { symbol: "DX-Y.NYB", name: "DXY", unit: "" },
    { symbol: "BTC-USD", name: "BTC", unit: "$" }
  ],

  // Askeri uçak filtresi (adsb.fi /v2/mil) — Orta Doğu + Doğu Akdeniz kutusu
  aircraftBox: { latMin: 10, latMax: 43, lonMin: 24, lonMax: 64 },

  // Deprem filtresi (USGS) — aynı kutu, M2.5+
  quakeBox: { latMin: 10, latMax: 45, lonMin: 20, lonMax: 70 },

  // Canlı TV (YouTube kanal kimlikleri)
  tv: [
    { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera English" },
    { id: "UC7fWeaHhqgM4Ry-RMpM2YYw", name: "TRT World" },
    { id: "UCBgTP2LOFVPmq15W-RH-WXA", name: "TRT Haber" },
    { id: "UCfiwzLy-8yKzIbsmZTzxDgw", name: "Al Jazeera Arabic" },
    { id: "UCahpxixMCwoANAftn6IxkTg", name: "Al Arabiya" },
    { id: "UCvHDpsWKADrDia0c99X37vg", name: "i24NEWS English" },
    { id: "UCQfwfsi5VrQ8yKZ-UWmAEFg", name: "France 24 English" },
    { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News" },
    { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News" }
  ]
};
