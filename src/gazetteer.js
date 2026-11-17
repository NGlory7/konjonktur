/**
 * Çok dilli yer adı sözlüğü — başlıktaki yer adlarını haritaya oturtmak için.
 * Biçim: [id, Türkçe ad, enlem, boylam, ülke id, düzey, ...takma adlar]
 *   düzey: "c" = ülke, "s" = şehir/nokta, "a" = bölge/deniz/boğaz
 * Latin alfabeli takma adlar kelime sınırıyla, Arapça/Farsça/İbranice olanlar
 * (ön ekler bitiştiği için) alt dize olarak eşleşir.
 * me: true → Orta Doğu konjonktürüne dahil ülke.
 */

const ME_COUNTRIES = new Set([
  "il", "ps", "lb", "sy", "iq", "ir", "jo", "eg", "sa", "ye", "ae", "qa", "bh", "kw", "om", "tr", "cy", "ly", "sd", "af", "pk", "az", "am"
]);

const PLACES = [
  // ---------------- Ülkeler ----------------
  ["il", "İsrail", 31.4, 35.0, "il", "c", "Israel", "Israeli", "Israelis", "İsrail", "İsrailli", "IDF", "Netanyahu", "Knesset", "ישראל", "צה\"ל", "إسرائيل", "الاحتلال", "اسرائیل", "رژیم صهیونیستی"],
  ["ps", "Filistin", 31.9, 35.2, "ps", "c", "Palestine", "Palestinian", "Palestinians", "Filistin", "Filistinli", "فلسطين", "فلسطین", "פלסטין", "Hamas", "Hamas'", "חמאס", "حماس"],
  ["gaza", "Gazze", 31.45, 34.4, "ps", "a", "Gaza", "Gazze", "Gazan", "Gazans", "עזה", "غزة", "غزه"],
  ["westbank", "Batı Şeria", 32.0, 35.25, "ps", "a", "West Bank", "Batı Şeria", "יהודה ושומרון", "الضفة الغربية", "کرانه باختری"],
  ["lb", "Lübnan", 33.85, 35.86, "lb", "c", "Lebanon", "Lebanese", "Lübnan", "Lübnanlı", "Hezbollah", "Hizbullah", "חיזבאללה", "לבנון", "لبنان", "حزب الله", "حزب‌الله"],
  ["sy", "Suriye", 35.0, 38.5, "sy", "c", "Syria", "Syrian", "Suriye", "Suriyeli", "סוריה", "سوريا", "سوریه"],
  ["iq", "Irak", 33.0, 43.7, "iq", "c", "Iraq", "Iraqi", "Irak", "Iraklı", "עיראק", "العراق", "عراق"],
  ["ir", "İran", 32.4, 53.7, "ir", "c", "Iran", "Iranian", "Iranians", "Tehran's", "İran", "İranlı", "IRGC", "Khamenei", "Hamaney", "Devrim Muhafızları", "איראן", "إيران", "ايران", "ایران", "سپاه", "الحرس الثوري"],
  ["jo", "Ürdün", 31.2, 36.5, "jo", "c", "Jordan", "Jordanian", "Ürdün", "ירדן", "الأردن", "اردن"],
  ["eg", "Mısır", 26.8, 30.8, "eg", "c", "Egypt", "Egyptian", "Mısır", "Mısırlı", "מצרים", "مصر"],
  ["sa", "Suudi Arabistan", 24.0, 45.0, "sa", "c", "Saudi", "Saudi Arabia", "Suudi", "Suudi Arabistan", "סעודיה", "السعودية", "عربستان"],
  ["ye", "Yemen", 15.6, 48.0, "ye", "c", "Yemen", "Yemeni", "Houthi", "Houthis", "Husi", "Husiler", "Husiler'", "תימן", "החות'ים", "اليمن", "الحوثي", "الحوثيون", "یمن", "حوثی"],
  ["ae", "BAE", 24.0, 54.0, "ae", "c", "UAE", "Emirates", "Emirati", "BAE", "Birleşik Arap Emirlikleri", "איחוד האמירויות", "الإمارات", "امارات"],
  ["qa", "Katar", 25.3, 51.2, "qa", "c", "Qatar", "Qatari", "Katar", "قطر"],
  ["bh", "Bahreyn", 26.05, 50.55, "bh", "c", "Bahrain", "Bahreyn", "בחריין", "البحرين", "بحرین"],
  ["kw", "Kuveyt", 29.3, 47.6, "kw", "c", "Kuwait", "Kuwaiti", "Kuveyt", "כווית", "الكويت", "کویت"],
  ["om", "Umman", 21.5, 57.0, "om", "c", "Oman", "Omani", "Umman", "עומאן", "عمان", "عُمان"],
  ["tr", "Türkiye", 39.0, 35.2, "tr", "c", "Turkey", "Türkiye", "Turkish", "Erdogan", "Erdoğan", "טורקיה", "تركيا", "ترکیه"],
  ["cy", "Kıbrıs", 35.1, 33.3, "cy", "c", "Cyprus", "Kıbrıs", "קפריסין", "قبرص"],
  ["ly", "Libya", 27.0, 17.0, "ly", "c", "Libya", "Libyan", "Libya", "ليبيا", "لیبی"],
  ["sd", "Sudan", 15.5, 30.0, "sd", "c", "Sudan", "Sudanese", "Sudan", "RSF", "סודן", "السودان", "سودان"],
  ["af", "Afganistan", 34.0, 66.0, "af", "c", "Afghanistan", "Afghan", "Taliban", "Afganistan", "Taliban'", "أفغانستان", "افغانستان"],
  ["pk", "Pakistan", 30.0, 70.0, "pk", "c", "Pakistan", "Pakistani", "Pakistan", "باكستان", "پاکستان"],
  ["az", "Azerbaycan", 40.3, 47.7, "az", "c", "Azerbaijan", "Azerbaycan", "אזרבייג'ן", "أذربيجان", "آذربایجان"],
  ["am", "Ermenistan", 40.1, 45.0, "am", "c", "Armenia", "Ermenistan", "أرمينيا", "ارمنستان"],

  // Dünya — haritada gösterilsin diye
  ["ua", "Ukrayna", 49.0, 31.4, "ua", "c", "Ukraine", "Ukrainian", "Ukrayna", "Zelensky", "Zelenskiy", "אוקראינה", "أوكرانيا", "اوکراین"],
  ["ru", "Rusya", 55.75, 37.6, "ru", "c", "Russia", "Russian", "Kremlin", "Putin", "Rusya", "Moscow", "Moskova", "רוסיה", "روسيا", "روسیه"],
  ["us", "ABD", 38.9, -77.0, "us", "c", "United States", "U.S.", "US", "USA", "Washington", "White House", "Pentagon", "Trump", "ABD", "Beyaz Saray", "ארה\"ב", "الولايات المتحدة", "واشنطن", "آمریکا"],
  ["cn", "Çin", 39.9, 116.4, "cn", "c", "China", "Chinese", "Beijing", "Çin", "סין", "الصين", "چین"],
  ["eu", "AB", 50.85, 4.35, "eu", "c", "European Union", "EU", "Brussels", "Avrupa Birliği", "Brüksel", "NATO"],
  ["uk", "İngiltere", 51.5, -0.12, "uk", "c", "Britain", "British", "UK", "London", "İngiltere", "Londra"],
  ["fr", "Fransa", 48.85, 2.35, "fr", "c", "France", "French", "Paris", "Macron", "Fransa"],
  ["de", "Almanya", 52.52, 13.4, "de", "c", "Germany", "German", "Berlin", "Almanya"],
  ["in", "Hindistan", 28.6, 77.2, "in", "c", "India", "Indian", "New Delhi", "Hindistan"],
  ["tw", "Tayvan", 25.03, 121.56, "tw", "c", "Taiwan", "Taiwanese", "Tayvan"],
  ["kp", "Kuzey Kore", 39.03, 125.75, "kp", "c", "North Korea", "Pyongyang", "Kuzey Kore"],
  ["ve", "Venezuela", 10.5, -66.9, "ve", "c", "Venezuela", "Venezuelan", "Caracas"],

  // ---------------- İsrail ----------------
  ["jerusalem", "Kudüs", 31.778, 35.235, "il", "s", "Jerusalem", "Kudüs", "Al-Aqsa", "Aksa", "ירושלים", "القدس", "الأقصى", "قدس"],
  ["telaviv", "Tel Aviv", 32.08, 34.78, "il", "s", "Tel Aviv", "תל אביב", "تل أبيب", "تل‌آویو", "تل آویو"],
  ["haifa", "Hayfa", 32.79, 34.99, "il", "s", "Haifa", "Hayfa", "חיפה", "حيفا", "حیفا"],
  ["eilat", "Eilat", 29.557, 34.95, "il", "s", "Eilat", "אילת", "إيلات", "ایلات"],
  ["beersheba", "Beerşeba", 31.25, 34.79, "il", "s", "Beersheba", "Beer Sheva", "Beerşeba", "באר שבע", "بئر السبع"],
  ["ashkelon", "Aşkelon", 31.67, 34.57, "il", "s", "Ashkelon", "Aşkelon", "אשקלון", "عسقلان"],
  ["ashdod", "Aşdod", 31.8, 34.65, "il", "s", "Ashdod", "Aşdod", "אשדוד", "أسدود"],
  ["sderot", "Sderot", 31.525, 34.596, "il", "s", "Sderot", "שדרות", "سديروت"],
  ["dimona", "Dimona", 31.07, 35.03, "il", "s", "Dimona", "דימונה", "ديمونا", "دیمونا"],
  ["galilee", "Celile", 32.9, 35.4, "il", "a", "Galilee", "Celile", "Kiryat Shmona", "Metula", "Nahariya", "גליל", "קריית שמונה", "מטולה", "נהריה", "الجليل"],
  ["golan", "Golan", 33.0, 35.75, "sy", "a", "Golan", "גולן", "الجولان", "جولان"],

  // ---------------- Filistin ----------------
  ["gazacity", "Gazze Şehri", 31.52, 34.45, "ps", "s", "Gaza City", "Gazze kenti", "Gazze şehri", "עזה העיר", "مدينة غزة"],
  ["rafah", "Refah", 31.29, 34.25, "ps", "s", "Rafah", "Refah", "רפיח", "رفح"],
  ["khanyounis", "Han Yunus", 31.34, 34.3, "ps", "s", "Khan Younis", "Khan Yunis", "Han Yunus", "חאן יונס", "خان يونس"],
  ["jabalia", "Cibaliye", 31.53, 34.48, "ps", "s", "Jabalia", "Jabaliya", "Cibaliye", "ג'באליה", "جباليا"],
  ["deirbalah", "Deyr el-Belah", 31.42, 34.35, "ps", "s", "Deir al-Balah", "Deir el-Balah", "Deyr el-Belah", "דיר אל-בלח", "دير البلح"],
  ["nuseirat", "Nusayrat", 31.45, 34.39, "ps", "s", "Nuseirat", "Nusayrat", "النصيرات"],
  ["jenin", "Cenin", 32.46, 35.3, "ps", "s", "Jenin", "Cenin", "ג'נין", "جنين"],
  ["nablus", "Nablus", 32.22, 35.26, "ps", "s", "Nablus", "שכם", "نابلس"],
  ["ramallah", "Ramallah", 31.9, 35.2, "ps", "s", "Ramallah", "רמאללה", "رام الله"],
  ["hebron", "El Halil", 31.53, 35.1, "ps", "s", "Hebron", "El Halil", "חברון", "الخليل"],
  ["tulkarm", "Tulkerim", 32.31, 35.03, "ps", "s", "Tulkarm", "Tulkarem", "Tulkerim", "טול כרם", "طولكرم"],

  // ---------------- Lübnan ----------------
  ["beirut", "Beyrut", 33.89, 35.5, "lb", "s", "Beirut", "Beyrut", "Dahiyeh", "Dahieh", "Dahiye", "ביירות", "דאחייה", "بيروت", "الضاحية", "بیروت"],
  ["tyre", "Sur", 33.27, 35.2, "lb", "s", "Tyre"],
  ["sidon", "Sayda", 33.56, 35.37, "lb", "s", "Sidon", "Saida", "Sayda", "צידון", "صيدا"],
  ["nabatieh", "Nebatiye", 33.38, 35.48, "lb", "s", "Nabatieh", "Nabatiyeh", "Nebatiye", "נבטייה", "النبطية"],
  ["bekaa", "Bekaa", 33.85, 35.9, "lb", "a", "Bekaa", "Baalbek", "Baalbek", "Balbek", "בקעת הלבנון", "בעלבכ", "البقاع", "بعلبك"],
  ["southlebanon", "Güney Lübnan", 33.25, 35.4, "lb", "a", "south Lebanon", "southern Lebanon", "Güney Lübnan", "דרום לבנון", "جنوب لبنان"],

  // ---------------- Suriye ----------------
  ["damascus", "Şam", 33.51, 36.29, "sy", "s", "Damascus", "Şam", "דמשק", "دمشق"],
  ["aleppo", "Halep", 36.2, 37.16, "sy", "s", "Aleppo", "Halep", "حلب"],
  ["idlib", "İdlib", 35.93, 36.63, "sy", "s", "Idlib", "İdlib", "إدلب", "ادلب"],
  ["homs", "Humus", 34.73, 36.71, "sy", "s", "Homs", "Humus", "حمص"],
  ["hama", "Hama", 35.13, 36.75, "sy", "s", "Hama", "حماة"],
  ["latakia", "Lazkiye", 35.52, 35.78, "sy", "s", "Latakia", "Lazkiye", "Hmeimim", "Hmeymim", "اللاذقية", "حميميم"],
  ["tartus", "Tartus", 34.89, 35.89, "sy", "s", "Tartus", "طرطوس"],
  ["deirezzor", "Deyrizor", 35.33, 40.14, "sy", "s", "Deir ez-Zor", "Deir ez-Zor", "Deir al-Zour", "Deyrizor", "Deir Ezzor", "دير الزور"],
  ["raqqa", "Rakka", 35.95, 39.01, "sy", "s", "Raqqa", "Rakka", "الرقة"],
  ["qamishli", "Kamışlı", 37.05, 41.22, "sy", "s", "Qamishli", "Kamışlı", "Hasakah", "Haseke", "القامشلي", "الحسكة"],
  ["daraa", "Dera", 32.62, 36.1, "sy", "s", "Daraa", "Dera", "درعا"],
  ["suwayda", "Süveyda", 32.7, 36.57, "sy", "s", "Sweida", "Suwayda", "Süveyda", "סווידא", "السويداء"],
  ["quneitra", "Kuneytra", 33.12, 35.82, "sy", "s", "Quneitra", "Kuneytra", "קוניטרה", "القنيطرة"],

  // ---------------- Irak ----------------
  ["baghdad", "Bağdat", 33.31, 44.36, "iq", "s", "Baghdad", "Bağdat", "בגדד", "بغداد"],
  ["erbil", "Erbil", 36.19, 44.01, "iq", "s", "Erbil", "Irbil", "أربيل", "اربیل"],
  ["mosul", "Musul", 36.34, 43.13, "iq", "s", "Mosul", "Musul", "الموصل"],
  ["kirkuk", "Kerkük", 35.47, 44.39, "iq", "s", "Kirkuk", "Kerkük", "كركوك", "کرکوک"],
  ["basra", "Basra", 30.51, 47.81, "iq", "s", "Basra", "البصرة", "بصره"],
  ["sulaymaniyah", "Süleymaniye", 35.56, 45.44, "iq", "s", "Sulaymaniyah", "Sulaimaniyah", "Süleymaniye", "السليمانية"],
  ["sinjar", "Sincar", 36.32, 41.87, "iq", "s", "Sinjar", "Sincar", "سنجار"],

  // ---------------- İran ----------------
  ["tehran", "Tahran", 35.69, 51.39, "ir", "s", "Tehran", "Tahran", "טהרן", "طهران", "تهران"],
  ["isfahan", "İsfahan", 32.65, 51.67, "ir", "s", "Isfahan", "Esfahan", "İsfahan", "איספהאן", "أصفهان", "اصفهان"],
  ["natanz", "Natanz", 33.72, 51.73, "ir", "s", "Natanz", "נתנז", "نطنز"],
  ["fordow", "Fordo", 34.88, 50.99, "ir", "s", "Fordow", "Fordo", "פורדו", "فوردو"],
  ["bushehr", "Buşehr", 28.97, 50.84, "ir", "s", "Bushehr", "Buşehr", "בושהר", "بوشهر"],
  ["tabriz", "Tebriz", 38.08, 46.29, "ir", "s", "Tabriz", "Tebriz", "تبريز", "تبریز"],
  ["shiraz", "Şiraz", 29.59, 52.58, "ir", "s", "Shiraz", "Şiraz", "شيراز", "شیراز"],
  ["mashhad", "Meşhed", 36.3, 59.6, "ir", "s", "Mashhad", "Meşhed", "مشهد"],
  ["bandarabbas", "Bender Abbas", 27.18, 56.27, "ir", "s", "Bandar Abbas", "Bender Abbas", "بندر عباس", "بندرعباس"],
  ["kharg", "Hark Adası", 29.25, 50.32, "ir", "s", "Kharg", "Hark Adası", "خارك", "خارگ"],
  ["ahvaz", "Ahvaz", 31.32, 48.67, "ir", "s", "Ahvaz", "Ahwaz", "الأهواز", "اهواز"],
  ["kermanshah", "Kirmanşah", 34.31, 47.07, "ir", "s", "Kermanshah", "Kirmanşah", "كرمانشاه", "کرمانشاه"],
  ["chabahar", "Çabahar", 25.29, 60.64, "ir", "s", "Chabahar", "Çabahar", "چابهار"],
  ["qom", "Kum", 34.64, 50.88, "ir", "s", "Qom"],

  // ---------------- Körfez / Yemen / Kızıldeniz ----------------
  ["hormuz", "Hürmüz Boğazı", 26.57, 56.25, "ir", "a", "Hormuz", "Hürmüz", "הורמוז", "هرمز"],
  ["redsea", "Kızıldeniz", 20.0, 38.5, "ye", "a", "Red Sea", "Kızıldeniz", "הים האדום", "البحر الأحمر", "دریای سرخ"],
  ["babelmandeb", "Babülmendep", 12.6, 43.4, "ye", "a", "Bab el-Mandeb", "Bab al-Mandab", "Babülmendep", "باب المندب"],
  ["gulfaden", "Aden Körfezi", 12.5, 48.0, "ye", "a", "Gulf of Aden", "Aden Körfezi", "خليج عدن"],
  ["sanaa", "Sana", 15.37, 44.19, "ye", "s", "Sanaa", "Sana'a", "Sana", "צנעא", "صنعاء", "صنعا"],
  ["hodeidah", "Hudeyde", 14.8, 42.95, "ye", "s", "Hodeidah", "Hudaydah", "Hudeyde", "חודיידה", "الحديدة"],
  ["aden", "Aden", 12.79, 45.03, "ye", "s", "Aden"],
  ["marib", "Marib", 15.46, 45.32, "ye", "s", "Marib", "مأرب"],
  ["riyadh", "Riyad", 24.71, 46.68, "sa", "s", "Riyadh", "Riyad", "ריאד", "الرياض", "ریاض"],
  ["jeddah", "Cidde", 21.49, 39.19, "sa", "s", "Jeddah", "Cidde", "جدة"],
  ["doha", "Doha", 25.29, 51.53, "qa", "s", "Doha", "דוחא", "الدوحة", "دوحه"],
  ["dubai", "Dubai", 25.2, 55.27, "ae", "s", "Dubai", "דובאי", "دبي", "دبی"],
  ["abudhabi", "Abu Dabi", 24.45, 54.38, "ae", "s", "Abu Dhabi", "Abu Dabi", "أبوظبي", "أبو ظبي"],
  ["muscat", "Maskat", 23.59, 58.41, "om", "s", "Muscat", "Maskat", "مسقط"],
  ["manama", "Manama", 26.22, 50.58, "bh", "s", "Manama", "المنامة"],
  ["amman", "Amman", 31.95, 35.93, "jo", "s", "Amman", "עמאן", "عمّان"],
  ["cairo", "Kahire", 30.04, 31.24, "eg", "s", "Cairo", "Kahire", "קהיר", "القاهرة", "قاهره"],
  ["sinai", "Sina", 29.5, 33.8, "eg", "a", "Sinai", "Sina Yarımadası", "سيناء"],
  ["suez", "Süveyş", 30.0, 32.55, "eg", "a", "Suez", "Süveyş", "סואץ", "السويس"],

  // ---------------- Türkiye ----------------
  ["ankara", "Ankara", 39.93, 32.86, "tr", "s", "Ankara", "אנקרה", "أنقرة", "آنکارا"],
  ["istanbul", "İstanbul", 41.01, 28.97, "tr", "s", "Istanbul", "İstanbul", "איסטנבול", "إسطنبول", "استانبول"],
  ["hatay", "Hatay", 36.2, 36.16, "tr", "s", "Hatay", "Antakya"],
  ["gaziantep", "Gaziantep", 37.07, 37.38, "tr", "s", "Gaziantep"],
  ["incirlik", "İncirlik", 37.0, 35.43, "tr", "s", "Incirlik", "İncirlik"],

  // ---------------- Diğer ----------------
  ["tripoli_ly", "Trablus", 32.89, 13.19, "ly", "s", "Tripoli", "Trablus", "طرابلس"],
  ["khartoum", "Hartum", 15.5, 32.56, "sd", "s", "Khartoum", "Hartum", "الخرطوم"],
  ["darfur", "Darfur", 13.5, 24.5, "sd", "a", "Darfur", "El Fasher", "El-Fasher", "دارفور", "الفاشر"],
  ["kabul", "Kabil", 34.53, 69.17, "af", "s", "Kabul", "Kabil", "کابل"],
  ["baku", "Bakü", 40.41, 49.87, "az", "s", "Baku", "Bakü", "باكو", "باکو"],
  ["kyiv", "Kiev", 50.45, 30.52, "ua", "s", "Kyiv", "Kiev", "קייב", "كييف"],
  ["nicosia", "Lefkoşa", 35.17, 33.36, "cy", "s", "Nicosia", "Lefkoşa"]
];

const LATIN = /^[\p{Script=Latin}\p{N}\s.'’\-"]+$/u;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const compiled = PLACES.map(([id, name, lat, lon, country, level, ...aliases]) => {
  const latin = aliases.filter((a) => LATIN.test(a));
  const other = aliases.filter((a) => !LATIN.test(a));
  // Kelime sınırı: Türkçe ekler kesme işaretiyle ayrıldığı için yeterli
  const re = latin.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${latin.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "u")
    : null;
  return { id, name, lat, lon, country, level, me: ME_COUNTRIES.has(country), re, other };
});

const LEVEL_RANK = { s: 0, a: 1, c: 2 };

/**
 * Metindeki yer adlarını bulur. En özel olandan (şehir) en genele (ülke) sıralı döner.
 */
function findPlaces(...texts) {
  const text = texts.filter(Boolean).join(" \n ");
  if (!text) return [];
  const hits = [];
  for (const p of compiled) {
    if ((p.re && p.re.test(text)) || p.other.some((a) => text.includes(a))) {
      hits.push(p);
    }
  }
  // Özel bir yer bulunduysa aynı ülkenin genel kaydını ayrıca listelemeye gerek yok
  const specificCountries = new Set(hits.filter((h) => h.level !== "c").map((h) => h.country));
  return hits
    .filter((h) => h.level !== "c" || !specificCountries.has(h.country))
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
    .slice(0, 4)
    .map(({ id, name, lat, lon, country, level, me }) => ({ id, name, lat, lon, country, level, me }));
}

const COUNTRY_NAMES = Object.fromEntries(
  PLACES.filter((p) => p[5] === "c").map((p) => [p[0], p[1]])
);

module.exports = { findPlaces, ME_COUNTRIES, COUNTRY_NAMES };
