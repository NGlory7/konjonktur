/* KONJONKTÜR — istemci */
(() => {
  "use strict";

  // ---------------- yardımcılar ----------------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const ago = (ts) => {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return "şimdi";
    if (m < 60) return `${m} dk`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} sa`;
    return `${Math.floor(h / 24)} g`;
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`konj.${k}`);
        return v === null ? d : JSON.parse(v);
      } catch (_) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`konj.${k}`, JSON.stringify(v));
      } catch (_) {}
    }
  };
  const throttle = (fn, ms) => {
    let t = null;
    return () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        fn();
      }, ms);
    };
  };

  const COUNTRY_TR = {
    il: "İsrail", ps: "Filistin", lb: "Lübnan", sy: "Suriye", iq: "Irak", ir: "İran", jo: "Ürdün", eg: "Mısır",
    sa: "Suudi Arabistan", ye: "Yemen", ae: "BAE", qa: "Katar", bh: "Bahreyn", kw: "Kuveyt", om: "Umman",
    tr: "Türkiye", cy: "Kıbrıs", ly: "Libya", sd: "Sudan", af: "Afganistan", pk: "Pakistan", az: "Azerbaycan", am: "Ermenistan"
  };
  const SEV_COLOR = ["#6c7a8c", "#4dabf7", "#ff9f43", "#ff4d4f"];
  const TOPIC_LABEL = { saldırı: "saldırı", nükleer: "nükleer", askeri: "askeri", insani: "insani", diplomasi: "diplomasi", ekonomi: "ekonomi" };

  // ---------------- durum ----------------
  const state = {
    news: [],
    aircraft: [],
    quakes: [],
    markets: [],
    sirens: { active: [], history: [] },
    sources: {},
    tv: [],
    seen: new Set(),
    loadedAt: Date.now()
  };
  const ui = {
    tab: store.get("tab", "me"),
    critOnly: store.get("critOnly", false),
    showOrig: store.get("showOrig", false),
    hours: store.get("hours", 6),
    view: store.get("view", "me"),
    sound: store.get("sound", false),
    notify: store.get("notify", false),
    tvId: store.get("tvId", null),
    query: "",
    place: null, // {id, name} veya {country, name}
    limit: 200
  };

  // ---------------- saatler ----------------
  const CLOCKS = [
    ["Europe/Istanbul", "İstanbul"],
    ["Asia/Jerusalem", "Kudüs"],
    ["Asia/Tehran", "Tahran"],
    ["Asia/Riyadh", "Riyad"],
    ["Europe/London", "Londra"],
    ["America/New_York", "Washington"],
    ["UTC", "UTC"]
  ];
  function renderClocks() {
    const now = new Date();
    $("#clocks").innerHTML = CLOCKS.map(([tz, name]) => {
      const t = now.toLocaleTimeString("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
      const h = Number(t.slice(0, 2));
      return `<div class="clock${h < 6 || h >= 21 ? " night" : ""}"><b>${t}</b><span>${name}</span></div>`;
    }).join("");
  }

  // ---------------- harita ----------------
  const VIEWS = {
    me: [[12, 25], [42, 62]],
    levant: [[29.3, 33.5], [37.3, 40.5]],
    gulf: [[12, 42], [32, 60]],
    world: [[-50, -150], [70, 160]]
  };
  const map = L.map("map", { zoomControl: true, worldCopyJump: true, attributionControl: true, minZoom: 2 });
  // Esri koyu gri altlık + etiket katmanı (anahtarsız)
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
  L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 16,
    attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap"
  }).addTo(map);
  const labelPane = map.createPane("labels");
  labelPane.style.zIndex = 450;
  labelPane.style.pointerEvents = "none";
  L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: "labels", opacity: 0.8 }).addTo(map);
  map.fitBounds(VIEWS[ui.view] || VIEWS.me);
  // Izgara yerleşimi tamamlandıktan sonra boyutu yeniden ölç
  window.addEventListener("load", () => {
    map.invalidateSize();
    map.fitBounds(VIEWS[ui.view] || VIEWS.me);
  });

  const layers = {
    news: L.layerGroup().addTo(map),
    aircraft: L.layerGroup().addTo(map),
    quakes: L.layerGroup().addTo(map),
    sirens: L.layerGroup().addTo(map)
  };
  const layerCtl = L.control
    .layers(null, {
      "Haber yoğunluğu": layers.news,
      "Askeri uçaklar": layers.aircraft,
      Depremler: layers.quakes,
      "İsrail sirenleri": layers.sirens
    }, { collapsed: true, position: "topright" })
    .addTo(map);
  const hiddenLayers = store.get("hiddenLayers", []);
  for (const [k, lg] of Object.entries(layers)) if (hiddenLayers.includes(k)) map.removeLayer(lg);
  map.on("overlayadd overlayremove", () => {
    store.set("hiddenLayers", Object.entries(layers).filter(([, lg]) => !map.hasLayer(lg)).map(([k]) => k));
  });
  void layerCtl;

  let focusMarker = null;
  function focusPlace(p) {
    if (!p || p.lat == null) return;
    if (focusMarker) focusMarker.remove();
    focusMarker = L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: "", html: '<div class="focus-marker pulse-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false
    }).addTo(map);
    clearTimeout(focusPlace.t);
    focusPlace.t = setTimeout(() => focusMarker && focusMarker.remove(), 5000);
  }

  function renderNewsLayer() {
    layers.news.clearLayers();
    const since = Date.now() - ui.hours * 3600_000;
    const groups = new Map();
    for (const n of state.news) {
      if (n.ts < since || !n.places.length) continue;
      const p = n.places[0];
      if (!groups.has(p.id)) groups.set(p.id, { place: p, items: [], maxSev: 0, newest: 0 });
      const g = groups.get(p.id);
      g.items.push(n);
      g.maxSev = Math.max(g.maxSev, n.severity);
      g.newest = Math.max(g.newest, n.ts);
    }
    const sorted = [...groups.values()].sort((a, b) => a.items.length - b.items.length);
    for (const g of sorted) {
      const color = SEV_COLOR[g.maxSev];
      const radius = 5 + Math.sqrt(g.items.length) * 3.2;
      const fresh = Date.now() - g.newest < 30 * 60000;
      const m = L.circleMarker([g.place.lat, g.place.lon], {
        radius,
        color,
        weight: fresh ? 2.5 : 1,
        fillColor: color,
        fillOpacity: fresh ? 0.55 : 0.32
      });
      m.bindTooltip(`<b>${esc(g.place.name)}</b> · ${g.items.length} haber${fresh ? " · <span style='color:#e8b04b'>yeni</span>" : ""}`, {
        direction: "top"
      });
      const top = g.items.sort((a, b) => b.severity - a.severity || b.ts - a.ts).slice(0, 8);
      m.bindPopup(
        `<div class="pop"><h4>${esc(g.place.name)} — son ${ui.hours} saat, ${g.items.length} haber</h4><ol>${top
          .map(
            (n) =>
              `<li><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener" style="color:${n.severity >= 2 ? SEV_COLOR[n.severity] : "inherit"}">${esc(
                n.titleTr || n.title
              )}</a><div class="meta">${hhmm(n.ts)} · ${esc(n.source)}</div></li>`
          )
          .join("")}</ol><div class="meta" style="margin-top:6px"><a href="#" data-filter-place="${esc(g.place.id)}">Akışı bu yere göre filtrele →</a></div></div>`,
        { maxWidth: 380 }
      );
      m.addTo(layers.news);
    }
  }

  map.on("popupopen", (e) => {
    const a = e.popup.getElement().querySelector("[data-filter-place]");
    if (a)
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = a.dataset.filterPlace;
        const p = state.news.flatMap((n) => n.places).find((pl) => pl.id === id);
        setPlaceFilter({ id, name: p ? p.name : id });
      });
  });

  function planeIcon(a) {
    const rot = a.track ?? 0;
    return L.divIcon({
      className: "",
      // Burnu kuzeye bakan uçak silueti, rotaya göre döndürülür
      html: `<svg class="plane${a.emergency ? " emerg" : ""}" viewBox="0 0 24 24" width="16" height="16" style="transform:rotate(${rot}deg)"><path fill="currentColor" stroke="#000" stroke-width="0.6" d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.3v4.6l2.2 1.7V21L12 20l-3.5 1v-1.2l2.2-1.7v-4.6L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z"/></svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }
  function renderAircraftLayer() {
    layers.aircraft.clearLayers();
    for (const a of state.aircraft) {
      const label = [a.callsign, a.type, a.reg].filter(Boolean).join(" · ") || a.hex;
      L.marker([a.lat, a.lon], { icon: planeIcon(a) })
        .bindTooltip(
          `<b>${esc(label)}</b><br>${a.onGround ? "yerde" : `${a.alt != null ? `${Number(a.alt).toLocaleString("tr-TR")} ft` : "irtifa ?"}`}${
            a.speed != null ? ` · ${a.speed} kt` : ""
          }${a.squawk ? ` · squawk ${esc(a.squawk)}` : ""}${a.emergency ? ` · <b style="color:#ff4d4f">ACİL: ${esc(a.emergency)}</b>` : ""}`,
          { direction: "top" }
        )
        .on("click", () => window.open(`https://globe.adsb.lol/?icao=${encodeURIComponent(a.hex)}`, "_blank", "noopener"))
        .addTo(layers.aircraft);
    }
  }

  function renderQuakeLayer() {
    layers.quakes.clearLayers();
    for (const q of state.quakes) {
      L.circleMarker([q.lat, q.lon], {
        radius: 3 + q.mag * 2,
        color: "#ffd43b",
        weight: 2,
        fill: false
      })
        .bindTooltip(`<b>M${q.mag.toFixed(1)}</b> ${esc(q.place)}<br>${hhmm(q.ts)} · ${Math.round(q.depth)} km derinlik`, { direction: "top" })
        .on("click", () => window.open(q.url, "_blank", "noopener"))
        .addTo(layers.quakes);
    }
  }

  function renderSirenLayer() {
    layers.sirens.clearLayers();
    const activeIds = new Set(state.sirens.active.map((a) => a.id));
    const since = Date.now() - 24 * 3600_000;
    const events = [...state.sirens.active, ...state.sirens.history.filter((h) => h.ts >= since && !activeIds.has(h.id))];
    const drawn = new Set();
    for (const ev of events) {
      const active = activeIds.has(ev.id);
      for (const c of ev.cities) {
        if (c.lat == null) continue;
        const key = `${active}|${c.he}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const marker = active
          ? L.marker([c.lat, c.lon], {
              icon: L.divIcon({ className: "", html: '<div class="siren-marker pulse-marker"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
            })
          : L.circleMarker([c.lat, c.lon], { radius: 3, color: "#ff2d55", weight: 1, fillOpacity: 0.5 });
        marker.bindTooltip(`<b>${esc(c.en)}</b> (${esc(c.he)})<br>${esc(ev.threatName)} · ${hhmm(ev.ts)}`, { direction: "top" });
        marker.addTo(layers.sirens);
      }
    }
  }

  // ---------------- akış ----------------
  function matchesTab(n) {
    switch (ui.tab) {
      case "me": return n.me;
      case "world": return n.category === "world" && !n.me;
      case "tr": return n.category === "tr";
      case "tg": return n.kind === "telegram";
      default: return true;
    }
  }
  function matchesFilters(n) {
    if (ui.critOnly && n.severity < 2) return false;
    if (ui.place) {
      if (ui.place.id && !n.places.some((p) => p.id === ui.place.id)) return false;
      if (ui.place.country && !n.places.some((p) => p.country === ui.place.country)) return false;
    }
    if (ui.query) {
      const q = ui.query.toLocaleLowerCase("tr");
      const hay = `${n.titleTr || ""} ${n.title} ${n.source} ${n.places.map((p) => p.name).join(" ")}`.toLocaleLowerCase("tr");
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function itemHtml(n, isNew) {
    const title = n.titleTr || n.title;
    const showOrig = ui.showOrig && n.titleTr && n.titleTr !== n.title;
    const rtl = /^(ar|fa|he)$/.test(n.lang);
    const places = n.places
      .map((p) => `<span class="chip place" data-place="${esc(p.id)}" data-lat="${p.lat}" data-lon="${p.lon}">${esc(p.name)}</span>`)
      .join("");
    const topics = n.topics.slice(0, 2).map((t) => `<span class="chip topic">${esc(TOPIC_LABEL[t] || t)}</span>`).join("");
    return `<li class="s${n.severity}${isNew ? " new" : ""}" data-id="${esc(n.id)}">
      <span class="bar"></span>
      <span class="time"><b>${hhmm(n.ts)}</b>${ago(n.ts)}</span>
      <div>
        <div class="title"><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(title)}</a></div>
        ${showOrig ? `<div class="orig" dir="${rtl ? "rtl" : "ltr"}">${esc(n.title)}</div>` : ""}
        <div class="meta">
          <span class="chip ${n.kind === "telegram" ? "tg" : ""}">${n.kind === "telegram" ? "TG · " : ""}${esc(n.source)}</span>
          ${n.lang !== "tr" ? `<span class="chip lang" title="Orijinal dil — otomatik çeviri">${esc(n.lang)}→tr</span>` : ""}
          ${n.dupes ? `<span class="chip dup" title="Aynı başlık başka akışlarda da geçti">+${n.dupes}</span>` : ""}
          ${topics}${places}
        </div>
      </div>
    </li>`;
  }

  let renderedIds = new Set();
  function renderFeed() {
    const list = state.news.filter((n) => matchesTab(n) && matchesFilters(n));
    const shown = list.slice(0, ui.limit);
    const html = shown.map((n) => itemHtml(n, renderedIds.size > 0 && !renderedIds.has(n.id) && Date.now() - n.ts < 3600_000)).join("");
    const el = $("#feed");
    const scroll = el.scrollTop;
    if (!html) {
      el.innerHTML = `<li class="empty" style="display:block">${state.news.length ? "Bu filtreye uyan haber yok." : "Kaynaklar taranıyor…"}</li>`;
    } else {
      const more = list.length - shown.length;
      el.innerHTML = html + (more > 0 ? `<li class="more" style="display:block"><button id="moreBtn">${more} haber daha</button></li>` : "");
    }
    el.scrollTop = scroll;
    renderedIds = new Set(state.news.map((n) => n.id));
    $("#feedCount").textContent = `${list.length} haber`;

    // sekme sayaçları (son 6 saat)
    const since = Date.now() - 6 * 3600_000;
    const recent = state.news.filter((n) => n.ts >= since);
    const counts = {
      me: recent.filter((n) => n.me).length,
      all: recent.length,
      world: recent.filter((n) => n.category === "world" && !n.me).length,
      tr: recent.filter((n) => n.category === "tr").length,
      tg: recent.filter((n) => n.kind === "telegram").length
    };
    $$("#tabs button").forEach((b) => {
      const label = b.dataset.label || (b.dataset.label = b.textContent);
      b.innerHTML = `${esc(label)}<span class="cnt">${counts[b.dataset.tab]}</span>`;
    });
  }

  $("#feed").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip.place");
    if (chip) {
      setPlaceFilter({ id: chip.dataset.place, name: chip.textContent });
      focusPlace({ lat: +chip.dataset.lat, lon: +chip.dataset.lon });
      return;
    }
    if (e.target.id === "moreBtn") {
      ui.limit += 200;
      renderFeed();
    }
  });
  $("#feed").addEventListener("mouseover", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || li === renderFeed.hovered) return;
    renderFeed.hovered = li;
    const n = state.news.find((x) => x.id === li.dataset.id);
    if (n && n.places[0]) focusPlace(n.places[0]);
  });

  function setPlaceFilter(p) {
    ui.place = p;
    ui.limit = 200;
    const el = $("#placeFilter");
    if (p) {
      el.hidden = false;
      el.innerHTML = `Konum filtresi: <b>${esc(p.name)}</b> <button id="clearPlace">✕ kaldır</button>`;
      $("#clearPlace").onclick = () => setPlaceFilter(null);
    } else {
      el.hidden = true;
    }
    renderFeed();
  }

  // ---------------- bölge nabzı ----------------
  function renderPulse() {
    const now = Date.now();
    const w = 6 * 3600_000;
    const stats = {};
    for (const n of state.news) {
      if (n.ts < now - 2 * w) continue;
      const countries = new Set(n.places.map((p) => p.country).filter((c) => COUNTRY_TR[c]));
      for (const c of countries) {
        const s = (stats[c] ||= { cur: 0, prev: 0, crit: 0, high: 0 });
        if (n.ts >= now - w) {
          s.cur++;
          if (n.severity === 3) s.crit++;
          else if (n.severity === 2) s.high++;
        } else s.prev++;
      }
    }
    const rows = Object.entries(stats)
      .filter(([, s]) => s.cur > 0)
      .sort((a, b) => b[1].cur - a[1].cur)
      .slice(0, 14);
    const max = Math.max(1, ...rows.map(([, s]) => s.cur));
    $("#countryBars").innerHTML =
      rows
        .map(([c, s]) => {
          const pct = (v) => `${((v / max) * 100).toFixed(1)}%`;
          const diff = s.cur - s.prev;
          const trend = s.prev === 0 ? "" : diff > 0 ? `<span class="up">▲</span>` : diff < 0 ? `<span class="down">▼</span>` : "";
          return `<div class="cbar" data-country="${c}" title="${esc(COUNTRY_TR[c])}: son 6 saatte ${s.cur} haber (${s.crit} saldırı/nükleer, ${s.high} askeri/insani). Önceki 6 saat: ${s.prev}">
            <span class="cname">${esc(COUNTRY_TR[c])}</span>
            <span class="track"><i class="a" style="width:${pct(s.crit)}"></i><i class="b" style="width:${pct(s.high)}"></i><i class="c" style="width:${pct(s.cur - s.crit - s.high)}"></i></span>
            <span class="num">${s.cur} ${trend}</span>
          </div>`;
        })
        .join("") || `<div class="muted small">Veri bekleniyor…</div>`;

    // 24 saatlik hacim
    const hours = 24;
    const buckets = Array.from({ length: hours }, () => [0, 0, 0, 0]);
    const start = now - hours * 3600_000;
    for (const n of state.news) {
      if (!n.me || n.ts < start) continue;
      const idx = Math.min(hours - 1, Math.floor((n.ts - start) / 3600_000));
      buckets[idx][n.severity]++;
    }
    const vmax = Math.max(1, ...buckets.map((b) => b.reduce((x, y) => x + y, 0)));
    const bw = 100 / hours;
    let bars = "";
    buckets.forEach((b, i) => {
      let y = 46;
      for (const sev of [0, 1, 2, 3]) {
        const h = (b[sev] / vmax) * 44;
        if (!h) continue;
        y -= h;
        bars += `<rect x="${(i * bw + 0.3).toFixed(2)}" y="${y.toFixed(2)}" width="${(bw - 0.6).toFixed(2)}" height="${h.toFixed(2)}" fill="${SEV_COLOR[sev]}"><title>${hhmm(
          start + i * 3600_000
        )}: ${b.reduce((x, z) => x + z, 0)} haber</title></rect>`;
      }
    });
    $("#volume").innerHTML = `<svg viewBox="0 0 100 46" preserveAspectRatio="none">${bars}</svg>`;
  }

  $("#countryBars").addEventListener("click", (e) => {
    const row = e.target.closest(".cbar");
    if (!row) return;
    const c = row.dataset.country;
    setPlaceFilter({ country: c, name: COUNTRY_TR[c] });
  });

  function renderSirenList() {
    const activeIds = new Set(state.sirens.active.map((a) => a.id));
    const items = [...state.sirens.active, ...state.sirens.history.filter((h) => !activeIds.has(h.id))].slice(0, 8);
    $("#sirenList").innerHTML =
      items
        .map((ev) => {
          const names = ev.cities.map((c) => c.en).slice(0, 4).join(", ") + (ev.cities.length > 4 ? ` +${ev.cities.length - 4}` : "");
          const c = ev.cities.find((x) => x.lat != null);
          return `<li class="${activeIds.has(ev.id) ? "hot" : ""}" ${c ? `data-lat="${c.lat}" data-lon="${c.lon}"` : ""} title="${esc(
            ev.cities.map((x) => x.en).join(", ")
          )}"><span class="t">${new Date(ev.ts).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} ${hhmm(ev.ts)}</span>${esc(
            ev.threatName
          )} — ${esc(names)}</li>`;
        })
        .join("") || `<li class="none">Kayıt yok</li>`;
  }

  function renderAircraftList() {
    $("#acCount").textContent = state.aircraft.length ? `(${state.aircraft.length})` : "";
    const list = [...state.aircraft].sort((a, b) => (b.emergency ? 1 : 0) - (a.emergency ? 1 : 0) || (b.alt || 0) - (a.alt || 0));
    $("#acList").innerHTML =
      list
        .slice(0, 10)
        .map(
          (a) =>
            `<li class="${a.emergency ? "hot" : ""}" data-lat="${a.lat}" data-lon="${a.lon}"><span class="t">${esc(a.type || "?")}</span>${esc(
              a.callsign || a.reg || a.hex
            )} · ${a.onGround ? "yerde" : a.alt != null ? `${Math.round(a.alt / 100) * 100} ft` : "?"}${a.emergency ? ` · ACİL ${esc(a.emergency)}` : ""}</li>`
        )
        .join("") || `<li class="none">Kutu içinde ADS-B yayını yapan askeri uçak yok</li>`;
  }

  function renderQuakeList() {
    $("#quakeList").innerHTML =
      state.quakes
        .slice(0, 6)
        .map(
          (q) =>
            `<li data-lat="${q.lat}" data-lon="${q.lon}"><span class="t">${hhmm(q.ts)}</span>M${q.mag.toFixed(1)} · ${esc(q.place)}</li>`
        )
        .join("") || `<li class="none">M2.5+ deprem yok</li>`;
  }

  $(".pulse-side").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-lat]");
    if (!li) return;
    const p = { lat: +li.dataset.lat, lon: +li.dataset.lon };
    map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 7), { duration: 0.8 });
    focusPlace(p);
  });

  // ---------------- piyasalar ----------------
  function spark(values, up) {
    if (!values || values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * 46).toFixed(1)},${(15 - ((v - min) / span) * 14).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 46 16"><polyline points="${pts}" fill="none" stroke="${up ? "#3ecf8e" : "#ff6b6b"}" stroke-width="1.2"/></svg>`;
  }
  function fmtPrice(v) {
    if (v == null) return "—";
    const digits = v >= 1000 ? 0 : v >= 100 ? 1 : v >= 10 ? 2 : 3;
    return v.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function renderTicker() {
    $("#ticker").innerHTML = state.markets
      .map((m) => {
        if (!m.ok) return `<span class="tick" title="${esc(m.error || "")}"><span class="n">${esc(m.name)}</span><span class="p muted">—</span></span>`;
        const up = m.changePct >= 0;
        return `<span class="tick" title="${esc(m.symbol)} · önceki kapanış ${fmtPrice(m.prev)}"><span class="n">${esc(m.name)}</span><span class="p">${esc(m.unit)}${fmtPrice(
          m.price
        )}</span><span class="c ${up ? "up" : "down"}">${up ? "+" : ""}${m.changePct.toFixed(2)}%</span>${spark(m.spark, up)}</span>`;
      })
      .join("");
  }

  // ---------------- flaş, ses, bildirim ----------------
  let audioCtx = null;
  function beep(kind) {
    if (!ui.sound) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const seq = kind === "siren" ? [880, 660, 880, 660] : [740, 990];
      seq.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = f;
        o.type = kind === "siren" ? "sawtooth" : "sine";
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + i * 0.22 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.22 + 0.2);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.22);
        o.stop(audioCtx.currentTime + i * 0.22 + 0.21);
      });
    } catch (_) {}
  }
  function notify(title, body, url) {
    if (!ui.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, { body, tag: url || title });
      n.onclick = () => {
        window.focus();
        if (url) window.open(url, "_blank", "noopener");
      };
    } catch (_) {}
  }

  function renderFlash() {
    const el = $("#flash");
    if (state.sirens.active.length) {
      const ev = state.sirens.active[0];
      const names = state.sirens.active.flatMap((a) => a.cities.map((c) => c.en));
      el.className = "flash siren";
      el.innerHTML = `<span class="tag">SİREN</span><span>İsrail — ${esc(ev.threatName)}: ${esc(names.slice(0, 12).join(", "))}${
        names.length > 12 ? ` +${names.length - 12}` : ""
      }</span><span class="when">${hhmm(ev.ts)}</span>`;
      el.hidden = false;
      return;
    }
    const since = Date.now() - 20 * 60000;
    const crit = state.news.filter((n) => n.me && n.severity === 3 && n.ts >= since && n.kind !== "telegram");
    if (!crit.length) {
      el.hidden = true;
      return;
    }
    const n = crit[0];
    el.className = "flash";
    el.innerHTML = `<span class="tag">SON DAKİKA</span><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(
      n.titleTr || n.title
    )}</a><span class="when">${hhmm(n.ts)} · ${esc(n.source)}${crit.length > 1 ? ` · son 20 dk'da ${crit.length} kritik başlık` : ""}</span>`;
    el.hidden = false;
  }

  function onNewItems(added) {
    // İlk yüklemede eski haberler için uyarı verme
    const fresh = added.filter((n) => n.me && n.severity === 3 && n.ts > state.loadedAt - 10 * 60000 && !state.seen.has(n.id));
    added.forEach((n) => state.seen.add(n.id));
    if (fresh.length) {
      beep("news");
      const n = fresh[0];
      notify(`Kritik · ${n.places[0]?.name || "Orta Doğu"}`, n.titleTr || n.title, n.url);
    }
  }

  // ---------------- kaynak sağlığı ----------------
  function renderSources() {
    const entries = Object.values(state.sources).sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1));
    $("#sources").innerHTML = entries
      .map(
        (s) =>
          `<span class="${s.ok ? "" : "bad"}" title="${s.ok ? `${s.count} öğe · ${hhmm(s.at)}` : `HATA: ${esc(s.error)} · ${hhmm(s.at)}`}">${esc(s.name)}</span>`
      )
      .join("");
    $("#lastUpdate").textContent = `güncellendi ${hhmm(Date.now())}`;
  }

  // ---------------- TV ----------------
  function renderTvSelect() {
    const sel = $("#tvSel");
    sel.innerHTML = state.tv.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    const id = state.tv.some((c) => c.id === ui.tvId) ? ui.tvId : state.tv[0]?.id;
    if (!id) return;
    sel.value = id;
    setTv(id);
  }
  function setTv(id) {
    ui.tvId = id;
    store.set("tvId", id);
    $("#tv").src = `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(id)}&autoplay=1&mute=1&playsinline=1`;
  }
  $("#tvSel").addEventListener("change", (e) => setTv(e.target.value));

  // ---------------- veri ----------------
  const renderAll = throttle(() => {
    renderFeed();
    renderNewsLayer();
    renderPulse();
    renderFlash();
  }, 300);

  function applyUpdate(u) {
    switch (u.type) {
      case "news": {
        if (u.added?.length) {
          const ids = new Set(state.news.map((n) => n.id));
          const add = u.added.filter((n) => !ids.has(n.id));
          state.news = [...add, ...state.news].sort((a, b) => b.ts - a.ts);
          const cutoff = Date.now() - 48 * 3600_000;
          state.news = state.news.filter((n) => n.ts >= cutoff).slice(0, 1500);
          onNewItems(add);
        }
        if (u.sources) state.sources = u.sources;
        renderAll();
        renderSources();
        break;
      }
      case "aircraft":
        state.aircraft = u.aircraft;
        renderAircraftLayer();
        renderAircraftList();
        break;
      case "quakes":
        state.quakes = u.quakes;
        renderQuakeLayer();
        renderQuakeList();
        break;
      case "markets":
        state.markets = u.markets;
        renderTicker();
        break;
      case "sirens": {
        const prev = new Set(state.sirens.active.map((a) => a.id));
        state.sirens = u.sirens;
        const fresh = state.sirens.active.filter((a) => !prev.has(a.id));
        if (fresh.length) {
          beep("siren");
          notify("İsrail'de siren", `${fresh[0].threatName}: ${fresh[0].cities.map((c) => c.en).slice(0, 8).join(", ")}`);
        }
        renderSirenLayer();
        renderSirenList();
        renderFlash();
        break;
      }
    }
  }

  async function loadState() {
    const resp = await fetch("/api/state", { cache: "no-store" });
    const s = await resp.json();
    state.news = s.news;
    state.news.forEach((n) => state.seen.add(n.id));
    state.aircraft = s.aircraft;
    state.quakes = s.quakes;
    state.markets = s.markets;
    state.sirens = s.sirens;
    state.sources = s.sources;
    if (!state.tv.length) {
      state.tv = s.tv;
      renderTvSelect();
    }
    renderTicker();
    renderAircraftLayer();
    renderAircraftList();
    renderQuakeLayer();
    renderQuakeList();
    renderSirenLayer();
    renderSirenList();
    renderSources();
    renderAll();
  }

  function connect() {
    const es = new EventSource("/api/stream");
    es.addEventListener("update", (e) => {
      try {
        applyUpdate(JSON.parse(e.data));
      } catch (err) {
        console.warn(err);
      }
    });
    es.onopen = () => {
      $("#liveDot").classList.add("on");
      // Bağlantı koptuysa arada kaçanları tamamla
      if (connect.wasDown) loadState().catch(() => {});
      connect.wasDown = false;
    };
    es.onerror = () => {
      $("#liveDot").classList.remove("on");
      connect.wasDown = true;
    };
  }

  // ---------------- kontroller ----------------
  function bindSeg(sel, key, attr, after) {
    $$(`${sel} button`).forEach((b) => {
      b.classList.toggle("on", String(b.dataset[attr]) === String(ui[key]));
      b.addEventListener("click", () => {
        ui[key] = attr === "h" ? Number(b.dataset[attr]) : b.dataset[attr];
        store.set(key, ui[key]);
        $$(`${sel} button`).forEach((x) => x.classList.toggle("on", x === b));
        after();
      });
    });
  }
  bindSeg("#tabs", "tab", "tab", () => {
    ui.limit = 200;
    $("#feed").scrollTop = 0;
    renderFeed();
  });
  bindSeg("#hoursSel", "hours", "h", renderNewsLayer);
  bindSeg("#mapView", "view", "view", () => map.flyToBounds(VIEWS[ui.view], { duration: 0.8 }));

  const critEl = $("#critOnly");
  critEl.checked = ui.critOnly;
  critEl.addEventListener("change", () => {
    ui.critOnly = critEl.checked;
    store.set("critOnly", ui.critOnly);
    renderFeed();
  });
  const origEl = $("#showOrig");
  origEl.checked = ui.showOrig;
  origEl.addEventListener("change", () => {
    ui.showOrig = origEl.checked;
    store.set("showOrig", ui.showOrig);
    renderFeed();
  });
  let searchT;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      ui.query = e.target.value.trim();
      ui.limit = 200;
      renderFeed();
    }, 200);
  });

  function syncToggles() {
    $("#btnSound").textContent = ui.sound ? "🔊" : "🔇";
    $("#btnSound").classList.toggle("on", ui.sound);
    $("#btnNotify").textContent = ui.notify ? "🔔" : "🔕";
    $("#btnNotify").classList.toggle("on", ui.notify);
  }
  $("#btnSound").addEventListener("click", () => {
    ui.sound = !ui.sound;
    store.set("sound", ui.sound);
    syncToggles();
    if (ui.sound) beep("news");
  });
  $("#btnNotify").addEventListener("click", async () => {
    if (!ui.notify && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return;
    }
    ui.notify = !ui.notify;
    store.set("notify", ui.notify);
    syncToggles();
  });
  syncToggles();

  // Ekranı açık tut (Wake Lock API)
  let wakeLock = null;
  let wakeWanted = store.get("wake", true);
  async function applyWake() {
    try {
      if (wakeWanted && "wakeLock" in navigator && document.visibilityState === "visible" && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
          $("#btnWake").classList.remove("on");
        });
      } else if (!wakeWanted && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (_) {}
    $("#btnWake").classList.toggle("on", !!wakeLock);
  }
  $("#btnWake").addEventListener("click", () => {
    wakeWanted = !wakeWanted;
    store.set("wake", wakeWanted);
    applyWake();
  });
  document.addEventListener("visibilitychange", applyWake);
  applyWake();

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  $("#btnFull").addEventListener("click", toggleFull);
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "f" || e.key === "F") toggleFull();
    if (e.key === "/") {
      e.preventDefault();
      $("#search").focus();
    }
  });

  // ---------------- başlat ----------------
  renderClocks();
  setInterval(renderClocks, 15_000);
  // "x dk önce" etiketleri ve flaş bandı zamanla güncellensin
  setInterval(() => {
    renderFeed();
    renderFlash();
    renderPulse();
  }, 60_000);
  window.addEventListener("resize", throttle(() => map.invalidateSize(), 200));

  loadState()
    .catch((err) => console.warn("ilk yükleme başarısız", err))
    .finally(connect);
})();
