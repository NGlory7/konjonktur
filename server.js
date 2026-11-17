/**
 * KONJONKTÜR — canlı dünya & Orta Doğu durum ekranı
 * Sıfır bağımlılık: yalnızca Node.js (v18+) yerleşik modülleri.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const hub = require("./src/hub");

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const clients = new Set();

hub.on("update", (payload) => {
  const data = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
});

// Bağlantıyı canlı tut (proxy / tarayıcı zaman aşımlarına karşı)
setInterval(() => {
  for (const res of clients) res.write(`: ping ${Date.now()}\n\n`);
}, 25_000).unref();

function handleStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });
  res.write("retry: 5000\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function serveStatic(req, pathname, res) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Yasak");
  }
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Bulunamadı");
    }
    // Tarayıcı her açılışta dosyanın değişip değişmediğini sorsun: güncellemeden sonra eski app.js /
    // index.html karışımı yüklenip arayüz bozulmasın (Edge önbelleği bu sorunu çıkarıyordu)
    const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    const headers = {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      ETag: etag
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/state") return sendJson(res, 200, hub.snapshot());
    if (url.pathname === "/api/stream") return handleStream(req, res);
    if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true, sources: hub.sources });
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    return serveStatic(req, url.pathname, res);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

// Yalnızca bu bilgisayardan erişilebilir
const HOST = process.env.HOST || "127.0.0.1";
server.listen(config.port, HOST, () => {
  console.log("\n  KONJONKTÜR — canlı dünya & Orta Doğu durum ekranı");
  console.log(`  http://localhost:${config.port}\n`);
  hub.start();
});
