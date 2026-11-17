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

  // Askeri uçak filtresi (adsb.lol /v2/mil) — Orta Doğu + Doğu Akdeniz kutusu
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
