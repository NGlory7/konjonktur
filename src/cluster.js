/**
 * Haber kümeleme: aynı olayı anlatan başlıkları (farklı kaynak ve dillerden) tek kümede toplar.
 *
 * Yabancı başlıklar zaten Türkçeye çevrildiği için karşılaştırma Türkçe metin üzerinden yapılır:
 *   1. Metin küçük harfe çevrilir, noktalama ve dolgu kelimeleri atılır.
 *   2. Her kelimenin ilk 5 harfi alınır (kaba kök: "saldırısı" ≈ "saldırdı" ≈ "saldı").
 *   3. İki başlığın kök kümeleri Jaccard benzerliğiyle karşılaştırılır.
 * Ortak bir yer adı varsa eşik düşer, yoksa yükselir. Yalnızca son `windowHours` içindeki
 * haberlerle eşleşme aranır.
 */

const STOP = new Set(
  (
    "ve veya ile ama fakat için gibi kadar daha çok en bir bu şu o da de mi mı mu mü ki ise ne " +
    "olan olarak oldu olduğu olduğunu ettı etti eden etmek yaptı yapılan sonra önce karşı üzerine " +
    "göre ilk son yeni büyük her tüm bütün iki üç dört beş on yüz bin milyon açıkladı söyledi " +
    "dedi bildirdi belirtti iddia haber canlı son dakika video foto"
  ).split(" ")
);

function stems(text) {
  const words = String(text || "")
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  return new Set(words.map((w) => w.slice(0, 5)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

class Clusterer {
  constructor({ windowHours = 8, withPlace = 0.34, withoutPlace = 0.5, minShared = 3 } = {}) {
    Object.assign(this, { windowMs: windowHours * 3600_000, withPlace, withoutPlace, minShared });
    this.recent = []; // { id, ts, stems, places:Set, cluster }
    this.nextId = 1;
  }

  /** Haberi en benzer kümeye ekler ya da yeni küme açar. Dönen: küme kimliği. */
  assign(item) {
    const s = stems(item.titleTr || item.title);
    const places = new Set((item.places || []).map((p) => p.id));
    const cutoff = item.ts - this.windowMs;
    this.recent = this.recent.filter((r) => r.ts >= cutoff - this.windowMs); // listeyi sınırlı tut

    let best = null;
    let bestScore = 0;
    for (const r of this.recent) {
      if (Math.abs(r.ts - item.ts) > this.windowMs) continue;
      let shared = 0;
      for (const x of s) if (r.stems.has(x)) shared++;
      if (shared < this.minShared) continue;
      const placeOverlap = [...places].some((p) => r.places.has(p));
      const score = jaccard(s, r.stems);
      const need = placeOverlap ? this.withPlace : this.withoutPlace;
      if (score >= need && score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    const cluster = best ? best.cluster : `c${this.nextId++}`;
    this.recent.push({ id: item.id, ts: item.ts, stems: s, places, cluster });
    return cluster;
  }
}

module.exports = { Clusterer, stems, jaccard };
