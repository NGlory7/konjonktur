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
    traffic: null,
    air: null,
    marine: null,
    sources: {},
    tv: [],
    seen: new Set(),
    loadedAt: Date.now()
  };
  const ui = {
    tab: store.get("tab", "me"),
    critOnly: store.get("critOnly", false),
    showOrig: store.get("showOrig", false),
    cluster: store.get("cluster", true),
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
  const map = L.map("map", { zoomControl: true, worldCopyJump: true, attributionControl: true, minZoom: 2, preferCanvas: true });
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
    sirens: L.layerGroup().addTo(map),
    traffic: L.layerGroup().addTo(map),
    vessels: L.layerGroup().addTo(map),
    natAir: L.layerGroup(),
    natSea: L.layerGroup()
  };
  layers.national = L.layerGroup([layers.natAir, layers.natSea]).addTo(map);
  const layerCtl = L.control
    .layers(null, {
      "Haber yoğunluğu": layers.news,
      "Hava trafiği": layers.aircraft,
      "Gemi trafiği": layers.vessels,
      "Bölge ülkeleri (dünya geneli)": layers.national,
      Depremler: layers.quakes,
      "İsrail sirenleri": layers.sirens,
      "Trafik olayları": layers.traffic
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
      html: `<svg class="plane${a.emergency ? " emerg" : a.military ? "" : " civil"}" viewBox="0 0 24 24" width="${a.military ? 16 : 12}" height="${a.military ? 16 : 12}" style="transform:rotate(${rot}deg)"><path fill="currentColor" stroke="#000" stroke-width="0.6" d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.3v4.6l2.2 1.7V21L12 20l-3.5 1v-1.2l2.2-1.7v-4.6L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z"/></svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }
  // ---------------- uçuş / gemi filtreleri ----------------
  // air: all | national | military | off   ·   sea: all | national | tanker | off   ·   countries: [] = hepsi
  const flt = Object.assign({ air: "all", sea: "all", hideGround: true, countries: [] }, store.get("filters", {}));
  const countryOf = (code) => (state.countries || []).find((c) => c.code === code);

  function passAir(a) {
    if (flt.air === "off") return false;
    if (flt.hideGround && a.onGround) return false;
    if (flt.air === "national" && !a.country) return false;
    if (flt.air === "military" && !a.military) return false;
    if (flt.countries.length && !flt.countries.includes(a.country)) return false;
    return true;
  }
  function passSea(v) {
    if (flt.sea === "off") return false;
    if (flt.sea === "national" && !v.country) return false;
    if (flt.sea === "tanker" && v.cls !== "tanker") return false;
    if (flt.countries.length && !flt.countries.includes(v.country)) return false;
    return true;
  }

  const FilterCtl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const div = L.DomUtil.create("div", "flt-ctl");
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.innerHTML = `<button class="flt-toggle" type="button" title="Haritadaki uçak ve gemileri filtrele">⚲ Filtre <span id="fltBadge"></span></button>
        <div class="flt-body" hidden>
          <div class="flt-row"><b>Uçuşlar</b><div class="seg" data-k="air">
            <button data-v="all">Tümü</button><button data-v="national">Bölge ülkeleri</button><button data-v="military">Askeri</button><button data-v="off">Kapalı</button></div></div>
          <div class="flt-row"><b>Gemiler</b><div class="seg" data-k="sea">
            <button data-v="all">Tümü</button><button data-v="national">Bölge bayraklı</button><button data-v="tanker">Tanker</button><button data-v="off">Kapalı</button></div></div>
          <div class="flt-row"><b>Ülke</b><div class="flt-chips" id="fltCountries"></div></div>
          <label class="chk"><input type="checkbox" id="fltGround"> Yerdeki uçakları gizle</label>
          <div class="muted small" id="fltInfo"></div>
          <div class="muted small">Performans için yalnızca ekranda görünen alan çizilir.</div>
        </div>`;
      return div;
    }
  });
  new FilterCtl().addTo(map);

  function syncFilterUi() {
    document.querySelectorAll(".flt-ctl .seg").forEach((seg) =>
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === flt[seg.dataset.k]))
    );
    $("#fltGround").checked = flt.hideGround;
    $("#fltCountries").innerHTML = (state.countries || [])
      .map((c) => `<button type="button" data-c="${c.code}" class="${flt.countries.includes(c.code) ? "on" : ""}" title="${esc(c.name)}">${c.flag}</button>`)
      .join("");
    const active = flt.air !== "all" || flt.sea !== "all" || flt.countries.length || !flt.hideGround;
    $("#fltBadge").textContent = active ? "●" : "";
  }
  const applyFilters = () => {
    store.set("filters", flt);
    syncFilterUi();
    renderAircraftLayer();
    renderVesselLayer();
  };
  document.querySelector(".flt-ctl").addEventListener("click", (e) => {
    if (e.target.closest(".flt-toggle")) {
      const body = document.querySelector(".flt-body");
      body.hidden = !body.hidden;
      return;
    }
    const b = e.target.closest(".seg button");
    if (b) {
      flt[b.closest(".seg").dataset.k] = b.dataset.v;
      return applyFilters();
    }
    const c = e.target.closest("#fltCountries button");
    if (c) {
      const code = c.dataset.c;
      flt.countries = flt.countries.includes(code) ? flt.countries.filter((x) => x !== code) : [...flt.countries, code];
      applyFilters();
    }
  });
  $("#fltGround").addEventListener("change", (e) => {
    flt.hideGround = e.target.checked;
    applyFilters();
  });

  // ---------------- uçaklar: artımlı güncelleme, yalnızca görünür alan ----------------
  const apt = (p) => (p ? `${esc(p.iata || p.icao || "?")} ${esc(p.city || p.name || "")}` : "?");
  const routeLayer = L.layerGroup().addTo(map);
  let routeFor = null;
  const counts = { air: [0, 0], sea: [0, 0] };

  function routeText(a) {
    const r = a.route;
    if (!r) return a.callsign && !a.onGround ? `<span style="color:#7d8899">rota bilgisi aranıyor / yok</span>` : "";
    return `<b>${apt(r.from)} → ${apt(r.to)}</b>${r.airline ? ` · ${esc(r.airline)}` : ""}${
      r.plausible ? "" : `<br><span style="color:#ffb3b8">tarifeli rota — uçağın konumuyla uyuşmuyor, doğrulanamadı</span>`
    }`;
  }

  function aircraftTooltip(a) {
    const c = countryOf(a.country);
    const label = [a.callsign, a.type, a.reg].filter(Boolean).join(" · ") || a.hex;
    const alt = a.onGround ? "yerde" : a.alt != null ? `${Number(a.alt).toLocaleString("tr-TR")} ft` : "irtifa ?";
    return `${c ? `${c.flag} <b>${esc(c.name)}</b> tescilli · ` : ""}${a.military ? "★ askeri · " : ""}<b>${esc(label)}</b><br>${routeText(a)}${
      a.route || (a.callsign && !a.onGround) ? "<br>" : ""
    }${alt}${a.speed != null ? ` · ${a.speed} kt` : ""}${a.squawk ? ` · squawk ${esc(a.squawk)}` : ""}${
      a.emergency ? ` · <b style="color:#ff4d4f">ACİL: ${esc(a.emergency)}</b>` : ""
    }${a.stale ? `<br><span style="color:#7d8899">son konum ${ago(a.seenAt)} önce (${esc(a.source)})</span>` : ""}<br><span style="color:#7d8899">${
      a.route ? "tıkla: rotayı çiz · " : ""
    }globe.adsb.fi/?icao=${esc(a.hex)}</span>`;
  }

  function drawRoute(a) {
    routeLayer.clearLayers();
    if (routeFor === a.hex || !a.route) {
      routeFor = null; // ikinci tık ya da rotası bilinmeyen uçak: çizgiyi kaldır
      return;
    }
    routeFor = a.hex;
    const { from, to } = a.route;
    const color = countryOf(a.country)?.color || "#e8b04b";
    if (from?.lat != null) L.polyline([[from.lat, from.lon], [a.lat, a.lon]], { color, weight: 2, opacity: 0.9 }).addTo(routeLayer);
    if (to?.lat != null) L.polyline([[a.lat, a.lon], [to.lat, to.lon]], { color, weight: 2, opacity: 0.8, dashArray: "6 6" }).addTo(routeLayer);
    for (const [p, tag] of [[from, "kalkış"], [to, "varış"]]) {
      if (p?.lat == null) continue;
      L.circleMarker([p.lat, p.lon], { radius: 5, color, weight: 2, fillColor: "#0b0e13", fillOpacity: 1 })
        .bindTooltip(`<b>${tag}:</b> ${esc(p.name || "")} (${esc(p.iata || p.icao || "")})<br>${esc(p.city || "")}, ${esc(p.country || "")}`, {
          permanent: true,
          direction: "top",
          className: "apt-label"
        })
        .addTo(routeLayer);
    }
    const pts = [from, to].filter((p) => p?.lat != null).map((p) => [p.lat, p.lon]);
    if (pts.length) map.flyToBounds(L.latLngBounds([...pts, [a.lat, a.lon]]).pad(0.2), { duration: 0.8 });
  }

  function acIcon(a, c) {
    const base = planeIcon(a).options.html;
    return c
      ? L.divIcon({ className: "", html: `<div class="nat-ac" style="--c:${c.color}">${base}<span>${c.flag}</span></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })
      : planeIcon(a);
  }

  const acMarkers = new Map(); // hex -> { m, key, target }
  function renderAircraftLayer() {
    const view = map.getBounds().pad(0.3);
    const keep = new Set();
    let shown = 0;
    for (const a of state.aircraft) {
      if (!passAir(a) || !view.contains([a.lat, a.lon])) continue;
      keep.add(a.hex);
      shown++;
      const c = countryOf(a.country);
      const target = c ? layers.natAir : layers.aircraft;
      // İkon yalnızca rota 15°'den fazla değişince ya da durum değişince yeniden kurulur
      const key = `${Math.round((a.track ?? 0) / 15)}|${c ? c.code : ""}|${a.military ? 1 : 0}|${a.emergency ? 1 : 0}`;
      let e = acMarkers.get(a.hex);
      if (e && e.target !== target) {
        e.m.remove();
        e = null;
      }
      if (!e) {
        const m = L.marker([a.lat, a.lon], { icon: acIcon(a, c), opacity: a.stale ? 0.55 : 1 });
        m.bindTooltip(() => aircraftTooltip(m._ac), { direction: "top" }); // tembel: yalnızca üzerine gelince kurulur
        m.on("click", () => drawRoute(m._ac));
        m.addTo(target);
        e = { m, key, target };
        acMarkers.set(a.hex, e);
      } else {
        e.m.setLatLng([a.lat, a.lon]);
        if (e.key !== key) {
          e.m.setIcon(acIcon(a, c));
          e.key = key;
        }
        e.m.setOpacity(a.stale ? 0.55 : 1);
      }
      e.m._ac = a;
    }
    for (const [hex, e] of acMarkers) {
      if (!keep.has(hex)) {
        e.m.remove();
        acMarkers.delete(hex);
      }
    }
    counts.air = [shown, state.aircraft.length];
    updateFilterInfo();
  }

  function updateFilterInfo() {
    const el = $("#fltInfo");
    if (el) el.textContent = `Ekranda ✈ ${counts.air[0]} / ${counts.air[1]} · ⚓ ${counts.sea[0]} / ${counts.sea[1]}`;
  }

  // Harita kaydırılınca / yakınlaşınca yeni görünen alanı çiz
  map.on("moveend", throttle(() => {
    renderAircraftLayer();
    renderVesselLayer();
  }, 150));

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

  // Kümelenmiş haberler: aynı olayı anlatan başlıklardan yalnızca en yenisi gösterilir,
  // diğerleri "+N kaynak" çipine tıklanınca açılır.
  const expanded = new Set();
  function clusterChip(n, members) {
    if (!members || members.length < 2) return "";
    const others = members.length - 1;
    const sources = new Set(members.map((m) => m.source)).size;
    const langs = [...new Set(members.map((m) => m.lang))].join(", ");
    const open = expanded.has(n.cluster);
    return `<span class="chip cluster" data-cluster="${esc(n.cluster)}" title="Aynı olayı anlatan ${others} başlık daha (${sources} kaynak; diller: ${esc(langs)})">${open ? "▾" : "▸"} +${others} · ${sources} kaynak</span>`;
  }

  function itemHtml(n, isNew, members, child) {
    const title = n.titleTr || n.title;
    const showOrig = ui.showOrig && n.titleTr && n.titleTr !== n.title;
    const rtl = /^(ar|fa|he)$/.test(n.lang);
    const places = n.places
      .map((p) => `<span class="chip place" data-place="${esc(p.id)}" data-lat="${p.lat}" data-lon="${p.lon}">${esc(p.name)}</span>`)
      .join("");
    const topics = n.topics.slice(0, 2).map((t) => `<span class="chip topic">${esc(TOPIC_LABEL[t] || t)}</span>`).join("");
    return `<li class="s${n.severity}${isNew ? " new" : ""}${child ? " child" : ""}" data-id="${esc(n.id)}">
      <span class="bar"></span>
      <span class="time"><b>${hhmm(n.ts)}</b>${ago(n.ts)}</span>
      <div>
        <div class="title"><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(title)}</a></div>
        ${showOrig ? `<div class="orig" dir="${rtl ? "rtl" : "ltr"}">${esc(n.title)}</div>` : ""}
        <div class="meta">
          <span class="chip ${n.kind === "telegram" ? "tg" : ""}">${n.kind === "telegram" ? "TG · " : ""}${esc(n.source)}</span>
          ${n.lang !== "tr" ? `<span class="chip lang" title="Orijinal dil — otomatik çeviri">${esc(n.lang)}→tr</span>` : ""}
          ${n.dupes ? `<span class="chip dup" title="Aynı başlık başka akışlarda da geçti">+${n.dupes}</span>` : ""}
          ${child ? "" : clusterChip(n, members)}
          ${topics}${places}
        </div>
      </div>
    </li>`;
  }

  let renderedIds = new Set();
  function renderFeed() {
    const all = state.news.filter((n) => matchesTab(n) && matchesFilters(n));
    // Kümele: her kümeden yalnızca en yeni haber listede kalır (liste zaten yeniden eskiye sıralı)
    const groups = new Map();
    for (const n of all) {
      const k = n.cluster || n.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    const list = ui.cluster ? [...groups.values()].map((g) => g[0]) : all;
    const shown = list.slice(0, ui.limit);
    const isNew = (n) => renderedIds.size > 0 && !renderedIds.has(n.id) && Date.now() - n.ts < 3600_000;
    const html = shown
      .map((n) => {
        const members = ui.cluster ? groups.get(n.cluster || n.id) : null;
        let out = itemHtml(n, isNew(n), members);
        if (members && members.length > 1 && expanded.has(n.cluster)) {
          out += members.slice(1).map((m) => itemHtml(m, isNew(m), null, true)).join("");
        }
        return out;
      })
      .join("");
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
    $("#feedCount").textContent = ui.cluster && list.length !== all.length ? `${list.length} olay · ${all.length} haber` : `${all.length} haber`;

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
    const cl = e.target.closest(".chip.cluster");
    if (cl) {
      const k = cl.dataset.cluster;
      if (expanded.has(k)) expanded.delete(k);
      else expanded.add(k);
      renderFeed();
      return;
    }
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
    const mil = state.aircraft.filter((a) => a.military);
    $("#acCount").textContent = mil.length ? `(${mil.length} · toplam ${state.aircraft.length})` : "";
    const list = [...mil].sort((a, b) => (b.emergency ? 1 : 0) - (a.emergency ? 1 : 0) || (b.alt || 0) - (a.alt || 0));
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

  // ---------------- trafik ----------------
  const ptab = { cur: store.get("ptab", "pulse"), city: null };

  function setPulseTab(t) {
    ptab.cur = t;
    store.set("ptab", t);
    $$("#pulseTabs button").forEach((b) => b.classList.toggle("on", b.dataset.ptab === t));
    $("#trafficBody").hidden = t !== "traffic";
    $("#pulseBody").hidden = t !== "pulse";
    $("#airseaBody").hidden = t !== "airsea";
    if (t === "airsea") renderAirSea();
    $("#pulseHint").textContent = t === "pulse" ? "son 6 saat · haber sayısı" : (t === "traffic" ? "TomTom · aynı saat dilimine göre robust Z-skoru" : "adsb.fi + aisstream · 5 dk'da bir kayıt");
    if (t === "traffic") renderTraffic();
  }
  $$("#pulseTabs button").forEach((b) => b.addEventListener("click", () => setPulseTab(b.dataset.ptab)));

  const dur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
  };

  function zBadge(c) {
    if (c.error && !c.latest) return `<span class="zb err" title="${esc(c.error)}">hata</span>`;
    const e = c.evaluation;
    if (!e) return `<span class="zb wait">veri yok</span>`;
    if (!e.ready) return `<span class="zb wait" title="Bu saat dilimi için en az 8 geçmiş ölçüm gerekiyor">baz ${e.samples}/8</span>`;
    const z = e.metrics.jam_km.z;
    const cls = z >= 3 ? "hi" : z <= -3 ? "lo" : "ok";
    return `<span class="zb ${cls}" title="Sıkışıklık Z-skoru (normal/medyan ${e.metrics.jam_km.median} km)">z ${z > 0 ? "+" : ""}${z.toFixed(1)}</span>`;
  }

  function trafficSpark(series) {
    if (!series || series.length < 2) return "<span></span>";
    const max = Math.max(1, ...series.map((p) => p.jam_km));
    const t0 = series[0].ts;
    const span = Math.max(1, series[series.length - 1].ts - t0);
    const pts = series.map((p) => `${(((p.ts - t0) / span) * 100).toFixed(1)},${(19 - (p.jam_km / max) * 18).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 100 20" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#ffa94d" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderTrafficLayer() {
    layers.traffic.clearLayers();
    const t = state.traffic;
    if (!t) return;
    for (const c of t.cities) {
      const z = c.evaluation?.ready ? c.evaluation.metrics.jam_km.z : null;
      const color = z == null ? "#55606f" : z >= 3 ? "#ff4d4f" : z <= -3 ? "#4dabf7" : "#3ecf8e";
      const [w, so, e, n] = c.bbox;
      L.rectangle([[so, w], [n, e]], { color, weight: z != null && Math.abs(z) >= 3 ? 2 : 1, fill: false, dashArray: "4 4", interactive: false })
        .addTo(layers.traffic);
    }
    for (const i of t.incidents) {
      const closure = i.category === "yol kapalı";
      const color = closure ? "#ff2d55" : i.category === "kaza" ? "#ffd43b" : "#ffa94d";
      const tip = () =>
        `<b>${esc(i.category)}</b>${i.road ? " · " + esc(i.road) : ""}<br>${esc(i.from)}${i.to ? " → " + esc(i.to) : ""}` +
        `<br>${esc(i.description || "")}<br>ilk görülme ${hhmm(i.first_seen)} · ${dur(Date.now() - i.first_seen)}` +
        (i.delay_s ? ` · gecikme ${Math.round(i.delay_s / 60)} dk` : "");
      let layer = null;
      if (i.geometry && i.geometry.length > 1) {
        layer = L.polyline(i.geometry.map(([lon, lat]) => [lat, lon]), { color, weight: closure ? 4 : 3, opacity: 0.9 });
      } else if (i.lat != null) {
        layer = L.circleMarker([i.lat, i.lon], { radius: 4, color, weight: 2, fillOpacity: 0.7 });
      }
      if (layer) layer.bindTooltip(tip, { direction: "top" }).addTo(layers.traffic);
    }
  }

  function renderTraffic() {
    const t = state.traffic;
    if (!t) return;
    updateAnomalyBadges();
    renderTrafficLayer();
    if (ptab.cur !== "traffic") return;

    if (!t.enabled) {
      $("#trafficCities").innerHTML = `<div class="traffic-off">Trafik analizi için ücretsiz bir <b>TomTom</b> anahtarı gerekiyor.<br>
        1. <code>developer.tomtom.com</code> adresinde hesap aç ve bir API anahtarı oluştur.<br>
        2. Proje klasöründeki <code>.env</code> dosyasına <code>TOMTOM_KEY=anahtarın</code> yaz.<br>
        3. Sunucuyu yeniden başlat. Ölçüm 15 dakikada bir alınır; her saat dilimi için baz çizgisi 8 ölçümden sonra hazır olur.</div>`;
      $("#anomalyList").innerHTML = "";
      $("#closureList").innerHTML = "";
      return;
    }

    const M = t.metrics;
    $("#trafficCities").innerHTML = t.cities
      .map((c) => {
        const l = c.latest;
        return `<div class="tcity${ptab.city === c.id ? " sel" : ""}" data-city="${c.id}" title="Son ölçüm: ${c.lastPoll ? hhmm(c.lastPoll) : "—"} · toplam ${c.totalSamples} ölçüm${c.error ? " · HATA: " + esc(c.error) : ""}">
          <span class="nm">${esc(c.name)}</span>
          ${zBadge(c)}
          ${trafficSpark(c.series)}
          <span class="val">${l ? `${l.jam_km.toFixed(1)}<small> km</small>` : "—"}${l && l.closures ? ` <small style="color:#ff6b81">✕${l.closures}</small>` : ""}</span>
        </div>`;
      })
      .join("");

    const cityName = Object.fromEntries(t.cities.map((c) => [c.id, c.name]));
    void M;
    renderAnomalies($("#anomalyList"), ["traffic"], t.cities.some((c) => c.evaluation?.ready));

    const closures = t.incidents.filter((i) => i.category === "yol kapalı").sort((a, b) => b.first_seen - a.first_seen);
    $("#closureCount").textContent = closures.length ? `(${closures.length})` : "";
    $("#closureList").innerHTML =
      closures
        .slice(0, 12)
        .map(
          (i) =>
            `<li data-lat="${i.lat}" data-lon="${i.lon}" title="${esc(i.description || "")}"><span class="t">${hhmm(i.first_seen)}</span>${esc(
              cityName[i.city] || i.city
            )} · ${esc(i.road || i.from || "yol")}${i.to ? " → " + esc(i.to) : ""} · ${dur(Date.now() - i.first_seen)}</li>`
        )
        .join("") || `<li class="none">Aktif kapanma yok</li>`;

    renderCityNews();
  }

  // Seçili şehirle ilgili son haberler — aynı zaman aralığında ne olduğunu görmek için
  function renderCityNews() {
    const el = $("#cityNews");
    const c = state.traffic?.cities.find((x) => x.id === ptab.city);
    if (!c) {
      el.innerHTML = "";
      return;
    }
    const items = state.news.filter((n) => n.places.some((p) => p.id === c.id) && Date.now() - n.ts < 12 * 3600_000).slice(0, 8);
    el.innerHTML = `<div class="mini-title">${esc(c.name)} · son 12 saatteki haberler</div><ul class="news-mini">${
      items
        .map((n) => `<li><span class="muted">${hhmm(n.ts)}</span> <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.titleTr || n.title)}</a></li>`)
        .join("") || '<li class="muted">Bu şehirle eşleşen haber yok</li>'
    }</ul>`;
  }

  function selectCity(id) {
    ptab.city = id;
    const c = state.traffic?.cities.find((x) => x.id === id);
    if (c) map.flyToBounds([[c.bbox[1], c.bbox[0]], [c.bbox[3], c.bbox[2]]], { duration: 0.8 });
    renderTraffic();
  }
  $("#trafficCities").addEventListener("click", (e) => {
    const row = e.target.closest(".tcity");
    if (row) selectCity(ptab.city === row.dataset.city ? null : row.dataset.city);
  });
  $("#anomalyList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-city]");
    if (li) selectCity(li.dataset.city);
  });
  $("#closureList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-lat]");
    if (!li || li.dataset.lat === "null") return;
    map.flyTo([+li.dataset.lat, +li.dataset.lon], 13, { duration: 0.8 });
    focusPlace({ lat: +li.dataset.lat, lon: +li.dataset.lon });
  });

  // ---------------- anomali listesi (trafik / hava / deniz) ----------------
  function renderAnomalies(el, domains, anyReady) {
    const list = (state.traffic?.anomalies || []).filter((a) => domains.includes(a.domain));
    el.innerHTML =
      list
        .slice(0, 14)
        .map((a) => {
          const dir = a.peak_z > 0 ? "▲" : "▼";
          const icon = a.domain === "air" ? "✈ " : a.domain === "sea" ? "⚓ " : "";
          const when = new Date(a.started_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
          return `<li class="${a.active ? "hot" : ""}" data-domain="${a.domain}" data-zone="${esc(a.zone)}" title="Tepe z=${a.peak_z} · normal (medyan) ${a.baseline_median}${a.unit}">
            <span class="t">${when} ${hhmm(a.started_at)}</span>${icon}${dir} ${esc(a.name)} · ${esc(a.label)} ${a.peak_value}${a.unit} (normal ${a.baseline_median}) · ${
              a.active ? "sürüyor " + dur(Date.now() - a.started_at) : dur(a.ended_at - a.started_at)
            }</li>`;
        })
        .join("") || `<li class="none">Henüz anomali yok${anyReady ? "" : " (baz çizgileri oluşuyor)"}</li>`;
  }

  function updateAnomalyBadges() {
    const act = (state.traffic?.anomalies || []).filter((a) => a.active);
    const set = (id, n) => {
      const b = $(id);
      b.hidden = !n;
      b.textContent = n;
    };
    set("#trafficBadge", act.filter((a) => a.domain === "traffic").length);
    set("#airseaBadge", act.filter((a) => a.domain !== "traffic").length);
  }

  // ---------------- gemiler ----------------
  const SHIP_COLOR = { tanker: "#ff8787", kargo: "#74c0fc", askeri: "#8ce99a", yolcu: "#ffd43b", balıkçı: "#c0a7ff", römorkör: "#e599f7" };
  function vesselHtml(v, c) {
    const color = SHIP_COLOR[v.cls] || "#adb5bd";
    const moving = (v.sog || 0) > 1;
    const rot = v.heading ?? v.cog ?? 0;
    const html = moving
      ? `<svg viewBox="0 0 12 12" width="11" height="11" style="transform:rotate(${rot}deg)"><path d="M6 0 L11 11 L6 8 L1 11 Z" fill="${color}" stroke="#000" stroke-width="0.6"/></svg>`
      : `<svg viewBox="0 0 10 10" width="8" height="8"><circle cx="5" cy="5" r="4" fill="${color}" stroke="#000" stroke-width="0.8"/></svg>`;
    return c ? `<div class="nat-ship" style="--c:${c.color}">${html}<span>${c.flag}</span></div>` : html;
  }
  function vesselTooltip(v) {
    const c = countryOf(v.country);
    return `${c ? `${c.flag} <b>${esc(c.name)}</b> bayraklı · ` : ""}<b>${esc(v.name || "MMSI " + v.mmsi)}</b> · ${esc(v.cls)}${v.length ? ` · ${v.length} m` : ""}<br>${
      v.sog != null ? `${v.sog.toFixed(1)} kn` : "hız ?"
    }${v.destination ? ` → ${esc(v.destination)}` : ""}<br><span style="color:#7d8899">son konum ${hhmm(v.seen)} · MMSI ${v.mmsi}</span>`;
  }

  const vsMarkers = new Map(); // mmsi -> { m, key, target }
  function renderVesselLayer() {
    const list = state.marine?.vessels || [];
    const view = map.getBounds().pad(0.3);
    const keep = new Set();
    let shown = 0;
    for (const v of list) {
      if (!passSea(v) || !view.contains([v.lat, v.lon])) continue;
      keep.add(v.mmsi);
      shown++;
      const c = countryOf(v.country);
      const target = c ? layers.natSea : layers.vessels;
      const key = `${v.cls}|${(v.sog || 0) > 1 ? Math.round((v.heading ?? v.cog ?? 0) / 15) : "s"}|${c ? c.code : ""}`;
      let e = vsMarkers.get(v.mmsi);
      if (e && e.target !== target) {
        e.m.remove();
        e = null;
      }
      const icon = () => L.divIcon({ className: "", html: vesselHtml(v, c), iconSize: [11, 11], iconAnchor: [5, 5] });
      if (!e) {
        const m = L.marker([v.lat, v.lon], { icon: icon() });
        m.bindTooltip(() => vesselTooltip(m._v), { direction: "top" });
        m.on("click", () => window.open(`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${encodeURIComponent(m._v.mmsi)}`, "_blank", "noopener"));
        m.addTo(target);
        e = { m, key, target };
        vsMarkers.set(v.mmsi, e);
      } else {
        e.m.setLatLng([v.lat, v.lon]);
        if (e.key !== key) {
          e.m.setIcon(icon());
          e.key = key;
        }
      }
      e.m._v = v;
    }
    for (const [k, e] of vsMarkers) {
      if (!keep.has(k)) {
        e.m.remove();
        vsMarkers.delete(k);
      }
    }
    counts.sea = [shown, list.length];
    updateFilterInfo();
  }

  // ---------------- Hava & Deniz paneli ----------------
  function zoneBadge(z, metric) {
    const e = z.evaluation;
    if (!e) return `<span class="zb wait">veri yok</span>`;
    if (!e.ready) return `<span class="zb wait" title="Bu saat dilimi için en az 8 geçmiş ölçüm gerekiyor">baz ${e.samples}/8</span>`;
    const zz = e.metrics[metric].z;
    const cls = zz >= 3 ? "hi" : zz <= -3 ? "lo" : "ok";
    return `<span class="zb ${cls}" title="Z-skoru (normal/medyan ${e.metrics[metric].median})">z ${zz > 0 ? "+" : ""}${zz.toFixed(1)}</span>`;
  }
  function zoneSpark(series, metric, color) {
    if (!series || series.length < 2) return "<span></span>";
    const max = Math.max(1, ...series.map((p) => p[metric] || 0));
    const t0 = series[0].ts;
    const span = Math.max(1, series[series.length - 1].ts - t0);
    const pts = series.map((p) => `${(((p.ts - t0) / span) * 100).toFixed(1)},${(19 - ((p[metric] || 0) / max) * 18).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 100 20" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderAirSea() {
    renderVesselLayer();
    updateAnomalyBadges();
    if (ptab.cur !== "airsea") return;

    const live = {};
    for (const a of state.aircraft) if (a.zone && !a.onGround) live[a.zone] = (live[a.zone] || 0) + 1;
    const airRows = (state.air?.zones || [])
      .map((z) => {
        const l = z.latest;
        const noCover = z.totalSamples > 0 && z.series.every((p) => !p.airborne);
        return `<div class="tcity" data-lat="${z.lat}" data-lon="${z.lon}" title="Son kayıt: ${l ? hhmm(l.ts) : "—"} · ${z.totalSamples} kayıt${noCover ? " · Bu bölgede ADS-B alıcısı yok ya da hava sahası boş" : ""}">
          <span class="nm">✈ ${esc(z.name)}</span>${zoneBadge(z, "airborne")}${zoneSpark(z.series, "airborne", "#8ce99a")}
          <span class="val">${live[z.id] ?? 0}${l && l.military ? ` <small style="color:#8ce99a">★${l.military}</small>` : ""}${noCover ? ` <small>kapsam yok</small>` : ""}</span></div>`;
      })
      .join("");

    const m = state.marine;
    let seaRows;
    if (!m || !m.enabled) {
      seaRows = `<div class="traffic-off">Gemi trafiği için ücretsiz bir <b>aisstream.io</b> anahtarı gerekiyor:
        <code>aisstream.io</code> → GitHub ile giriş → API Keys. Anahtarı <code>.env</code> dosyasına <code>AISSTREAM_KEY=...</code> olarak yaz ve sunucuyu yeniden başlat.</div>`;
    } else {
      const liveSea = {};
      for (const v of m.vessels) if (v.zone) liveSea[v.zone] = (liveSea[v.zone] || 0) + 1;
      seaRows =
        (m.status.connected ? "" : `<div class="traffic-off">AIS bağlantısı yok: ${esc(m.status.error || "bağlanıyor…")}</div>`) +
        m.zones
          .map((z) => {
            const l = z.latest;
            const [[s, w], [n, e]] = z.bbox;
            return `<div class="tcity" data-lat="${(s + n) / 2}" data-lon="${(w + e) / 2}" title="Son kayıt: ${l ? hhmm(l.ts) : "—"} · ${z.totalSamples} kayıt · tanker ${l?.tankers ?? "—"}, kargo ${l?.cargo ?? "—"}">
            <span class="nm">⚓ ${esc(z.name)}</span>${zoneBadge(z, "vessels")}${zoneSpark(z.series, "vessels", "#74c0fc")}
            <span class="val">${liveSea[z.id] ?? 0}${l && l.tankers ? ` <small style="color:#ff8787">T${l.tankers}</small>` : ""}</span></div>`;
          })
          .join("");
    }
    const natRows = (state.countries || [])
      .map((c) => {
        const ac = state.aircraft.filter((a) => a.country === c.code && !a.onGround);
        const sh = (state.marine?.vessels || []).filter((v) => v.country === c.code);
        const away = ac.filter((a) => !a.zone).length;
        return `<div class="tcity nat-row" data-country="${c.code}" title="Dünya genelinde havadaki ${c.name} tescilli uçak: ${ac.length} (bölge dışında ${away}) · ${c.name} bayraklı gemi: ${sh.length}">
          <span class="nm">${c.flag} ${esc(c.name)}</span><span class="zb" style="background:transparent;color:${c.color}">●</span>
          <span class="muted small">✈ ${ac.length}${away ? ` (${away} dışarıda)` : ""}</span><span class="val">⚓ ${state.marine?.enabled ? sh.length : "—"}</span></div>`;
      })
      .join("");
    $("#airseaZones").innerHTML = `<div class="mini-title">Bölge ülkeleri · dünya geneli (tescil / bayrak)</div>${natRows}<div class="mini-title">Hava sahası · anlık uçak (★ askeri)</div>${airRows}<div class="mini-title">Deniz · anlık gemi (T tanker)</div>${seaRows}`;
    renderAnomalies($("#airseaAnomalies"), ["air", "sea"], (state.air?.zones || []).some((z) => z.evaluation?.ready));
  }

  $("#airseaZones").addEventListener("click", (e) => {
    const nat = e.target.closest(".nat-row");
    if (nat) {
      const pts = [...state.aircraft, ...(state.marine?.vessels || [])].filter((x) => x.country === nat.dataset.country).map((x) => [x.lat, x.lon]);
      if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.1), { duration: 0.8, maxZoom: 7 });
      return;
    }
    const row = e.target.closest(".tcity[data-lat]");
    if (row) map.flyTo([+row.dataset.lat, +row.dataset.lon], 7, { duration: 0.8 });
  });

  // ---------------- veri ----------------
  const renderAll = throttle(() => {
    renderFeed();
    renderNewsLayer();
    renderPulse();
    renderFlash();
  }, 300);

  function notifyEvents(events) {
    for (const ev of events || []) {
      if (ev.kind !== "anomaly") continue;
      const what = ev.domain === "air" ? "Hava trafiği" : ev.domain === "sea" ? "Deniz trafiği" : "Trafik";
      beep("news");
      notify(`${what} anomalisi · ${ev.city}`, `${ev.metric}: ${ev.value} (normal ${ev.median}), z=${ev.z}`);
    }
  }

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
        if (u.air) state.air = u.air;
        if (u.anomalies && state.traffic) state.traffic.anomalies = u.anomalies;
        if (u.sources) state.sources = u.sources;
        notifyEvents(u.events);
        renderAircraftLayer();
        renderAircraftList();
        renderAirSea();
        break;
      case "marine":
        state.marine = u.marine;
        if (u.anomalies && state.traffic) state.traffic.anomalies = u.anomalies;
        if (u.sources) state.sources = u.sources;
        notifyEvents(u.events);
        renderAirSea();
        renderSources();
        break;
      case "vessels":
        if (state.marine) {
          state.marine.vessels = u.vessels;
          state.marine.status = u.status;
        }
        renderAirSea();
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
      case "traffic": {
        state.traffic = u.traffic;
        if (u.sources) state.sources = u.sources;
        notifyEvents(u.events);
        renderTraffic();
        renderSources();
        break;
      }
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
    state.traffic = s.traffic;
    state.air = s.air;
    state.marine = s.marine;
    state.countries = s.countries;
    syncFilterUi();
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
    setPulseTab(ptab.cur);
    renderAirSea();
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
  const clusterEl = $("#clusterNews");
  clusterEl.checked = ui.cluster;
  clusterEl.addEventListener("change", () => {
    ui.cluster = clusterEl.checked;
    store.set("cluster", ui.cluster);
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
