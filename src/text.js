const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“"
};

function decodeEntities(str) {
  return String(str || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Dil tahmini (yazı sistemine göre) — çeviri öncesi kaba ayrım */
function guessScript(text) {
  if (/[֐-׿]/.test(text)) return "he";
  if (/[پچژگکی]/.test(text)) return "fa";
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[çğıöşüÇĞİÖŞÜ]/.test(text)) return "tr";
  return "en";
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Yinelenen haberleri yakalamak için başlık anahtarı */
function dedupeKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

module.exports = { decodeEntities, stripTags, guessScript, hashString, dedupeKey };
