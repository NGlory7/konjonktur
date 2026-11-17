const { stripTags } = require("./text");

function pick(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? stripTags(m[1]) : "";
}

function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}\\s[^>]*${attr}="([^"]+)"`, "i");
  const m = block.match(re);
  return m ? m[1] : "";
}

/**
 * RSS 2.0, RDF (RSS 1.0) ve Atom akışlarını ayrıştırır.
 * Dönen: [{ title, link, ts, source, summary }]
 */
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    let title = pick(block, "title");
    if (!title) continue;
    let link = pick(block, "link") || pickAttr(block, "link", "href") || pickAttr(block, "item", "rdf:about");
    const dateStr = pick(block, "pubDate") || pick(block, "dc:date") || pick(block, "updated") || pick(block, "published");
    const ts = Date.parse(dateStr);
    let source = pick(block, "source");
    const summary = pick(block, "description") || pick(block, "summary");

    // Google News başlıkları "Başlık - Kaynak" biçimindedir
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }

    items.push({
      title,
      link: link.trim(),
      ts: Number.isFinite(ts) ? ts : Date.now(),
      source,
      summary: summary.slice(0, 400)
    });
  }
  return items;
}

module.exports = { parseFeed };
