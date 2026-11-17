/**
 * Anahtar kelime tabanlı önem derecesi ve konu etiketleme.
 * Bu bir sezgisel (heuristic) sınıflandırmadır — haberin doğruluğunu değil,
 * başlığın içeriğindeki olay türünü kabaca işaretler.
 */

const RULES = [
  {
    topic: "saldırı",
    severity: 3,
    words: [
      "missile", "missiles", "ballistic", "airstrike", "air strike", "airstrikes", "strike on", "strikes on", "bombard", "bombing",
      "explosion", "explosions", "blast", "rocket", "rockets", "drone attack", "drones", "shelling", "intercept", "sirens", "killed",
      "dead", "casualties", "massacre", "attack on", "attacks on", "assassinat", "invasion", "invade", "artillery", "bomb",
      "topçu", "hedef aldı", "hedef alıyor", "bomba",
      "füze", "hava saldırısı", "bombardıman", "patlama", "roket", "İHA saldırısı", "SİHA", "öldü", "hayatını kaybetti", "can kaybı",
      "katliam", "saldırı", "suikast", "siren", "önleme", "vuruldu", "vurdu",
      "טיל", "טילים", "רקטה", "רקטות", "תקיפה", "פיצוץ", "יירוט", "אזעקה", "אזעקות", "חוסל", "נהרג", "הרוגים", "כטב\"ם",
      "صاروخ", "صواريخ", "غارة", "غارات", "قصف", "انفجار", "اعتراض", "شهيد", "شهداء", "قتلى", "اغتيال", "مسيرة", "هجوم",
      "موشک", "حمله", "انفجار", "پهپاد", "شهید", "کشته", "ترور", "رهگیری"
    ]
  },
  {
    topic: "nükleer",
    severity: 3,
    words: ["nuclear", "uranium", "enrichment", "IAEA", "nükleer", "uranyum", "zenginleştirme", "UAEA", "גרעין", "نووي", "هسته‌ای", "هسته ای", "غنی‌سازی"]
  },
  {
    topic: "askeri",
    severity: 2,
    words: [
      "military", "troops", "army", "IDF", "IRGC", "navy", "warship", "aircraft carrier", "fighter jet", "jets", "deploy", "mobiliz",
      "raid", "clash", "clashes", "offensive", "operation", "ground forces", "Hezbollah", "Houthi", "militia", "tanker seized",
      "asker", "ordu", "savaş gemisi", "uçak gemisi", "savaş uçağı", "konuşlan", "baskın", "çatışma", "operasyon", "kara harekatı",
      "צבא", "חיילים", "מבצע", "פשיטה", "עימות", "תמרון",
      "جيش", "عسكري", "اشتباك", "اشتباكات", "عملية", "توغل", "اقتحام",
      "ارتش", "نظامی", "سپاه", "عملیات", "درگیری"
    ]
  },
  {
    topic: "insani",
    severity: 2,
    words: [
      "humanitarian", "famine", "starvation", "aid", "refugee", "displaced", "hostage", "hostages", "prisoner",
      "insani", "kıtlık", "açlık", "yardım", "mülteci", "yerinden", "rehine", "esir",
      "חטופים", "חטוף", "הומניטרי",
      "إنساني", "مجاعة", "مساعدات", "نازحين", "أسرى", "رهائن",
      "انسانی", "قحطی", "گروگان", "آوارگان"
    ]
  },
  {
    topic: "diplomasi",
    severity: 1,
    words: [
      "ceasefire", "truce", "talks", "negotiat", "summit", "agreement", "deal", "diplomat", "envoy", "UN Security Council", "mediat",
      "ateşkes", "müzakere", "görüşme", "zirve", "anlaşma", "diplomasi", "arabulucu", "BM Güvenlik Konseyi", "temas",
      "הפסקת אש", "הסכם", "שיחות", "משא ומתן",
      "وقف إطلاق النار", "هدنة", "مفاوضات", "محادثات", "اتفاق", "قمة",
      "آتش‌بس", "آتش بس", "مذاکره", "مذاکرات", "توافق"
    ]
  },
  {
    topic: "ekonomi",
    severity: 1,
    words: [
      "oil", "crude", "Brent", "sanction", "sanctions", "shipping", "tanker", "OPEC", "gas", "inflation", "currency",
      "petrol", "ham petrol", "yaptırım", "tanker", "doğalgaz", "enflasyon", "kur",
      "נפט", "סנקציות", "نفط", "عقوبات", "ناقلة", "نفت", "تحریم"
    ]
  }
];

const LATIN = /^[\p{Script=Latin}\p{N}\s.'’\-"]+$/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compiled = RULES.map((r) => {
  const latin = r.words.filter((w) => LATIN.test(w));
  const other = r.words.filter((w) => !LATIN.test(w));
  return {
    ...r,
    // Başta kelime sınırı, sonda değil — "killed/killing", "saldırısı" gibi çekimleri yakalar
    re: new RegExp(`(?<![\\p{L}])(?:${latin.map(escapeRe).join("|")})`, "iu"),
    other
  };
});

/**
 * Dönen: { severity: 0-3, topics: [] }
 *   3 = kritik (saldırı / nükleer), 2 = yüksek, 1 = orta, 0 = genel
 */
function classify(...texts) {
  const text = texts.filter(Boolean).join(" \n ");
  let severity = 0;
  const topics = [];
  for (const r of compiled) {
    if (r.re.test(text) || r.other.some((w) => text.includes(w))) {
      topics.push(r.topic);
      severity = Math.max(severity, r.severity);
    }
  }
  return { severity, topics };
}

module.exports = { classify };
