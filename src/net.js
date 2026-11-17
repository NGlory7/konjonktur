const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function fetchText(url, { timeoutMs = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en,tr;q=0.8", ...headers },
      signal: controller.signal
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("zaman aşımı");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  // Bazı API'ler BOM ile döner
  return JSON.parse(text.replace(/^﻿/, ""));
}

/** Basit eşzamanlılık sınırlayıcı */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { fetchText, fetchJson, mapLimit, UA };
