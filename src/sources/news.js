const { fetchText, mapLimit } = require("../net");
const { parseFeed } = require("../rss");
const { stripTags, guessScript, hashString } = require("../text");

/** RSS akışlarını çeker. Dönen: { items, status: {feedId: {ok, count, error}} } */
async function fetchRssFeeds(feeds) {
  const status = {};
  const groups = await mapLimit(feeds, 6, async (feed) => {
    try {
      const xml = await fetchText(feed.url, { timeoutMs: 12000 });
      const parsed = parseFeed(xml).slice(0, 40);
      status[feed.id] = { ok: true, count: parsed.length, name: feed.name, at: Date.now() };
      return parsed.map((p) => ({
        id: `${feed.id}_${hashString(p.link || p.title)}`,
        title: p.title,
        summary: p.summary,
        url: p.link,
        ts: Math.min(p.ts, Date.now()),
        source: p.source || feed.name,
        feedId: feed.id,
        feedName: feed.name,
        category: feed.category,
        lang: feed.lang === "tr" ? "tr" : guessScript(p.title),
        kind: "rss"
      }));
    } catch (err) {
      status[feed.id] = { ok: false, error: err.message, name: feed.name, at: Date.now() };
      return [];
    }
  });
  return { items: groups.flat(), status };
}

/**
 * Halka açık Telegram kanal önizlemesini (t.me/s/<kanal>) okur.
 */
async function fetchTelegramChannels(channels) {
  const status = {};
  const groups = await mapLimit(channels, 4, async (ch) => {
    try {
      const html = await fetchText(`https://t.me/s/${ch.id}`, { timeoutMs: 12000 });
      const blocks = html.split('<div class="tgme_widget_message_wrap').slice(1);
      const items = [];
      for (const b of blocks) {
        const post = (b.match(/data-post="([^"]+)"/) || [])[1];
        const dt = (b.match(/<time[^>]+datetime="([^"]+)"/) || [])[1];
        const textHtml = (b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
        if (!post || !textHtml) continue;
        const text = stripTags(textHtml).replace(/\s*\n\s*/g, " · ").trim();
        if (text.length < 12) continue;
        const ts = Date.parse(dt);
        items.push({
          id: `tg_${post.replace(/\W/g, "_")}`,
          title: text.length > 280 ? `${text.slice(0, 277)}…` : text,
          summary: "",
          url: `https://t.me/${post}`,
          ts: Number.isFinite(ts) ? ts : Date.now(),
          source: ch.name,
          feedId: `tg_${ch.id}`,
          feedName: ch.name,
          category: "tg",
          lang: guessScript(text),
          kind: "telegram"
        });
      }
      const recent = items.slice(-20);
      status[`tg_${ch.id}`] = { ok: true, count: recent.length, name: `TG · ${ch.name}`, at: Date.now() };
      return recent;
    } catch (err) {
      status[`tg_${ch.id}`] = { ok: false, error: err.message, name: `TG · ${ch.name}`, at: Date.now() };
      return [];
    }
  });
  return { items: groups.flat(), status };
}

module.exports = { fetchRssFeeds, fetchTelegramChannels };
