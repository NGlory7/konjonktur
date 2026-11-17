const fs = require("node:fs");
const path = require("node:path");
const { fetchJson } = require("./net");

const CACHE_FILE = path.join(__dirname, "..", "data", "translations.json");
const MAX_CACHE = 8000;

const cache = new Map();
let dirty = false;

try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  for (const [k, v] of Object.entries(raw)) cache.set(k, v);
} catch (_) {}

function persist() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const entries = [...cache.entries()].slice(-MAX_CACHE);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(entries)));
  } catch (err) {
    console.warn("[çeviri] önbellek yazılamadı:", err.message);
  }
}
setInterval(persist, 60_000).unref();
process.on("exit", persist);

/**
 * Google Translate'in herkese açık uç noktası (anahtarsız).
 * Dönen: { text, detected } — başarısız olursa null.
 */
async function translate(text, target = "tr") {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const key = `${target}|${clean}`;
  if (cache.has(key)) return cache.get(key);

  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t" +
    `&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(clean.slice(0, 1500))}`;
  try {
    const data = await fetchJson(url, { timeoutMs: 8000 });
    const out = (data?.[0] || []).map((seg) => seg?.[0] || "").join("").trim();
    const result = { text: out || clean, detected: data?.[2] || null };
    cache.set(key, result);
    dirty = true;
    return result;
  } catch (_) {
    return null;
  }
}

module.exports = { translate, persistTranslations: persist };
