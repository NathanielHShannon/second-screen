/* Second Screen · application
   View mode is the dashboard, clean. Edit mode adds a dock, an inspector and
   direct manipulation on the canvas. All layout coordinates are in "board"
   space (the design canvas); handles and outlines are drawn in screen space. */
(function (SS) {
  "use strict";
  const G = SS.geo, store = SS.store, media = SS.media, icon = SS.icon;
  const T = SS.widgets.types;
  const $ = (s, r) => (r || document).querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const params = new URLSearchParams(location.search);

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function sv(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  const ptsAttr = (pts) => pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    if (t.tagName === "INPUT") return !/^(range|color|checkbox|radio|button|file|submit)$/i.test(t.type);
    return t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
  }
  document.querySelectorAll("[data-icon]").forEach(el => { el.outerHTML = icon(el.dataset.icon); });

  const stage = $("#stage"), backdrop = $("#backdrop"), spill = $("#spill");
  const widgetsLayer = $("#widgets"), screensLayer = $("#screens"), surfSvg = $("#surfaces");
  const overlay = $("#overlay"), handlesLayer = $("#handles"), ins = $("#inspector");

  let state = null, editing = false, tool = null, drag = null, clipboard = [], pop = null;
  const sel = { kind: null, ids: new Set() };
  const wRec = new Map();   // widget id -> { el, body, inst, bw, bh, H }
  const sRec = new Map();   // screen id -> { el, hit, empty, mediaEl, key, bw, bh }
  const theme = () => SS.THEMES[state.theme] || SS.THEMES.midnight;
  const byId = (id) => state.widgets.find(w => w.id === id);
  const surfaceById = (id) => state.surfaces.find(s => s.id === id);
  const screenById = (id) => state.screens.find(s => s.id === id);
  const save = () => store.save(state);
  const insOpen = () => editing && !document.body.classList.contains("ins-closed");

  /* ======================= colour helpers ======================= */
  function alpha(c, a) { return /^#[0-9a-f]{3,8}$/i.test(c) ? SS.scenes.rgba(c.slice(0, 7), a) : c; }
  function ink(c) {
    if (!/^#[0-9a-f]{6}/i.test(c)) return "#0b0d1a";
    const L = SS.scenes.rgb(c.slice(0, 7)).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return (0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]) > 0.32 ? "#0b0d1a" : "#ffffff";
  }

  /* ======================= viewport ======================= */
  const V = { k: 1, ox: 0, oy: 0 };
  function layoutViewport() {
    const c = state.canvas, W = window.innerWidth, H = window.innerHeight;
    // while editing, the canvas makes room for the inspector instead of hiding under it
    const side = insOpen() && W > 760 ? 328 : 0;
    const AW = W - side;
    const k = (c.fit === "fill" && !editing) ? Math.max(W / c.w, H / c.h) : Math.min(AW / c.w, H / c.h);
    V.k = k; V.ox = (AW - c.w * k) / 2; V.oy = (H - c.h * k) / 2;
    stage.style.width = c.w + "px"; stage.style.height = c.h + "px";
    stage.style.transform = "translate(" + V.ox + "px," + V.oy + "px) scale(" + k + ")";
    surfSvg.setAttribute("viewBox", "0 0 " + c.w + " " + c.h);
    scheduleSceneRes();
    positionBackdrop();
    drawOverlay();
  }
  const toBoard = (cx, cy) => [(cx - V.ox) / V.k, (cy - V.oy) / V.k];
  const toScreen = (p) => [p[0] * V.k + V.ox, p[1] * V.k + V.oy];

  /* ======================= theme ======================= */
  function themeVars(el, t, style) {
    const r = el.style;
    r.setProperty("--t-text", t.text); r.setProperty("--t-accent", t.accent);
    r.setProperty("--surf", t.surf); r.setProperty("--solid", t.solid); r.setProperty("--border", t.border);
    r.setProperty("--wf", (SS.FONTS[t.font] || SS.FONTS.sans).css);
    r.setProperty("--glass", style.glass); r.setProperty("--blur", style.blur + "px"); r.setProperty("--radius", style.radius + "px");
  }
  function applyTheme() {
    themeVars(document.documentElement, theme(), state.style);
    document.body.classList.toggle("legible", !!state.style.legible);
    document.body.classList.toggle("light-theme", !!theme().light);
  }

  /* ======================= backdrop ======================= */
  let bdKey = "", sceneCanvas = null, sceneRes = 0, resTimer = 0;
  const sceneId = () => state.backdrop.scene || theme().scene;
  function sceneScale() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), c = state.canvas;
    return clamp(V.k * dpr, 0.25, Math.min(4096 / c.w, 4096 / c.h));
  }
  function renderBackdrop(force) {
    const b = state.backdrop, t = theme(), c = state.canvas;
    document.body.style.background = t.base;
    const key = JSON.stringify([b.kind, b.kind === "scene" ? sceneId() + state.theme : "", b.src, b.url, b.muted, c.w, c.h]);
    if (!force && key === bdKey) { positionBackdrop(); return; }
    bdKey = key;
    backdrop.textContent = ""; sceneCanvas = null;
    spill.style.backgroundImage = "none"; spill.style.backgroundColor = t.base;
    if (b.kind === "image" && b.src) {
      const d = backdrop.appendChild(h("div", "bd-image"));
      const set = (u) => { d.style.backgroundImage = 'url("' + u + '")'; spill.style.backgroundImage = d.style.backgroundImage; };
      if (media.isRef(b.src)) {
        const u = media.url(b.src);
        if (u) set(u); else media.load(b.src).then(x => { if (x) set(x); else toast("Your background image is no longer stored here. Choose it again in the Scene panel."); });
      } else set(b.src);
    } else if (b.kind === "video" && b.url) {
      const d = backdrop.appendChild(h("div", "bd-video"));
      const f = document.createElement("iframe");
      f.src = store.youtubeEmbed(b.url, { controls: false, muted: b.muted !== false });
      f.allow = "autoplay; encrypted-media; picture-in-picture";
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.title = "Background video"; f.tabIndex = -1;
      d.appendChild(f);
    } else {
      sceneCanvas = backdrop.appendChild(document.createElement("canvas"));
      paintScene();
    }
    positionBackdrop();
  }
  function paintScene() {
    if (!sceneCanvas) return;
    const c = state.canvas, s = sceneScale();
    sceneRes = s;
    sceneCanvas.width = Math.round(c.w * s); sceneCanvas.height = Math.round(c.h * s);
    SS.scenes.draw(sceneId(), sceneCanvas, sceneCanvas.width, sceneCanvas.height, theme());
    try {
      const sm = document.createElement("canvas");
      sm.width = 48; sm.height = Math.max(8, Math.round(48 * c.h / c.w));
      sm.getContext("2d").drawImage(sceneCanvas, 0, 0, sm.width, sm.height);
      spill.style.backgroundImage = "url(" + sm.toDataURL() + ")";
    } catch (e) { /* tainted or unavailable: keep the flat colour */ }
  }
  function scheduleSceneRes() {
    if (!sceneCanvas) return;
    clearTimeout(resTimer);
    resTimer = setTimeout(() => {
      if (sceneCanvas && Math.abs(sceneScale() - sceneRes) / sceneRes > 0.2) paintScene();
    }, 300);
  }
  function positionBackdrop() {
    if (!state) return;
    const b = state.backdrop, c = state.canvas;
    const img = backdrop.querySelector(".bd-image");
    if (img) img.style.backgroundPosition = (b.x == null ? 50 : b.x) + "% " + (b.y == null ? 50 : b.y) + "%";
    const f = backdrop.querySelector(".bd-video iframe");
    if (f) {
      const ar = 16 / 9;
      let w = c.w, hh = c.w / ar;
      if (b.fit === "contain" ? hh > c.h : hh < c.h) { hh = c.h; w = c.h * ar; }
      const px = (b.x == null ? 50 : b.x) / 100, py = (b.y == null ? 50 : b.y) / 100;
      f.style.width = w + "px"; f.style.height = hh + "px";
      f.style.left = (c.w - w) * px + "px"; f.style.top = (c.h - hh) * py + "px";
    }
  }

  /* ======================= widgets ======================= */
  const LOOK = ["p-glass", "p-solid", "p-none", "b-soft", "b-screen", "b-overlay", "b-multiply", "al-center", "al-right"];
  function glowLevel(w, t) { return w.glow === false ? 0 : w.glow === true ? Math.max(0.6, t.glow) : t.glow; }
  function applyLook(el, w, t) {
    t = t || theme();
    el.style.fontSize = (16 * w.fs).toFixed(3) + "px";
    el.style.fontFamily = w.font && SS.FONTS[w.font] ? SS.FONTS[w.font].css : "";
    el.style.fontWeight = w.bold ? "600" : "";
    el.style.fontStyle = w.italic ? "italic" : "";
    const text = w.color || t.text, acc = w.accent || t.accent, gc = w.color || t.glowColor || text;
    el.style.setProperty("--wc", text);
    el.style.setProperty("--wa", acc);
    el.style.setProperty("--ink", ink(acc));
    const g = glowLevel(w, t);
    el.style.setProperty("--gs", g > 0 ? "0 0 " + (0.2 + 0.4 * g).toFixed(2) + "em " + alpha(gc, (0.25 + 0.5 * g).toFixed(2)) : "none");
    el.style.setProperty("--gs2", g > 0 ? "0 0 " + (0.3 + 0.5 * g).toFixed(2) + "em " + alpha(acc, (0.3 + 0.5 * g).toFixed(2)) : "none");
    LOOK.forEach(c => el.classList.remove(c));
    el.classList.add("p-" + (w.panel || "glass"));
    if (w.blend && w.blend !== "normal") el.classList.add("b-" + w.blend);
    if (w.align === "center" || w.align === "right") el.classList.add("al-" + w.align);
  }

  function surfaceQuad(w, bw, bh, surfaces) {
    const s = surfaces.find(x => x.id === w.surface.id);
    if (!s) return null;
    const sp = w.surface;
    const c0 = clamp(Math.min(sp.c0, sp.c1), 0, s.cols - 1), c1 = clamp(Math.max(sp.c0, sp.c1), 0, s.cols - 1);
    const r0 = clamp(Math.min(sp.r0, sp.r1), 0, s.rows - 1), r1 = clamp(Math.max(sp.r0, sp.r1), 0, s.rows - 1);
    const gu = (s.gap || 0) / s.cols / 2, gv = (s.gap || 0) / s.rows / 2;
    let u0 = c0 / s.cols + gu, u1 = (c1 + 1) / s.cols - gu, v0 = r0 / s.rows + gv, v1 = (r1 + 1) / s.rows - gv;
    if (s.fit !== "fill" && bw > 0 && bh > 0) {
      const d = G.quadDims(G.uvRect(s.quad, u0, u1, v0, v1)), a = bw / bh;
      if (d.w / d.h > a) { const du = (u1 - u0) * (1 - (d.h * a) / d.w) / 2; u0 += du; u1 -= du; }
      else { const dv = (v1 - v0) * (1 - (d.w / a) / d.h) / 2; v0 += dv; v1 -= dv; }
    }
    return G.uvRect(s.quad, u0, u1, v0, v1);
  }

  // measure, resolve any pending anchors, and apply the transform
  function layoutWidget(w, el, surfaces, t) {
    let bw = el.offsetWidth, bh = el.offsetHeight;
    if (w.anchor && bw > 0) {
      const a = w.anchor, Hp = G.rectToQuad(1, 1, a.plane);
      const target = G.dist(G.apply(Hp, a.u0, a.v0), G.apply(Hp, a.u0 + a.uw, a.v0));
      if (target > 0) { w.fs = clamp(w.fs * target / bw, 0.25, 16); applyLook(el, w, t); bw = el.offsetWidth; bh = el.offsetHeight; }
      let uw = a.uw, vh = uw * a.ratio * (bh / bw);
      const vmax = a.vmax || 0.94;
      if (a.v0 + vh > vmax) { uw *= (vmax - a.v0) / vh; vh = vmax - a.v0; }   // keep it on its wall
      w.pin = G.uvRect(a.plane, a.u0, a.u0 + uw, a.v0, a.v0 + vh);
      w.pinBase = [bw, bh];
      const bb = G.bbox(w.pin); w.x = bb.x; w.y = bb.y;
      delete w.anchor;
    }
    if (w.place && bw > 0) {
      const p = w.place;
      w.x = p.x - (p.ax || 0) * bw; w.y = p.y - (p.ay || 0) * bh;
      delete w.place;
    }
    let q = null, base = [bw, bh];
    if (w.surface) { q = surfaceQuad(w, bw, bh, surfaces); if (!q) delete w.surface; }
    if (!q && w.pin) { q = w.pin; if (w.pinBase) base = w.pinBase; else w.pinBase = [bw, bh]; }
    let H = null;
    if (q && base[0] > 0 && base[1] > 0 && G.isConvex(q)) {
      H = G.rectToQuad(base[0], base[1], q);
      el.style.transform = G.matrix3d(H);
    } else {
      el.style.transform = "translate(" + (+w.x || 0).toFixed(2) + "px," + (+w.y || 0).toFixed(2) + "px)";
    }
    return { bw, bh, H };
  }
  function place(w) {
    const r = wRec.get(w.id);
    if (!r) return;
    const pending = !!(w.anchor || w.place);
    const L = layoutWidget(w, r.el, state.surfaces);
    r.bw = L.bw; r.bh = L.bh; r.H = L.H;
    if (pending && !(w.anchor || w.place)) save();
  }
  const placeQ = new Set();
  let placeRaf = 0;
  function requestPlace(id) {
    placeQ.add(id);
    if (placeRaf) return;
    placeRaf = requestAnimationFrame(() => {
      placeRaf = 0;
      const ids = Array.from(placeQ); placeQ.clear();
      ids.forEach(i => { const w = byId(i); if (w) place(w); });
      if (editing) drawOverlay();
    });
  }
  function placeAll() { state.widgets.forEach(place); if (editing) drawOverlay(); }

  function quadOf(w) {
    const r = wRec.get(w.id);
    if (!r) return G.rectQuad(w.x || 0, w.y || 0, 40, 20);
    if (r.H) return [[0, 0], [r.bw, 0], [0, r.bh], [r.bw, r.bh]].map(p => G.apply(r.H, p[0], p[1]));
    return G.rectQuad(w.x, w.y, r.bw, r.bh);
  }
  const centerOf = (w) => G.centroid(quadOf(w));

  function makeShell(w, t) {
    const el = h("div", "widget");
    el.dataset.id = w.id; el.dataset.type = w.type;
    const body = el.appendChild(h("div", "w-body"));
    applyLook(el, w, t);
    return { el, body };
  }
  function renderInto(w, body, preview) {
    const def = T[w.type];
    const ctx = { w, root: body, preview,
                  save: preview ? () => {} : save,
                  relayout: preview ? () => {} : () => requestPlace(w.id) };
    try { return def.render(ctx) || {}; }
    catch (err) {
      console.error("widget", w.type, err);
      body.textContent = "This widget hit a snag.";
      return {};
    }
  }
  function buildWidget(w) {
    const old = wRec.get(w.id);
    const { el, body } = makeShell(w);
    if (old && old.el.parentNode === widgetsLayer) {
      widgetsLayer.replaceChild(el, old.el);
      try { old.inst && old.inst.destroy && old.inst.destroy(); } catch (e) { /* ignore */ }
    } else widgetsLayer.appendChild(el);
    const r = { el, body, inst: {}, bw: 0, bh: 0, H: null };
    wRec.set(w.id, r);
    r.inst = renderInto(w, body, false);
    place(w);
    return r;
  }
  function dropRec(id) {
    const r = wRec.get(id);
    if (!r) return;
    try { r.inst && r.inst.destroy && r.inst.destroy(); } catch (e) { /* ignore */ }
    r.el.remove(); wRec.delete(id);
  }
  function renderWidgets() {
    Array.from(wRec.keys()).forEach(dropRec);
    widgetsLayer.textContent = "";
    state.widgets.forEach(buildWidget);
  }
  function reorderDOM() {
    state.widgets.forEach(w => { const r = wRec.get(w.id); if (r) widgetsLayer.appendChild(r.el); });
  }
  // re-render content after an option change
  function rebuild(w) { buildWidget(w); drawOverlay(); save(); }
  // restyle; by default keep a pinned widget's on-screen quad
  function restyle(w, growInPlane) {
    const r = wRec.get(w.id);
    if (!r) return;
    const keep = (w.pin && !w.surface && !growInPlane) ? quadOf(w) : null;
    applyLook(r.el, w);
    if (keep) { w.pin = keep; w.pinBase = [r.el.offsetWidth, r.el.offsetHeight]; }
    place(w); drawOverlay(); save();
  }

  /* ======================= screens ======================= */
  function screenKey(s) {
    const src = s.src || {};
    if (src.kind === "youtube") { const u = store.youtubeEmbed(src.url, { controls: s.controls, muted: s.muted !== false }); return u ? "yt|" + u : "none"; }
    if (src.kind === "video") return src.url ? "v|" + src.url + "|" + !!s.controls + "|" + (s.muted !== false) : "none";
    if (src.kind === "image") return src.url ? "i|" + src.url : "none";
    if (src.kind === "file") return "f|" + src.ref + "|" + !!s.controls + "|" + (s.muted !== false) + "|" + (media.url(src.ref) ? 1 : 0);
    if (src.kind === "missing") return "m|" + src.name;
    return "none";
  }
  function makeVideo(u, s, r) {
    const v = document.createElement("video");
    v.src = u; v.loop = true; v.playsInline = true; v.autoplay = true;
    v.controls = !!s.controls;
    v.muted = s.muted !== false; v.defaultMuted = v.muted;
    if (v.muted) v.setAttribute("muted", "");
    v.setAttribute("playsinline", ""); v.setAttribute("loop", ""); v.setAttribute("autoplay", "");
    const tryPlay = () => {
      const p = v.play();
      if (p && p.catch) p.catch(() => {
        if (!v.muted) { v.muted = true; tryPlay(); return; }
        if (r.tap) return;
        r.tap = h("button", "sc-tap"); r.tap.type = "button";
        r.tap.innerHTML = "<span>" + icon("play") + "</span>";
        r.tap.setAttribute("aria-label", "Play video");
        r.tap.addEventListener("click", (e) => { e.stopPropagation(); v.play().then(() => { if (r.tap) { r.tap.remove(); r.tap = null; } }).catch(() => {}); });
        r.el.insertBefore(r.tap, r.hit);
      });
    };
    v.addEventListener("playing", () => { if (r.tap) { r.tap.remove(); r.tap = null; } });
    v.addEventListener("error", () => screenNote(r, v.error && v.error.code === 4 ? "This browser can't play that format. MP4 (H.264) is safest." : "This video couldn't be loaded."));
    v.addEventListener("click", () => { if (!editing && !v.controls) { if (v.paused) v.play(); else v.pause(); } });
    tryPlay();
    return v;
  }
  function screenNote(r, text) {
    if (r.note) { r.note.remove(); r.note = null; }
    if (!text) return;
    r.note = h("div", "sc-note", text);
    r.el.insertBefore(r.note, r.hit);
  }
  function buildScreenMedia(s, r) {
    if (r.mediaEl) { r.mediaEl.remove(); r.mediaEl = null; }
    if (r.tap) { r.tap.remove(); r.tap = null; }
    screenNote(r, "");
    const src = s.src || {};
    let m = null;
    if (src.kind === "youtube") {
      const u = store.youtubeEmbed(src.url, { controls: s.controls, muted: s.muted !== false });
      if (u) {
        m = h("div", "sc-media"); m.dataset.aspect = String(16 / 9);
        const f = document.createElement("iframe");
        f.src = u; f.title = "Video";
        f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        f.referrerPolicy = "strict-origin-when-cross-origin";
        f.setAttribute("allowfullscreen", "");
        m.appendChild(f);
      }
    } else if (src.kind === "video" || src.kind === "image" || src.kind === "file") {
      let u = src.kind === "file" ? media.url(src.ref) : src.url;
      if (!u && src.kind === "file") {
        media.load(src.ref).then(x => {
          const live = screenById(s.id);
          if (!live) return;
          if (x) { const rr = sRec.get(s.id); if (rr) rr.key = null; renderScreen(live); }
          else screenNote(r, "This file isn't stored any more. Choose it again in the panel.");
        });
      } else if (u) {
        m = h("div", "sc-media");
        const isVid = src.kind === "video" || (src.kind === "file" && /^video\//.test(src.type || ""));
        if (isVid) m.appendChild(makeVideo(u, s, r));
        else { const im = document.createElement("img"); im.src = u; im.alt = ""; im.draggable = false; m.appendChild(im); }
      }
    } else if (src.kind === "missing") {
      screenNote(r, "Choose “" + src.name + "” again in the panel. Older versions didn't keep local files.");
    }
    if (m) r.el.insertBefore(m, r.empty);
    r.mediaEl = m;
  }
  function sizeScreenMedia(s, r) {
    const m = r.mediaEl;
    if (!m) return;
    const fit = s.fit === "contain" ? "contain" : "cover";
    if (m.dataset.aspect) {
      const ar = +m.dataset.aspect;
      let w = r.bw, hh = r.bw / ar;
      if (fit === "cover" ? hh < r.bh : hh > r.bh) { hh = r.bh; w = r.bh * ar; }
      m.style.width = w + "px"; m.style.height = hh + "px";
      m.style.left = (r.bw - w) / 2 + "px"; m.style.top = (r.bh - hh) / 2 + "px";
    } else {
      m.style.left = "0"; m.style.top = "0"; m.style.width = r.bw + "px"; m.style.height = r.bh + "px";
      const c = m.firstElementChild;
      if (c) c.style.objectFit = fit;
    }
  }
  function renderScreen(s) {
    let r = sRec.get(s.id);
    if (!r) {
      const el = h("div", "screen");
      el.dataset.id = s.id;
      const empty = el.appendChild(h("div", "sc-empty"));
      empty.innerHTML = "<div>" + icon("screen") + "<div class='sc-t'>Screen</div><div class='sc-s'>Choose a video or image in the panel</div></div>";
      const hit = el.appendChild(h("div", "sc-hit"));
      hit.dataset.screen = s.id;
      screensLayer.appendChild(el);
      r = { el, empty, hit, mediaEl: null, key: null, bw: 0, bh: 0, tap: null, note: null };
      sRec.set(s.id, r);
    }
    const el = r.el, pts = s.pts;
    const q = pts.length === 4 ? G.orderQuad(pts) : null;
    if (q && G.isConvex(q)) {
      const d = G.quadDims(q);
      r.bw = Math.max(2, d.w); r.bh = Math.max(2, d.h);
      el.style.width = r.bw + "px"; el.style.height = r.bh + "px";
      el.style.clipPath = ""; el.style.webkitClipPath = "";
      el.style.transform = G.matrix3d(G.rectToQuad(r.bw, r.bh, q));
    } else {
      const b = G.bbox(pts);
      r.bw = Math.max(2, b.w); r.bh = Math.max(2, b.h);
      el.style.width = r.bw + "px"; el.style.height = r.bh + "px";
      el.style.transform = "translate(" + b.x + "px," + b.y + "px)";
      const clip = "polygon(" + pts.map(p => (p[0] - b.x).toFixed(2) + "px " + (p[1] - b.y).toFixed(2) + "px").join(",") + ")";
      el.style.clipPath = clip; el.style.webkitClipPath = clip;
    }
    const key = screenKey(s);
    if (key !== r.key) { r.key = key; buildScreenMedia(s, r); }
    sizeScreenMedia(s, r);
    el.classList.toggle("empty", key === "none");
  }
  function renderScreens() {
    Array.from(sRec.keys()).forEach(id => { if (!screenById(id)) { sRec.get(id).el.remove(); sRec.delete(id); } });
    state.screens.forEach(s => { renderScreen(s); screensLayer.appendChild(sRec.get(s.id).el); });
  }

  /* ======================= surfaces (board space svg) ======================= */
  function drawSurfaces() {
    surfSvg.textContent = "";
    state.surfaces.forEach(s => {
      const on = sel.kind === "surface" && sel.ids.has(s.id);
      const fill = sv("polygon", { points: ptsAttr(G.cyc(s.quad)), class: "sf-fill" + (on ? " on" : "") });
      fill.dataset.surface = s.id;
      surfSvg.appendChild(fill);
      const Hs = G.rectToQuad(1, 1, s.quad);
      const line = (a, b) => surfSvg.appendChild(sv("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "sf-line" }));
      for (let i = 1; i < s.cols; i++) line(G.apply(Hs, i / s.cols, 0), G.apply(Hs, i / s.cols, 1));
      for (let j = 1; j < s.rows; j++) line(G.apply(Hs, 0, j / s.rows), G.apply(Hs, 1, j / s.rows));
      surfSvg.appendChild(sv("polygon", { points: ptsAttr(G.cyc(s.quad)), class: "sf-edge" }));
    });
    if (drag && drag.target) surfSvg.appendChild(sv("polygon", { points: ptsAttr(G.cyc(drag.target.quad)), class: "sf-target" }));
  }
  function reflowSurface(s) {
    state.widgets.forEach(w => { if (w.surface && w.surface.id === s.id) place(w); });
  }
  function autoGrid(q) {
    const d = G.quadDims(q);
    return { cols: clamp(Math.round(d.w / 280), 1, 6), rows: clamp(Math.round(d.h / 220), 1, 6) };
  }

  /* ======================= overlay (screen space) ======================= */
  const hd = new Map();
  let live = new Set();
  function handle(key, cls, pt, onDown, title, cursor) {
    let el = hd.get(key);
    if (!el) {
      el = h("div", "hd " + cls);
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        el._down(e);
      });
      handlesLayer.appendChild(el);
      hd.set(key, el);
    }
    if (title) el.title = title;
    if (cursor) el.style.cursor = cursor;
    el._down = onDown;
    el.style.left = pt[0] + "px"; el.style.top = pt[1] + "px";
    live.add(key);
    return el;
  }
  function opoly(pts, cls) { overlay.appendChild(sv("polygon", { points: ptsAttr(pts), class: cls })); }
  function screenBox(pts) { return G.bbox(pts.map(toScreen)); }

  function tools(sig, box, items) {
    let el = hd.get("tools");
    if (!el || el._sig !== sig) {
      if (el) el.remove();
      el = h("div", "seltools");
      el._sig = sig;
      el.setAttribute("role", "toolbar");
      items.forEach(it => {
        if (it === "|") { el.appendChild(h("div", "sep")); return; }
        const b = el.appendChild(h("button", it.cls || ""));
        b.type = "button";
        b.innerHTML = icon(it.icon) + (it.label ? "<span>" + it.label + "</span>" : "");
        b.title = it.title || it.label || "";
        if (!it.label) b.setAttribute("aria-label", it.title || it.icon);
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => { e.stopPropagation(); it.fn(); });
      });
      handlesLayer.appendChild(el);
      hd.set("tools", el);
    }
    live.add("tools");
    const right = innerWidth - (insOpen() && innerWidth > 760 ? 320 : 0);
    const half = (el.offsetWidth || 200) / 2 + 10;
    el.style.left = clamp(box.x + box.w / 2, half, Math.max(half, right - half)) + "px";
    if (box.y - 14 < 64) { el.style.transform = "translate(-50%, 0)"; el.style.top = Math.min(innerHeight - 120, box.y + box.h + 14) + "px"; }
    else { el.style.transform = "translate(-50%, -100%)"; el.style.top = (box.y - 14) + "px"; }
  }

  function drawOverlay() {
    if (!state) return;
    overlay.textContent = "";
    live = new Set();
    if (editing) {
      if (tool) drawTool();
      else {
        if (sel.kind === "widget") drawWidgetSel();
        else if (sel.kind === "surface") drawSurfaceSel();
        else if (sel.kind === "screen") drawScreenSel();
        if (drag && drag.kind === "marquee") {
          const a = toScreen(drag.a), b = toScreen(drag.b);
          opoly([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], "ol-marquee");
        }
        if (drag && drag.guides) {
          const C = state.canvas;
          if (drag.guides.x != null) { const a = toScreen([drag.guides.x, 0]), b = toScreen([drag.guides.x, C.h]); overlay.appendChild(sv("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "ol-guide" })); }
          if (drag.guides.y != null) { const a = toScreen([0, drag.guides.y]), b = toScreen([C.w, drag.guides.y]); overlay.appendChild(sv("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "ol-guide" })); }
        }
        if (drag && drag.magnet) { const m = toScreen(drag.magnet); overlay.appendChild(sv("circle", { cx: m[0], cy: m[1], r: 9, class: "ol-guide", fill: "none" })); }
      }
    }
    hd.forEach((el, k) => { if (!live.has(k)) { el.remove(); hd.delete(k); } });
  }
  function drawWidgetSel() {
    const ws = selWidgets();
    if (!ws.length) return;
    const busy = drag && (drag.kind === "move" || drag.kind === "marquee");
    ws.forEach(w => opoly(G.cyc(quadOf(w)).map(toScreen), ws.length > 1 ? "ol-multi" : (w.pin && !w.surface ? "ol-pin" : "ol-sel")));
    if (busy) return;
    if (ws.length > 1) {
      const all = []; ws.forEach(w => all.push.apply(all, quadOf(w)));
      tools("multi" + ws.length, screenBox(all), [
        { icon: "copy", label: "Duplicate", fn: duplicateSel },
        { icon: "trash", title: "Delete", cls: "danger", fn: deleteSel }]);
      return;
    }
    const w = ws[0], q = quadOf(w).map(toScreen);
    if (w.surface) {
      handle("span:" + w.id, "hd-span", q[3], e => spanDown(e, w), "Drag across the grid to span more cells");
    } else if (w.pin) {
      q.forEach((p, i) => handle("pin:" + w.id + ":" + i, "hd-pin", p, e => pinDown(e, w, i), "Drag this corner onto your scene. Shift keeps it level."));
    } else {
      q.forEach((p, i) => handle("rs:" + w.id + ":" + i, "hd-corner", p, e => resizeDown(e, w, i), "Drag to resize",
        (i === 0 || i === 3) ? "nwse-resize" : "nesw-resize"));
    }
    const mode = w.surface ? "surface" : w.pin ? "pin" : "flat";
    tools("w:" + w.id + ":" + mode, screenBox(quadOf(w)), [
      mode === "flat"
        ? { icon: "perspective", label: "Perspective", title: "Pin each corner onto the scene", fn: () => setPerspective(w) }
        : { icon: "flat", label: mode === "surface" ? "Release" : "Flatten", title: "Back to a flat widget", fn: () => setFlat(w) },
      "|",
      { icon: "copy", title: "Duplicate (Ctrl D)", fn: duplicateSel },
      { icon: "trash", title: "Delete", cls: "danger", fn: deleteSel }]);
  }
  function drawSurfaceSel() {
    const s = surfaceById(Array.from(sel.ids)[0]);
    if (!s) return;
    const q = s.quad.map(toScreen);
    opoly(G.cyc(q), "ol-sel");
    if (drag && drag.kind === "move") return;
    q.forEach((p, i) => handle("sf:" + s.id + ":" + i, "hd-vert", p, e => surfCornerDown(e, s, i), "Drag to match a corner of the surface"));
    tools("s:" + s.id, G.bbox(q), [{ icon: "trash", label: "Delete surface", cls: "danger", fn: deleteSel }]);
  }
  function drawScreenSel() {
    const s = screenById(Array.from(sel.ids)[0]);
    if (!s) return;
    const pts = s.pts.map(toScreen);
    opoly(pts, "ol-sel");
    if (drag && drag.kind === "move") return;
    pts.forEach((p, i) => handle("v:" + s.id + ":" + i, "hd-vert", p, e => vertDown(e, s, i), "Drag to reshape. Alt-click to remove."));
    pts.forEach((p, i) => {
      const n = pts[(i + 1) % pts.length];
      handle("m:" + s.id + ":" + i, "hd-mid", [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2], e => midDown(e, s, i), "Drag to add a corner");
    });
    const items = [{ icon: "copy", title: "Duplicate", fn: duplicateSel }, { icon: "trash", title: "Delete", cls: "danger", fn: deleteSel }];
    if (s.pts.length !== 4) items.unshift({ icon: "perspective", label: "Use 4 corners", title: "Four corners give the content true perspective", fn: () => fourCorners(s) }, "|");
    tools("sc:" + s.id + ":" + s.pts.length, G.bbox(pts), items);
  }
  function drawTool() {
    const t = tool;
    if (t.rect) {
      const a = toScreen(t.rect[0]), b = toScreen(t.rect[1]);
      opoly([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], "ol-trace");
      return;
    }
    const pts = t.pts.map(toScreen), cur = t.cursor ? toScreen(t.cursor) : null;
    const all = cur ? pts.concat([cur]) : pts;
    if (all.length > 1) overlay.appendChild(sv(all.length > 2 ? "polygon" : "polyline", { points: ptsAttr(all), class: "ol-trace" }));
    pts.forEach((p, i) => overlay.appendChild(sv("circle", { cx: p[0], cy: p[1], r: i === 0 ? 6.5 : 5, class: "ol-dot" + (i === 0 ? " first" : "") })));
  }

  /* ======================= selection ======================= */
  function selWidgets() { return sel.kind === "widget" ? state.widgets.filter(w => sel.ids.has(w.id)) : []; }
  function select(kind, ids) {
    ids = (ids || []).filter(Boolean);
    sel.kind = ids.length ? kind : null;
    sel.ids = new Set(ids);
    afterSelect();
  }
  function toggleSel(kind, id) {
    if (sel.kind !== kind) { sel.kind = kind; sel.ids = new Set(); }
    if (sel.ids.has(id)) sel.ids.delete(id); else sel.ids.add(id);
    if (!sel.ids.size) sel.kind = null;
    afterSelect();
  }
  function pruneSel() {
    const ok = sel.kind === "widget" ? byId : sel.kind === "surface" ? surfaceById : sel.kind === "screen" ? screenById : null;
    if (!ok) return;
    sel.ids = new Set(Array.from(sel.ids).filter(ok));
    if (!sel.ids.size) sel.kind = null;
  }
  function afterSelect() { drawSurfaces(); drawOverlay(); renderInspector(); }
  function commit() { save(); drawSurfaces(); drawOverlay(); renderInspector(); }

  /* ======================= history ======================= */
  const hist = {
    u: [], r: [], key: null, t: 0,
    push() {
      this.u.push(JSON.stringify(state));
      if (this.u.length > 100) this.u.shift();
      this.r.length = 0; this.key = null;
      syncUndo();
    },
    once(key) {
      const n = Date.now();
      if (key !== this.key || n - this.t > 1500) this.push();
      this.key = key; this.t = n;
    },
    undo() { if (!this.u.length) return; this.r.push(JSON.stringify(state)); restore(JSON.parse(this.u.pop())); },
    redo() { if (!this.r.length) return; this.u.push(JSON.stringify(state)); restore(JSON.parse(this.r.pop())); }
  };
  // undo covers layout; what you typed into widgets since then is kept
  function restore(next) {
    const live = {};
    state.widgets.forEach(w => { live[w.id] = w.data; });
    next.widgets.forEach(w => { if (Object.prototype.hasOwnProperty.call(live, w.id)) w.data = live[w.id]; });
    state = store.normalize(next);
    hist.key = null;
    rebuildAll(); save(); syncUndo();
  }
  function syncUndo() {
    $("#dUndo").disabled = !hist.u.length;
    $("#dRedo").disabled = !hist.r.length;
  }
  function swapState(next) {
    state = store.normalize(next);
    rebuildAll(); save();
  }
  function rebuildAll() {
    endTool(true);
    applyTheme();
    layoutViewport();
    renderBackdrop();
    renderWidgets();
    renderScreens();
    pruneSel();
    drawSurfaces(); drawOverlay(); renderInspector();
  }

  /* ======================= pointer plumbing ======================= */
  function track(e, fns) {
    const id = e.pointerId;
    try { e.target.setPointerCapture(id); } catch (err) { /* capture is a nicety, not a requirement */ }
    function mv(ev) { if (ev.pointerId === id) fns.move && fns.move(ev); }
    function done(ev) {
      if (ev.pointerId !== id) return;
      document.removeEventListener("pointermove", mv);
      document.removeEventListener("pointerup", done);
      document.removeEventListener("pointercancel", done);
      try { fns.up && fns.up(ev, ev.type === "pointercancel"); }
      finally { drag = null; drawSurfaces(); drawOverlay(); }
    }
    document.addEventListener("pointermove", mv);
    document.addEventListener("pointerup", done);
    document.addEventListener("pointercancel", done);
  }
  function lazyPush() { let done = false; return () => { if (!done) { hist.push(); done = true; } }; }

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest("[data-ui]")) return;
    if (!editing) return;
    if (pop) closePop();
    const ae = document.activeElement;
    if (ae && ae !== document.body && ins.contains(ae)) ae.blur();
    if (tool) { toolDown(e); return; }
    const wel = e.target.closest(".widget");
    if (wel && widgetsLayer.contains(wel)) { const w = byId(wel.dataset.id); if (w) { widgetDown(e, w); return; } }
    const hit = e.target.closest(".sc-hit");
    if (hit) { const s = screenById(hit.dataset.screen); if (s) { screenDown(e, s); return; } }
    const sf = e.target.closest(".sf-fill");
    if (sf) { const s = surfaceById(sf.dataset.surface); if (s) { surfaceDown(e, s); return; } }
    backgroundDown(e);
  });
  document.addEventListener("dblclick", (e) => {
    if (!editing || tool) return;
    const wel = e.target.closest && e.target.closest(".widget");
    if (wel && widgetsLayer.contains(wel)) { const w = byId(wel.dataset.id); if (w && (w.pin || w.surface)) setFlat(w); }
  });

  function snapRect(w, x, y) {
    const r = wRec.get(w.id), bw = r.bw, bh = r.bh, C = state.canvas, Tt = 7 / V.k;
    const mx = Math.round(C.w * 0.05), my = Math.round(C.h * 0.06);
    const xs = [0, mx, C.w / 2, C.w - mx, C.w], ys = [0, my, C.h / 2, C.h - my, C.h];
    state.widgets.forEach(o => {
      if (o === w || sel.ids.has(o.id)) return;
      const b = G.bbox(quadOf(o));
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    let bx = { d: Tt, v: null, g: null }, by = { d: Tt, v: null, g: null };
    [0, bw / 2, bw].forEach(off => xs.forEach(c => { const d = Math.abs(x + off - c); if (d < bx.d) bx = { d, v: c - off, g: c }; }));
    [0, bh / 2, bh].forEach(off => ys.forEach(c => { const d = Math.abs(y + off - c); if (d < by.d) by = { d, v: c - off, g: c }; }));
    return { x: bx.v == null ? x : bx.v, y: by.v == null ? y : by.v, guides: { x: bx.g, y: by.g } };
  }
  function surfaceTargetAt(p, w) {
    for (let i = state.surfaces.length - 1; i >= 0; i--) {
      const s = state.surfaces[i];
      const uv = G.uv(s.quad, p[0], p[1]);
      if (uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1) {
        const same = w.surface && w.surface.id === s.id;
        const sc = same ? Math.abs(w.surface.c1 - w.surface.c0) : 0, sr = same ? Math.abs(w.surface.r1 - w.surface.r0) : 0;
        const c = clamp(Math.floor(uv[0] * s.cols), 0, s.cols - 1 - sc), r = clamp(Math.floor(uv[1] * s.rows), 0, s.rows - 1 - sr);
        return { sid: s.id, c, r, sc, sr, quad: G.uvRect(s.quad, c / s.cols, (c + sc + 1) / s.cols, r / s.rows, (r + sr + 1) / s.rows) };
      }
    }
    return null;
  }
  function translateW(w, dx, dy) {
    if (w.surface) return;
    if (w.pin) w.pin = w.pin.map(p => [p[0] + dx, p[1] + dy]);
    w.x = (w.x || 0) + dx; w.y = (w.y || 0) + dy;
    place(w);
  }

  function widgetDown(e, w) {
    e.preventDefault();
    if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleSel("widget", w.id); return; }
    if (!(sel.kind === "widget" && sel.ids.has(w.id))) select("widget", [w.id]);
    const items = selWidgets();
    const sx = e.clientX, sy = e.clientY, p0 = toBoard(sx, sy);
    const snaps = items.map(x => ({ w: x, x: x.x, y: x.y, pin: x.pin ? G.clone(x.pin) : null, q: quadOf(x) }));
    const push = lazyPush();
    let moved = false, temp = null;
    track(e, {
      move(ev) {
        if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; push(); drag = { kind: "move" }; }
        const p = toBoard(ev.clientX, ev.clientY);
        let dx = p[0] - p0[0], dy = p[1] - p0[1];
        drag.guides = null; drag.target = null;
        if (snaps.length === 1) {
          const s0 = snaps[0];
          if (!s0.w.pin && !s0.w.surface && !ev.altKey) {
            const r = snapRect(s0.w, s0.x + dx, s0.y + dy);
            dx = r.x - s0.x; dy = r.y - s0.y; drag.guides = r.guides;
          }
          if (state.surfaces.length && !ev.altKey) drag.target = surfaceTargetAt(p, s0.w);
        }
        snaps.forEach(s0 => {
          const x = s0.w, r = wRec.get(x.id);
          if (x.surface) {
            if (snaps.length > 1) return;
            temp = s0.q.map(q => [q[0] + dx, q[1] + dy]);
            r.H = G.rectToQuad(r.bw, r.bh, temp);
            r.el.style.transform = G.matrix3d(r.H);
          } else if (x.pin) { x.pin = s0.pin.map(q => [q[0] + dx, q[1] + dy]); place(x); }
          else { x.x = s0.x + dx; x.y = s0.y + dy; place(x); }
        });
        drawSurfaces(); drawOverlay();
      },
      up() {
        if (!moved) return;
        if (snaps.length === 1) {
          const x = snaps[0].w, t = drag && drag.target;
          if (t) {
            x.surface = { id: t.sid, c0: t.c, r0: t.r, c1: t.c + t.sc, r1: t.r + t.sr };
            delete x.pin; delete x.pinBase;
          } else if (x.surface && temp) {
            delete x.surface;
            const r = wRec.get(x.id), c = G.centroid(temp), d = G.quadDims(temp);
            if (r.bw > 0) { x.fs = clamp(x.fs * d.w / r.bw, 0.3, 16); applyLook(r.el, x); }
            x.x = c[0] - r.el.offsetWidth / 2; x.y = c[1] - r.el.offsetHeight / 2;
          }
          place(x);
        }
        commit();
      }
    });
  }
  function resizeDown(e, w, i) {
    const r = wRec.get(w.id);
    const q0 = G.rectQuad(w.x, w.y, r.bw, r.bh), A = q0[3 - i], C0 = q0[i], fs0 = w.fs;
    const dv = [C0[0] - A[0], C0[1] - A[1]], L2 = dv[0] * dv[0] + dv[1] * dv[1] || 1;
    const push = lazyPush();
    track(e, {
      move(ev) {
        push(); drag = { kind: "resize" };
        const p = toBoard(ev.clientX, ev.clientY);
        const s = Math.max(0.05, ((p[0] - A[0]) * dv[0] + (p[1] - A[1]) * dv[1]) / L2);
        w.fs = +clamp(fs0 * s, 0.35, 14).toFixed(4);
        applyLook(r.el, w);
        const bw = r.el.offsetWidth, bh = r.el.offsetHeight;
        w.x = (i === 0 || i === 2) ? A[0] - bw : A[0];
        w.y = (i === 0 || i === 1) ? A[1] - bh : A[1];
        place(w); drawOverlay();
      },
      up() { commit(); }
    });
  }
  function rebasePin(w) {
    const r = wRec.get(w.id);
    w.pin = quadOf(w); w.pinBase = [r.bw, r.bh];
  }
  // keep a pinned widget's text crisp: render it near the size it is shown at
  function normalizeRes(w) {
    const r = wRec.get(w.id);
    if (!r || !w.pin || r.bw <= 0) return;
    const s = G.quadDims(w.pin).w / r.bw;
    if (s > 1.3 || s < 0.75) {
      const keep = quadOf(w);
      w.fs = clamp(w.fs * s, 0.3, 16);
      applyLook(r.el, w);
      w.pin = keep; w.pinBase = [r.el.offsetWidth, r.el.offsetHeight];
      place(w);
    }
  }
  function magnet(pt, skip) {
    const Tt = 10 / V.k, C = state.canvas;
    let best = null, bd = Tt;
    const test = (p) => { const d = G.dist(p, pt); if (d < bd) { bd = d; best = [p[0], p[1]]; } };
    [[0, 0], [C.w, 0], [0, C.h], [C.w, C.h]].forEach(test);
    state.surfaces.forEach(s => { if (s !== skip) s.quad.forEach(test); });
    state.screens.forEach(s => { if (s !== skip) s.pts.forEach(test); });
    state.widgets.forEach(w => { if (w !== skip && (w.pin || w.surface)) quadOf(w).forEach(test); });
    return best;
  }
  function pinDown(e, w, i) {
    const push = lazyPush();
    let p0 = null, o = null;
    track(e, {
      move(ev) {
        if (!p0) { push(); rebasePin(w); p0 = toBoard(e.clientX, e.clientY); o = w.pin[i].slice(); drag = { kind: "pin" }; }
        const p = toBoard(ev.clientX, ev.clientY);
        let nx = o[0] + p[0] - p0[0], ny = o[1] + p[1] - p0[1];
        if (ev.shiftKey) { if (Math.abs(nx - o[0]) > Math.abs(ny - o[1])) ny = o[1]; else nx = o[0]; }
        const m = ev.altKey ? null : magnet([nx, ny], w);
        drag.magnet = m;
        if (m) { nx = m[0]; ny = m[1]; }
        const q = G.clone(w.pin); q[i] = [nx, ny];
        if (!G.isConvex(q)) return;
        w.pin = q; place(w); drawOverlay();
      },
      up() { if (p0) { normalizeRes(w); commit(); } }
    });
  }
  function spanDown(e, w) {
    const s = surfaceById(w.surface.id);
    if (!s) return;
    const push = lazyPush();
    track(e, {
      move(ev) {
        push(); drag = { kind: "span" };
        const p = toBoard(ev.clientX, ev.clientY), uv = G.uv(s.quad, p[0], p[1]);
        const c = clamp(Math.floor(uv[0] * s.cols), 0, s.cols - 1), r = clamp(Math.floor(uv[1] * s.rows), 0, s.rows - 1);
        const c0 = Math.min(w.surface.c0, w.surface.c1), r0 = Math.min(w.surface.r0, w.surface.r1);
        w.surface = { id: s.id, c0, r0, c1: Math.max(c0, c), r1: Math.max(r0, r) };
        place(w); drawOverlay();
      },
      up() { commit(); }
    });
  }
  function screenDown(e, s) {
    e.preventDefault();
    if (!(sel.kind === "screen" && sel.ids.has(s.id))) select("screen", [s.id]);
    const sx = e.clientX, sy = e.clientY, p0 = toBoard(sx, sy), start = G.clone(s.pts);
    const push = lazyPush();
    let moved = false;
    track(e, {
      move(ev) {
        if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; push(); drag = { kind: "move" }; }
        const p = toBoard(ev.clientX, ev.clientY);
        s.pts = start.map(q => [q[0] + p[0] - p0[0], q[1] + p[1] - p0[1]]);
        renderScreen(s); drawOverlay();
      },
      up() { if (moved) commit(); }
    });
  }
  function vertDown(e, s, i) {
    if (e.altKey) {
      if (s.pts.length > 3) { hist.push(); s.pts.splice(i, 1); renderScreen(s); commit(); }
      else toast("A screen needs at least three corners.");
      return;
    }
    dragVertex(e, s, () => i);
  }
  function midDown(e, s, i) {
    let idx = null;
    dragVertex(e, s, () => {
      if (idx == null) {
        const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length];
        s.pts.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        idx = i + 1;
      }
      return idx;
    });
  }
  function dragVertex(e, s, getIndex) {
    const push = lazyPush();
    const p0 = toBoard(e.clientX, e.clientY);
    let o = null, i = null;
    track(e, {
      move(ev) {
        if (i == null) { push(); i = getIndex(); o = s.pts[i].slice(); drag = { kind: "vertex" }; }
        const p = toBoard(ev.clientX, ev.clientY);
        let np = [o[0] + p[0] - p0[0], o[1] + p[1] - p0[1]];
        const m = ev.altKey ? null : magnet(np, s);
        drag.magnet = m;
        if (m) np = m;
        s.pts[i] = np;
        renderScreen(s); drawOverlay();
      },
      up() { if (i != null) commit(); }
    });
  }
  function surfaceDown(e, s) {
    e.preventDefault();
    if (!(sel.kind === "surface" && sel.ids.has(s.id))) select("surface", [s.id]);
    const sx = e.clientX, sy = e.clientY, p0 = toBoard(sx, sy), start = G.clone(s.quad);
    const push = lazyPush();
    let moved = false;
    track(e, {
      move(ev) {
        if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; push(); drag = { kind: "move" }; }
        const p = toBoard(ev.clientX, ev.clientY);
        s.quad = start.map(q => [q[0] + p[0] - p0[0], q[1] + p[1] - p0[1]]);
        reflowSurface(s); drawSurfaces(); drawOverlay();
      },
      up() { if (moved) commit(); }
    });
  }
  function surfCornerDown(e, s, i) {
    const push = lazyPush();
    const p0 = toBoard(e.clientX, e.clientY), o = s.quad[i].slice();
    track(e, {
      move(ev) {
        push(); drag = { kind: "vertex" };
        const p = toBoard(ev.clientX, ev.clientY);
        let np = [o[0] + p[0] - p0[0], o[1] + p[1] - p0[1]];
        const m = ev.altKey ? null : magnet(np, s);
        drag.magnet = m;
        if (m) np = m;
        const q = G.clone(s.quad); q[i] = np;
        if (!G.isConvex(q)) return;
        s.quad = q; reflowSurface(s); drawSurfaces(); drawOverlay();
      },
      up() { commit(); }
    });
  }
  function backgroundDown(e) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, a = toBoard(sx, sy), add = e.shiftKey;
    let moved = false;
    track(e, {
      move(ev) {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        drag = { kind: "marquee", a, b: toBoard(ev.clientX, ev.clientY) };
        drawOverlay();
      },
      up(ev) {
        if (!moved) { if (!add) select(null); return; }
        const b = toBoard(ev.clientX, ev.clientY);
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        const ids = state.widgets.filter(w => { const c = centerOf(w); return c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1; }).map(w => w.id);
        if (add && sel.kind === "widget") sel.ids.forEach(id => ids.push(id));
        select("widget", Array.from(new Set(ids)));
      }
    });
  }

  /* ======================= drawing tools ======================= */
  function startTool(kind) {
    if (!editing) setEditing(true);
    closePop();
    if (tool && tool.kind === kind) { endTool(); return; }
    tool = { kind, pts: [], cursor: null, rect: null };
    select(null);
    document.body.style.cursor = "crosshair";
    $("#dSurface").classList.toggle("on", kind === "surface");
    $("#dScreen").classList.toggle("on", kind === "screen");
    updateModebar();
    drawOverlay();
  }
  function endTool(silent) {
    if (!tool) return;
    tool = null;
    document.body.style.cursor = "";
    $("#dSurface").classList.remove("on"); $("#dScreen").classList.remove("on");
    $("#modebar").hidden = true;
    if (!silent) drawOverlay();
  }
  function updateModebar() {
    const mb = $("#modebar"), t = tool;
    if (!t) { mb.hidden = true; return; }
    mb.hidden = false;
    const n = t.pts.length;
    let msg;
    if (t.kind === "surface") msg = n ? "<b>" + n + " of 4</b> corners. Keep going around the surface." : "<b>Surface.</b> Click the 4 corners of a wall, desk or panel in your scene, or drag a box.";
    else msg = n < 3 ? "<b>Screen.</b> Click around the opening you want to fill, or drag a box." + (n ? " " + n + " point" + (n > 1 ? "s" : "") + " so far." : "")
                     : "<b>" + n + " corners.</b> Click the first point or press Enter to finish.";
    $("#modeText").innerHTML = msg;
    $("#modeDone").hidden = !(t.kind === "screen" && n >= 3);
  }
  function toolDown(e) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, p = toBoard(sx, sy);
    let rect = false;
    track(e, {
      move(ev) {
        if (!rect && !tool.pts.length && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) rect = true;
        if (rect) { tool.rect = [p, toBoard(ev.clientX, ev.clientY)]; drawOverlay(); }
      },
      up() {
        if (!tool) return;
        if (rect) {
          const a = tool.rect[0], b = tool.rect[1];
          tool.rect = null;
          const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), hh = Math.abs(a[1] - b[1]);
          if (w * V.k < 24 || hh * V.k < 18) { drawOverlay(); return; }
          finishTool(G.rectQuad(x, y, w, hh), true);
          return;
        }
        const pts = tool.pts;
        if (pts.length) {
          const first = toScreen(pts[0]), last = toScreen(pts[pts.length - 1]);
          if (tool.kind === "screen" && pts.length >= 3 && (G.dist(first, [sx, sy]) < 14 || G.dist(last, [sx, sy]) < 5)) { finishTool(pts); return; }
          if (G.dist(last, [sx, sy]) < 5) return;
        }
        pts.push(p);
        if (tool.kind === "surface" && pts.length === 4) { finishTool(pts); return; }
        updateModebar(); drawOverlay();
      }
    });
  }
  function finishTool(pts, isRect) {
    const kind = tool.kind;
    endTool(true);
    if (kind === "surface") {
      const q = isRect ? pts : G.orderQuad(pts);
      if (!G.isConvex(q)) { toast("Those corners cross over each other. Try again, going around the edge."); drawOverlay(); return; }
      hist.push();
      const g = autoGrid(q);
      const s = { id: store.uid("z"), quad: G.clone(q), cols: g.cols, rows: g.rows, gap: 0.08, fit: "fit" };
      state.surfaces.push(s);
      select("surface", [s.id]);
      save();
      toast("Surface added. Drag widgets onto it to snap them into the grid.");
    } else {
      if (pts.length < 3) { drawOverlay(); return; }
      hist.push();
      const s = { id: store.uid("s"), pts: G.clone(isRect ? G.cyc(pts) : pts), src: { kind: "none" }, controls: false, fit: "cover", muted: true };
      state.screens.push(s);
      renderScreen(s);
      select("screen", [s.id]);
      save();
    }
  }
  function fourCorners(s) {
    hist.push();
    const b = G.bbox(s.pts);
    const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    const used = new Set();
    s.pts = corners.map(c => {
      let bi = 0, bd = Infinity;
      s.pts.forEach((p, i) => { if (used.has(i)) return; const d = G.dist(p, c); if (d < bd) { bd = d; bi = i; } });
      used.add(bi);
      return s.pts[bi].slice();
    });
    renderScreen(s); commit();
  }

  /* ======================= actions ======================= */
  function visibleCenter() {
    const insW = insOpen() && innerWidth > 760 ? 320 : 0;
    const a = toBoard(0, 0), b = toBoard(innerWidth - insW, innerHeight - 80), C = state.canvas;
    const x0 = Math.max(0, a[0]), y0 = Math.max(0, a[1]), x1 = Math.min(C.w, b[0]), y1 = Math.min(C.h, b[1]);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  let cascade = 0;
  function addWidget(type) {
    if (!editing) setEditing(true);
    hist.push();
    const c = visibleCenter(), off = (cascade++ % 5) * 28;
    const w = SS.widgets.create(type, { fs: +clamp(state.canvas.h / 1000, 0.8, 3).toFixed(2),
                                         place: { x: c[0] + off, y: c[1] + off, ax: 0.5, ay: 0.5 } });
    state.widgets.push(w);
    buildWidget(w);
    select("widget", [w.id]);
    save();
  }
  function cloneWidget(w, d) {
    const c = JSON.parse(JSON.stringify(w));
    c.id = store.uid();
    if (c.surface) { delete c.surface; c.pin = quadOf(w); const r = wRec.get(w.id); c.pinBase = [r.bw, r.bh]; }
    if (c.pin) c.pin = c.pin.map(p => [p[0] + d, p[1] + d]);
    c.x = (c.x || 0) + d; c.y = (c.y || 0) + d;
    return c;
  }
  function duplicateSel() {
    if (sel.kind === "widget") {
      hist.push();
      const ids = selWidgets().map(w => { const c = cloneWidget(w, 28); state.widgets.push(c); buildWidget(c); return c.id; });
      select("widget", ids); save();
    } else if (sel.kind === "screen") {
      hist.push();
      const ids = Array.from(sel.ids).map(id => {
        const s = JSON.parse(JSON.stringify(screenById(id)));
        s.id = store.uid("s"); s.pts = s.pts.map(p => [p[0] + 28, p[1] + 28]);
        state.screens.push(s); renderScreen(s); return s.id;
      });
      select("screen", ids); save();
    }
  }
  function flattenWidget(w) {
    const r = wRec.get(w.id);
    if (!r) return;
    const q = quadOf(w), d = G.quadDims(q), c = G.centroid(q);
    if (r.bw > 0) w.fs = clamp(w.fs * d.w / r.bw, 0.3, 16);
    delete w.pin; delete w.pinBase; delete w.surface;
    applyLook(r.el, w);
    w.x = c[0] - r.el.offsetWidth / 2; w.y = c[1] - r.el.offsetHeight / 2;
    place(w);
  }
  function deleteSel() {
    if (!sel.kind) return;
    hist.push();
    if (sel.kind === "widget") {
      state.widgets = state.widgets.filter(w => { if (sel.ids.has(w.id)) { dropRec(w.id); return false; } return true; });
    } else if (sel.kind === "screen") {
      state.screens = state.screens.filter(s => !sel.ids.has(s.id));
      renderScreens();
    } else if (sel.kind === "surface") {
      state.widgets.forEach(w => { if (w.surface && sel.ids.has(w.surface.id)) flattenWidget(w); });
      state.surfaces = state.surfaces.filter(s => !sel.ids.has(s.id));
    }
    select(null); save();
  }
  function setPerspective(w) {
    hist.push();
    rebasePin(w);
    delete w.surface;
    place(w); commit();
    coachOnce("pin", "Drag the round corners onto the edges of a wall, screen or table in your scene.");
  }
  function setFlat(w) {
    if (!w.pin && !w.surface) return;
    hist.push();
    flattenWidget(w); commit();
  }
  function copySel() {
    if (sel.kind !== "widget") return;
    clipboard = selWidgets().map(w => cloneWidget(w, 0));
  }
  let pasteN = 0;
  function pasteClip() {
    if (!clipboard.length) return;
    hist.push();
    pasteN++;
    const ids = clipboard.map(src => {
      const c = JSON.parse(JSON.stringify(src));
      c.id = store.uid();
      const d = 28 * pasteN;
      if (c.pin) c.pin = c.pin.map(p => [p[0] + d, p[1] + d]);
      c.x += d; c.y += d;
      state.widgets.push(c); buildWidget(c);
      return c.id;
    });
    select("widget", ids); save();
  }
  function nudge(dx, dy) {
    if (!sel.kind) return;
    hist.once("nudge");
    if (sel.kind === "widget") selWidgets().forEach(w => translateW(w, dx, dy));
    else if (sel.kind === "screen") sel.ids.forEach(id => { const s = screenById(id); s.pts = s.pts.map(p => [p[0] + dx, p[1] + dy]); renderScreen(s); });
    else sel.ids.forEach(id => { const s = surfaceById(id); s.quad = s.quad.map(p => [p[0] + dx, p[1] + dy]); reflowSurface(s); });
    save(); drawSurfaces(); drawOverlay();
  }
  function layer(front) {
    const ws = selWidgets();
    if (!ws.length) return;
    hist.push();
    const rest = state.widgets.filter(w => !sel.ids.has(w.id));
    state.widgets = front ? rest.concat(ws) : ws.concat(rest);
    reorderDOM(); save();
  }
  function align(kind) {
    const ws = selWidgets().filter(w => !w.surface);
    if (ws.length < 2) return;
    hist.push();
    const boxes = ws.map(w => ({ w, b: G.bbox(quadOf(w)) }));
    const L = Math.min.apply(null, boxes.map(o => o.b.x)), R = Math.max.apply(null, boxes.map(o => o.b.x + o.b.w));
    const Tp = Math.min.apply(null, boxes.map(o => o.b.y)), B = Math.max.apply(null, boxes.map(o => o.b.y + o.b.h));
    if (kind === "dh" || kind === "dv") {
      const ax = kind === "dh" ? "x" : "y", sz = kind === "dh" ? "w" : "h";
      boxes.sort((a, b) => (a.b[ax] + a.b[sz] / 2) - (b.b[ax] + b.b[sz] / 2));
      const first = boxes[0].b[ax] + boxes[0].b[sz] / 2, last = boxes[boxes.length - 1].b[ax] + boxes[boxes.length - 1].b[sz] / 2;
      boxes.forEach((o, i) => {
        const target = first + (last - first) * i / (boxes.length - 1), cur = o.b[ax] + o.b[sz] / 2;
        if (ax === "x") translateW(o.w, target - cur, 0); else translateW(o.w, 0, target - cur);
      });
    } else boxes.forEach(({ w, b }) => {
      let dx = 0, dy = 0;
      if (kind === "l") dx = L - b.x;
      if (kind === "ch") dx = (L + R) / 2 - (b.x + b.w / 2);
      if (kind === "r") dx = R - (b.x + b.w);
      if (kind === "t") dy = Tp - b.y;
      if (kind === "cv") dy = (Tp + B) / 2 - (b.y + b.h / 2);
      if (kind === "b") dy = B - (b.y + b.h);
      translateW(w, dx, dy);
    });
    commit();
  }
  function rescaleLayout(nw, nh) {
    const C = state.canvas, kx = nw / C.w, ky = nh / C.h, ks = Math.min(kx, ky);
    if (Math.abs(kx - 1) < 1e-4 && Math.abs(ky - 1) < 1e-4) return false;
    state.widgets.forEach(w => {
      const r = wRec.get(w.id), bw = r ? r.bw : 0, bh = r ? r.bh : 0;
      if (w.pin) { w.pin = w.pin.map(p => [p[0] * kx, p[1] * ky]); return; }
      if (w.surface) return;
      const cx = w.x + bw / 2, cy = w.y + bh / 2;
      w.fs = clamp(w.fs * ks, 0.3, 16);
      w.x = cx * kx - bw * ks / 2; w.y = cy * ky - bh * ks / 2;
    });
    state.surfaces.forEach(s => { s.quad = s.quad.map(p => [p[0] * kx, p[1] * ky]); });
    state.screens.forEach(s => { s.pts = s.pts.map(p => [p[0] * kx, p[1] * ky]); });
    C.w = Math.round(nw); C.h = Math.round(nh);
    return true;
  }
  function setCanvas(nw, nh) {
    hist.push();
    if (rescaleLayout(nw, nh)) rebuildAll();
    save();
  }

  /* ======================= modes and chrome ======================= */
  function setEditing(on) {
    editing = !!on;
    document.body.classList.toggle("editing", editing);
    if (!editing) {
      endTool(true); closePop();
      sel.kind = null; sel.ids = new Set();
      const ae = document.activeElement;
      if (ae && ae.blur && ae !== document.body) ae.blur();
    } else {
      coachOnce("edit", "Drag widgets to move them. Pull a corner to resize. Press E or Done to go back.");
    }
    animateStage();
    layoutViewport();
    drawSurfaces(); drawOverlay(); renderInspector(); poke();
  }
  let animT = 0;
  function animateStage() {
    if (!document.body.classList.contains("ready")) return;
    stage.classList.add("animating");
    clearTimeout(animT);
    animT = setTimeout(() => { stage.classList.remove("animating"); drawOverlay(); }, 360);
  }
  let chromeT = 0, idleT = 0, overBar = false;
  function poke() {
    document.body.classList.remove("idle", "chrome-hidden");
    clearTimeout(chromeT); clearTimeout(idleT);
    if (editing) return;
    chromeT = setTimeout(() => { if (!overBar) document.body.classList.add("chrome-hidden"); }, 2600);
    idleT = setTimeout(() => { if (!overBar && !modals.length) document.body.classList.add("idle"); }, 4000);
  }
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) === 0) return;
    poke();
    if (tool && !drag) { tool.cursor = toBoard(e.clientX, e.clientY); drawOverlay(); }
  }, { passive: true });
  document.addEventListener("pointerdown", () => { if (!editing) poke(); }, true);
  $("#viewbar").addEventListener("pointerenter", () => { overBar = true; });
  $("#viewbar").addEventListener("pointerleave", () => { overBar = false; poke(); });

  function setShade(on) {
    const sh = $("#shade"), pane = sh.querySelector(".pane");
    sh.classList.toggle("on", !!on);
    sh.setAttribute("aria-hidden", on ? "false" : "true");
    pane.style.backgroundImage = "";
    if (on && state.privacy.image) {
      const im = state.privacy.image;
      const set = (u) => { if (u) pane.style.backgroundImage = 'url("' + u + '")'; };
      if (media.isRef(im)) { const u = media.url(im); if (u) set(u); else media.load(im).then(set); } else set(im);
    }
    if (on) $("#shadeOff").focus();
  }
  const shadeOn = () => $("#shade").classList.contains("on");
  function toggleFullscreen() {
    if (!document.fullscreenElement) { const r = document.documentElement.requestFullscreen; if (r) r.call(document.documentElement).catch(() => {}); }
    else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
  const fitAsked = new Set();
  function offerFit() {
    const C = state.canvas, W = innerWidth, H = innerHeight;
    const off = Math.abs((W / H) / (C.w / C.h) - 1);
    const key = W + "x" + H;
    if (off < 0.03 || fitAsked.has(key)) return;
    fitAsked.add(key);
    toast("This screen is a different shape from your layout.", { label: "Fit to screen", fn: () => {
      setCanvas(W, H); toast("Layout refitted to " + W + "×" + H + ".", { label: "Undo", fn: () => hist.undo() });
    } });
  }
  document.addEventListener("fullscreenchange", () => {
    $("#vFull").innerHTML = icon(document.fullscreenElement ? "shrink" : "expand");
    if (document.fullscreenElement) setTimeout(offerFit, 500);
  });

  /* ---- toasts and coach marks ---- */
  function toast(msg, action) {
    const t = h("div", "toast glass-ui");
    t.appendChild(h("span", null, msg));
    if (action) {
      const b = t.appendChild(h("button", "btn", action.label));
      b.type = "button";
      b.onclick = () => { action.fn(); kill(); };
    }
    $("#toasts").appendChild(t);
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 260); };
    setTimeout(kill, action ? 6000 : 4200);
  }
  SS.ui = { toast };
  function seen(k) { try { return localStorage.getItem("second-screen:tip:" + k) === "1"; } catch (e) { return true; } }
  function markSeen(k) { try { localStorage.setItem("second-screen:tip:" + k, "1"); } catch (e) { /* ignore */ } }
  function coachOnce(k, msg) {
    if (params.has("test") || seen(k)) return;
    markSeen(k);
    const c = h("div", "coach glass-ui");
    c.innerHTML = icon("sparkle") + "<span></span>";
    c.querySelector("span").textContent = msg;
    document.body.appendChild(c);
    setTimeout(() => { c.style.transition = "opacity .4s"; c.style.opacity = "0"; setTimeout(() => c.remove(), 450); }, 5200);
  }

  /* ---- add-widget catalog ---- */
  function closePop() {
    if (!pop) return;
    pop.remove(); pop = null;
    $("#dAdd").classList.remove("on");
  }
  function openCatalog() {
    if (!editing) setEditing(true);
    if (pop) { closePop(); return; }
    endTool();
    pop = h("div", "pop glass-ui catalog");
    pop.dataset.ui = "";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Add a widget");
    SS.widgets.cats.forEach(([cat, label]) => {
      pop.appendChild(h("h4", null, label));
      const g = pop.appendChild(h("div", "grid"));
      Object.keys(T).filter(k => T[k].cat === cat).forEach(k => {
        const d = T[k], b = g.appendChild(h("button"));
        b.type = "button";
        const ic = b.appendChild(h("span", "cic")); ic.innerHTML = icon(d.icon);
        const tx = b.appendChild(h("span"));
        tx.appendChild(h("b", null, d.name)); tx.appendChild(h("small", null, d.desc));
        b.onclick = () => { closePop(); addWidget(k); };
      });
    });
    document.body.appendChild(pop);
    const r = $("#dAdd").getBoundingClientRect();
    pop.style.left = clamp(r.left, 12, innerWidth - pop.offsetWidth - 12) + "px";
    pop.style.top = Math.max(12, r.top - pop.offsetHeight - 10) + "px";
    $("#dAdd").classList.add("on");
    const first = pop.querySelector("button");
    if (first) first.focus();
  }

  /* ---- modals ---- */
  const modals = [];
  function modal(o) {
    const wrap = h("div", "modal-wrap");
    wrap.dataset.ui = "";
    const m = wrap.appendChild(h("div", "modal" + (o.wide ? " wide" : "")));
    m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", o.title);
    const head = m.appendChild(h("div", "m-head"));
    const tt = head.appendChild(h("div"));
    tt.appendChild(h("h2", null, o.title));
    if (o.sub) tt.appendChild(h("p", "sub", o.sub));
    if (o.closable !== false) {
      const x = head.appendChild(h("button", "btn icon"));
      x.type = "button"; x.innerHTML = icon("x"); x.setAttribute("aria-label", "Close");
      x.onclick = () => close();
    }
    if (o.body) m.appendChild(o.body);
    if (o.actions) {
      const f = m.appendChild(h("div", "m-foot"));
      o.actions.forEach(a => {
        const b = f.appendChild(h("button", "btn" + (a.primary ? " primary" : ""), a.label));
        b.type = "button";
        if (a.primary) b.dataset.autofocus = "";
        b.onclick = () => { if (a.fn() !== false) close(); };
      });
    }
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap && o.closable !== false) close(); });
    document.body.appendChild(wrap);
    document.body.classList.remove("idle");
    const prev = document.activeElement;
    setTimeout(() => { const f = m.querySelector("[data-autofocus]"); if (f) f.focus(); else m.setAttribute("tabindex", "-1"), m.focus({ preventScroll: true }); }, 40);
    function close() {
      const i = modals.indexOf(close);
      if (i < 0) return;
      modals.splice(i, 1); wrap.remove();
      if (o.onClose) o.onClose();
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    }
    modals.push(close);
    return close;
  }
  function closeTopModal() { const c = modals[modals.length - 1]; if (c) { c(); return true; } return false; }

  function buildPreview(t, pv) {
    const W = 1600, H = 900;
    let st;
    try { st = store.normalize(t.build(W, H)); } catch (e) { console.error(e); return; }
    const th = SS.THEMES[st.theme];
    const mini = pv.appendChild(h("div", "mini"));
    mini.style.width = W + "px"; mini.style.height = H + "px";
    mini.setAttribute("inert", ""); mini.setAttribute("aria-hidden", "true");
    themeVars(mini, th, st.style);
    const cv = mini.appendChild(document.createElement("canvas"));
    cv.width = 480; cv.height = 270;
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    SS.scenes.draw(st.backdrop.scene || th.scene, cv, 480, 270, th);
    const layer = mini.appendChild(h("div"));
    layer.style.cssText = "position:absolute;left:0;top:0";
    st.widgets.forEach(w => {
      const { el, body } = makeShell(w, th);
      layer.appendChild(el);
      renderInto(w, body, true);
      layoutWidget(w, el, st.surfaces, th);
    });
    mini.style.transform = "scale(" + (pv.clientWidth / W) + ")";
  }
  function openGallery(welcome) {
    closePop();
    const body = h("div", "gallery");
    let close = null;
    SS.templates.forEach(t => {
      const card = body.appendChild(h("button", "card"));
      card.type = "button";
      if (!welcome && state.name === t.name) card.classList.add("current");
      const pv = card.appendChild(h("div", "pv"));
      const meta = card.appendChild(h("div", "meta"));
      meta.appendChild(h("b", null, t.name));
      meta.appendChild(h("small", null, t.blurb));
      card.onclick = () => { close(); applyTemplate(t); };
      card._pv = pv; card._t = t;
    });
    close = modal({
      title: welcome ? "Welcome to Second Screen" : "Starter scenes",
      sub: welcome ? "A calm, good-looking dashboard for your spare monitor. Pick a scene to start from. Everything in it can be moved, restyled or swapped for your own photo."
                   : "Switch to a fresh scene. Your current layout is one Undo away.",
      body, wide: true
    });
    setTimeout(() => Array.from(body.children).forEach(c => buildPreview(c._t, c._pv)), 16);
  }
  function applyTemplate(t) {
    hist.push();
    const C = state.canvas;
    const next = store.normalize(t.build(C.w, C.h));
    next.canvas.fit = C.fit;
    swapState(next);
    toast("Loaded “" + t.name + "”", { label: "Undo", fn: () => hist.undo() });
    if (!editing) coachOnce("view", "Move the mouse to bring up the controls. Press E to edit.");
  }

  function openHelp() {
    const body = h("div", "help-grid");
    const block = (title, rows) => {
      const d = body.appendChild(h("div"));
      d.appendChild(h("h4", null, title));
      const dl = d.appendChild(h("dl"));
      rows.forEach(([k, v]) => { const dt = dl.appendChild(h("dt")); dt.innerHTML = k; dl.appendChild(h("dd", null, v)); });
    };
    const K = (s) => s.split(" ").map(x => '<span class="kbd">' + x + "</span>").join(" ");
    block("The idea", [
      ["View", "The dashboard. Controls fade away when you stop moving the mouse."],
      ["Edit", "Arrange things. Widgets turn back into working widgets when you're done."],
      ["Perspective", "Pin a widget's four corners onto your scene so it sits on a wall or a screen."],
      ["Surface", "A perspective grid. Drop widgets onto it and they snap into its cells."],
      ["Screen", "Trace an opening in your picture and play a video or image through it."]]);
    block("Shortcuts", [
      [K("E"), "Edit or finish editing"], [K("A"), "Add a widget"], [K("G"), "Draw a surface"], [K("S"), "Trace a screen"],
      [K("P"), "Privacy shade"], [K("F"), "Full screen"], [K("I"), "Show or hide the panel"], [K("?"), "This help"]]);
    block("Editing", [
      [K("Ctrl Z"), "Undo, with Shift to redo"], [K("Ctrl D"), "Duplicate"], [K("Ctrl C") + " " + K("V"), "Copy and paste"],
      [K("Ctrl A"), "Select every widget"], [K("Del"), "Delete the selection"], [K("←↑→↓"), "Nudge, with Shift for 10px"],
      [K("[") + " " + K("]"), "Send back, bring forward"]]);
    block("Handy", [
      ["Shift-click", "Add to the selection, or drag a box on empty space"],
      ["Double-click", "Flatten a pinned widget"],
      ["Alt while dragging", "Turn off snapping"],
      ["Shift on a corner", "Keep a pinned corner level"],
      ["Alt-click a point", "Remove a corner from a screen"]]);
    modal({ title: "How Second Screen works", body, wide: true });
  }

  async function openShare() {
    const body = h("div");
    body.appendChild(h("p", "hint", "Anyone with this link gets their own copy of this layout: the scene, theme, widgets and where they sit. Your notes, tasks and logs are left out."));
    const box = body.appendChild(h("div", "share-box"));
    const inp = box.appendChild(h("input", "f-input"));
    inp.readOnly = true; inp.value = "Preparing the link…"; inp.setAttribute("aria-label", "Share link");
    const copy = box.appendChild(h("button", "btn primary", "Copy link"));
    copy.type = "button";
    const note = body.appendChild(h("p", "hint"));
    note.style.marginTop = "12px";
    modal({ title: "Share this layout", body });
    try {
      const { token, dropped } = await store.encodeShare(state);
      const url = location.href.split("#")[0].split("?")[0] + "#l=" + token;
      inp.value = url;
      const notes = [];
      if (dropped.length) notes.push("Not included: " + dropped.join(", ") + ". Files from your computer stay on your computer. Use an image or video link to share them.");
      if (location.protocol === "file:") notes.push("This copy is open from a file, so the link only works on this computer. Share from the hosted site instead.");
      note.textContent = notes.join(" ");
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(url); }
        catch (e) { inp.select(); try { document.execCommand("copy"); } catch (e2) { /* ignore */ } }
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy link"; }, 1800);
      };
    } catch (e) { inp.value = "Sorry, the link could not be made in this browser."; }
  }
  async function checkShareHash() {
    const m = /^#l=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return false;
    const clear = () => history.replaceState(null, "", location.pathname + location.search);
    let next;
    try { next = store.normalize(await store.decodeShare(m[1])); }
    catch (e) { clear(); toast("That share link could not be read."); return false; }
    modal({
      title: "Open a shared layout?",
      sub: "Someone shared “" + (next.name || "a layout") + "” with you. Opening it replaces what's on screen now, and Undo brings yours back.",
      actions: [
        { label: "Keep mine", fn: clear },
        { label: "Open it", primary: true, fn: () => { clear(); hist.push(); swapState(next); toast("Opened “" + (next.name || "shared layout") + "”", { label: "Undo", fn: () => hist.undo() }); } }]
    });
    return true;
  }
  function slug(s) { return (s || "layout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout"; }
  async function exportFile() {
    const data = await store.externalize(state);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = slug(state.name) + ".second-screen.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast("Backup saved. It includes your photos and widget contents.");
  }
  function pickFile(accept, fn) {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept;
    i.onchange = () => { const f = i.files && i.files[0]; if (f) fn(f); };
    i.click();
  }
  function importFile(file) {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const o = JSON.parse(r.result);
        let next = (o && o.v === 2) ? o : store.migrateV1(o);
        if (!next) throw new Error("not a layout");
        next = store.normalize(next);
        await store.internalize(next);
        delete next.migrated;
        hist.push(); swapState(next);
        toast("Restored “" + (next.name || "layout") + "”", { label: "Undo", fn: () => hist.undo() });
      } catch (e) { toast("That file isn't a Second Screen layout."); }
    };
    r.readAsText(file);
  }
  async function storeFile(f) {
    try { return await media.put(f, f.name); }
    catch (e) {
      if (f.size > 3e6) { toast("This browser can't store files here, and that one is too big to keep inline."); return null; }
      return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(f); });
    }
  }

  /* ======================= inspector ======================= */
  let insKey = "";
  function sec(body, title, act) {
    const s = body.appendChild(h("section", "ins"));
    if (title) {
      const t = s.appendChild(h("h3", null, title));
      if (act) { const b = t.appendChild(h("button", "act", act.label)); b.type = "button"; b.onclick = act.fn; }
    }
    return s;
  }
  function row(parent, label, ctl) {
    const r = parent.appendChild(h("div", "row"));
    r.appendChild(h("span", "lbl", label));
    const c = r.appendChild(h("div", "ctl"));
    (Array.isArray(ctl) ? ctl : [ctl]).forEach(x => c.appendChild(x));
    const f = c.querySelector("input, select, button, textarea");
    if (f && !f.getAttribute("aria-label")) f.setAttribute("aria-label", label);
    return r;
  }
  function stack(parent, label, ctl) {
    const r = parent.appendChild(h("div", "stack"));
    if (label) r.appendChild(h("span", "lbl", label));
    r.appendChild(ctl);
    const f = ctl.matches && ctl.matches("input, select, textarea") ? ctl : ctl.querySelector && ctl.querySelector("input, select, textarea");
    if (f && label && !f.getAttribute("aria-label")) f.setAttribute("aria-label", label);
    return r;
  }
  function hint(parent, text, cls) { const p = parent.appendChild(h("p", cls || "hint")); p.innerHTML = text; return p; }
  function tgl(val, fn) {
    const b = h("button", "tgl" + (val ? " on" : ""));
    b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(!!val));
    b.onclick = () => { val = !val; b.classList.toggle("on", val); b.setAttribute("aria-checked", String(val)); fn(val); };
    return b;
  }
  function seg(choices, val, fn) {
    const s = h("div", "seg");
    s.setAttribute("role", "radiogroup");
    choices.forEach(([v, label, ic]) => {
      const b = s.appendChild(h("button", v === val ? "on" : ""));
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(v === val));
      b.innerHTML = (ic ? icon(ic) : "") + "<span></span>";
      b.querySelector("span").textContent = label;
      b.onclick = () => {
        Array.from(s.children).forEach(x => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("on"); b.setAttribute("aria-checked", "true");
        fn(v);
      };
    });
    return s;
  }
  function rng(min, max, step, val, fn, fmt) {
    const w = h("div", "rng");
    const i = w.appendChild(h("input"));
    i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = val;
    const o = w.appendChild(h("output", null, fmt ? fmt(val) : String(val)));
    i.oninput = () => { const v = +i.value; o.textContent = fmt ? fmt(v) : String(v); fn(v); };
    return w;
  }
  function swatch(val, fallback, fn, label) {
    const l = h("label", "swatch" + (val ? "" : " unset"));
    l.title = label;
    const i = l.appendChild(h("input"));
    i.type = "color"; i.value = /^#[0-9a-f]{6}$/i.test(val || "") ? val : (/^#[0-9a-f]{6}$/i.test(fallback) ? fallback : "#ffffff");
    i.setAttribute("aria-label", label);
    l.style.background = i.value;
    i.oninput = () => { l.style.background = i.value; l.classList.remove("unset"); fn(i.value); };
    return l;
  }
  function txt(val, ph, fn, commitOnly) {
    const i = h("input", "f-input");
    i.type = "text"; i.value = val || ""; i.placeholder = ph || ""; i.spellcheck = false;
    if (commitOnly) {
      i.onchange = () => fn(i.value);
      i.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); i.blur(); } };
    } else i.oninput = () => fn(i.value);
    return i;
  }
  function selc(choices, val, fn) {
    const s = h("select", "f-select");
    choices.forEach(([v, label]) => { const o = s.appendChild(h("option", null, label)); o.value = v; if (v === val) o.selected = true; });
    s.onchange = () => fn(s.value);
    return s;
  }
  function ibtn(label, ic, fn, cls) {
    const b = h("button", "ibtn" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = (ic ? icon(ic) : "") + "<span></span>";
    b.querySelector("span").textContent = label;
    b.onclick = fn;
    return b;
  }
  function urlRow(val, ph, fn, btnLabel) {
    const wrap = h("div", "inline");
    const i = wrap.appendChild(txt(val, ph, () => {}, false));
    const b = wrap.appendChild(ibtn(btnLabel || "Set", null, () => fn(i.value.trim())));
    i.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); fn(i.value.trim()); } };
    b.classList.add("primary");
    return wrap;
  }
  function headInto(head, ic, title, sub) {
    const b = head.appendChild(h("div", "badge")); b.innerHTML = icon(ic);
    const t = head.appendChild(h("div", "ttl"));
    t.appendChild(h("h2", null, title));
    if (sub) t.appendChild(h("p", null, sub));
  }

  function renderInspector() {
    if (!editing) return;
    const key = sel.kind + ":" + Array.from(sel.ids).join(",");
    const old = ins.querySelector(".ins-body");
    const scroll = key === insKey && old ? old.scrollTop : 0;
    insKey = key;
    ins.textContent = "";
    const head = ins.appendChild(h("div", "ins-head"));
    const body = ins.appendChild(h("div", "ins-body"));
    try {
      if (sel.kind === "widget") { const ws = selWidgets(); if (ws.length === 1) inspectWidget(ws[0], head, body); else inspectMulti(ws, head, body); }
      else if (sel.kind === "surface") inspectSurface(surfaceById(Array.from(sel.ids)[0]), head, body);
      else if (sel.kind === "screen") inspectScreen(screenById(Array.from(sel.ids)[0]), head, body);
      else inspectScene(head, body);
    } catch (err) { console.error("inspector", err); hint(body, "Something went wrong drawing this panel."); }
    const x = head.appendChild(h("button", "btn icon"));
    x.type = "button"; x.innerHTML = icon("x"); x.setAttribute("aria-label", "Hide panel"); x.dataset.tip = "Hide panel (I)";
    x.onclick = () => toggleInspector(false);
    body.scrollTop = scroll;
  }
  function toggleInspector(on) {
    if (on == null) on = document.body.classList.contains("ins-closed");
    document.body.classList.toggle("ins-closed", !on);
    animateStage();
    layoutViewport();
  }

  function captionDefault(w) {
    const m = { clock: w.opts.tz ? w.opts.tz.split("/").pop().replace(/_/g, " ") : "", date: "", text: "", calendar: "Month and year", weather: "City name" };
    return Object.prototype.hasOwnProperty.call(m, w.type) ? m[w.type] : T[w.type].name;
  }
  function tzChoices() {
    let list = SS.widgets.TZ_COMMON.slice(1);
    try { if (Intl.supportedValuesOf) list = Intl.supportedValuesOf("timeZone"); } catch (e) { /* keep the short list */ }
    const local = SS.widgets.localTZ();
    return [["", "Local" + (local ? " (" + local.replace(/_/g, " ") + ")" : "")]].concat(list.map(z => [z, z.replace(/_/g, " ")]));
  }
  function optionControl(s, w, o) {
    const tgt = o.in === "data" ? ((w.data && typeof w.data === "object") ? w.data : (w.data = {})) : w.opts;
    const val = tgt[o.key];
    const set = (v) => {
      hist.once("opt:" + w.id + o.key);
      tgt[o.key] = v;
      if (w.type === "weather" && o.key === "city") { delete w.opts.lat; delete w.opts.lon; delete w.opts.place; delete w.opts.geoFor; w.data = null; }
      rebuild(w);
    };
    if (o.type === "toggle") row(s, o.label, tgl(!!val, set));
    else if (o.type === "text") row(s, o.label, txt(val, o.placeholder, set, o.commit));
    else if (o.type === "textarea") {
      const a = h("textarea", "f-area"); a.value = val || ""; a.rows = 3; a.spellcheck = true;
      a.oninput = () => set(a.value);
      stack(s, o.label, a);
    } else if (o.type === "number") {
      const i = h("input", "f-input f-num"); i.type = "number"; i.min = o.min; i.max = o.max; i.value = val == null ? "" : val;
      i.onchange = () => { const v = clamp(+i.value || o.min || 0, o.min == null ? -1e9 : o.min, o.max == null ? 1e9 : o.max); i.value = v; set(v); };
      row(s, o.label, i);
    } else if (o.type === "select") row(s, o.label, selc(o.choices, val, set));
    else if (o.type === "seg") row(s, o.label, seg(o.choices, String(val), set));
    else if (o.type === "date") { const i = h("input", "f-input"); i.type = "date"; i.value = val || ""; i.onchange = () => set(i.value); row(s, o.label, i); }
    else if (o.type === "tz") row(s, o.label, selc(tzChoices(), val || "", set));
  }

  function inspectWidget(w, head, body) {
    const def = T[w.type], t = theme();
    const mode = w.surface ? "surface" : w.pin ? "pin" : "flat";
    headInto(head, def.icon, def.name, { flat: "Flat", pin: "In perspective", surface: "Snapped to a surface" }[mode]);

    const s1 = sec(body, "Content");
    row(s1, "Caption", tgl(w.title !== "", v => { hist.push(); if (v) delete w.title; else w.title = ""; rebuild(w); renderInspector(); }));
    if (w.title !== "") {
      const i = txt(w.title || "", captionDefault(w) || "Caption", v => { hist.once("cap" + w.id); if (v.trim()) w.title = v; else delete w.title; rebuild(w); });
      stack(s1, null, i);
      i.setAttribute("aria-label", "Caption text");
    }
    def.options.forEach(o => optionControl(s1, w, o));
    if (w.type === "weather") {
      const b = ibtn("Use my location", "location", () => {
        if (!navigator.geolocation) { toast("This browser can't share a location."); return; }
        navigator.geolocation.getCurrentPosition(p => {
          hist.push();
          Object.assign(w.opts, { city: "", lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), place: "Here", geoFor: "" });
          w.data = null; rebuild(w); renderInspector();
        }, () => toast("Location wasn't shared, so type a city instead."));
      });
      b.classList.add("block");
      s1.appendChild(b);
      hint(s1, "Forecasts come from Open-Meteo, refreshed every 30 minutes.");
    }

    const s2 = sec(body, "Placement");
    const pl = s2.appendChild(h("div", "placement"));
    [["flat", "Flat", "flat"], ["pin", "Perspective", "perspective"], ["surface", "Surface", "grid"]].forEach(([k, label, ic]) => {
      const b = pl.appendChild(h("button", mode === k ? "on" : ""));
      b.type = "button";
      b.innerHTML = icon(ic) + "<span>" + label + "</span>";
      b.setAttribute("aria-pressed", String(mode === k));
      if (k === "flat") b.onclick = () => setFlat(w);
      else if (k === "pin") b.onclick = () => { if (mode !== "pin") setPerspective(w); };
      else b.onclick = () => { if (mode !== "surface") toast(state.surfaces.length ? "Drag the widget onto a surface grid to snap it in." : "Draw a surface first: press G, then click the four corners of a wall or desk."); };
    });
    hint(s2, {
      flat: "Drag to move. Pull a corner to resize. Snapping guides keep things lined up; hold <b>Alt</b> to place freely.",
      pin: "Drag each round corner onto your scene: the edges of a wall, a screen, a table. Hold <b>Shift</b> to keep a corner level.",
      surface: "Sits in a grid cell. Drag the square handle to span more cells, or drag the widget off the grid to release it."
    }[mode]);

    const s3 = sec(body, "Text");
    const fonts = [["", "Theme (" + (SS.FONTS[t.font] || SS.FONTS.sans).label + ")"]].concat(Object.keys(SS.FONTS).map(k => [k, SS.FONTS[k].label]));
    row(s3, "Font", selc(fonts, w.font || "", v => { hist.push(); if (v) w.font = v; else delete w.font; restyle(w); }));
    row(s3, "Size", rng(35, 800, 5, Math.round(w.fs * 100), v => {
      hist.once("fs:" + w.id);
      const r = wRec.get(w.id);
      w.fs = v / 100; applyLook(r.el, w); place(w); drawOverlay(); save();
    }, v => v + "%"));
    const sw = h("div", "color-row");
    sw.appendChild(swatch(w.color, t.text, v => { hist.once("c:" + w.id); w.color = v; restyle(w); }, "Text colour"));
    sw.appendChild(h("span", "lbl2", "Text"));
    sw.appendChild(swatch(w.accent, t.accent, v => { hist.once("a:" + w.id); w.accent = v; restyle(w); }, "Accent colour"));
    sw.appendChild(h("span", "lbl2", "Accent"));
    row(s3, "Colour", sw);
    row(s3, "Glow", tgl(glowLevel(w, t) > 0, v => { hist.push(); if (v === (t.glow > 0)) delete w.glow; else w.glow = v; restyle(w); }));
    row(s3, "Align", seg([["left", "Left"], ["center", "Centre"], ["right", "Right"]], w.align || "left", v => {
      hist.push(); if (v === "left") delete w.align; else w.align = v; restyle(w);
    }));
    row(s3, "Style", seg([["", "Regular"], ["b", "Bold"], ["i", "Italic"]], w.bold ? "b" : w.italic ? "i" : "", v => {
      hist.push(); w.bold = v === "b"; w.italic = v === "i"; if (!w.bold) delete w.bold; if (!w.italic) delete w.italic; restyle(w);
    }));
    if (w.color || w.accent || w.font || w.glow != null || w.bold || w.italic || w.align) {
      const r = ibtn("Reset text style", "reset", () => { hist.push(); ["color", "accent", "font", "glow", "bold", "italic", "align"].forEach(k => delete w[k]); restyle(w); renderInspector(); });
      r.classList.add("block"); s3.appendChild(r);
    }

    const s4 = sec(body, "Panel");
    row(s4, "Backing", seg([["glass", "Glass"], ["solid", "Solid"], ["none", "None"]], w.panel || "glass", v => { hist.push(); w.panel = v; restyle(w); }));
    row(s4, "Blend", selc([["normal", "Normal"], ["soft", "Printed on"], ["overlay", "Painted on"], ["screen", "Projected light"], ["multiply", "Ink"]],
      w.blend || "normal", v => { hist.push(); if (v === "normal") delete w.blend; else w.blend = v; restyle(w); }));
    hint(s4, "Blend modes mix the text into the scene, so it reads as part of the wall rather than a sticker on top.");

    const s5 = sec(body, "Arrange");
    const g = s5.appendChild(h("div", "btn-grid"));
    g.appendChild(ibtn("Bring forward", "front", () => layer(true)));
    g.appendChild(ibtn("Send back", "back", () => layer(false)));
    g.appendChild(ibtn("Duplicate", "copy", duplicateSel));
    g.appendChild(ibtn("Delete", "trash", deleteSel, "danger"));
  }

  function inspectMulti(ws, head, body) {
    headInto(head, "layers", ws.length + " widgets", "Changes apply to all of them");
    const s0 = sec(body, "Align");
    const ir = s0.appendChild(h("div", "icon-row"));
    [["l", "alignL", "Align left"], ["ch", "alignCH", "Align centres"], ["r", "alignR", "Align right"],
     ["t", "alignT", "Align top"], ["cv", "alignCV", "Align middles"], ["b", "alignB", "Align bottom"]].forEach(([k, ic, label]) => {
      const b = ir.appendChild(h("button")); b.type = "button"; b.innerHTML = icon(ic); b.title = label; b.setAttribute("aria-label", label);
      b.onclick = () => align(k);
    });
    const ir2 = s0.appendChild(h("div", "btn-grid"));
    const dh = ir2.appendChild(ibtn("Space evenly ↔", "distH", () => align("dh")));
    const dv = ir2.appendChild(ibtn("Space evenly ↕", "distV", () => align("dv")));
    dh.disabled = dv.disabled = ws.length < 3;
    const s1 = sec(body, "Text");
    const t = theme();
    const fonts = [["", "Theme (" + (SS.FONTS[t.font] || SS.FONTS.sans).label + ")"]].concat(Object.keys(SS.FONTS).map(k => [k, SS.FONTS[k].label]));
    const same = ws.every(w => (w.font || "") === (ws[0].font || ""));
    row(s1, "Font", selc(fonts, same ? ws[0].font || "" : "", v => { hist.push(); ws.forEach(w => { if (v) w.font = v; else delete w.font; restyle(w); }); }));
    row(s1, "Size", [
      ibtn("Smaller", "minus", () => { hist.once("msz"); ws.forEach(w => { w.fs = clamp(w.fs / 1.1, 0.35, 14); restyle(w, true); }); }),
      ibtn("Bigger", "plus", () => { hist.once("msz"); ws.forEach(w => { w.fs = clamp(w.fs * 1.1, 0.35, 14); restyle(w, true); }); })]);
    const sw = h("div", "color-row");
    sw.appendChild(swatch(ws[0].color, t.text, v => { hist.once("mc"); ws.forEach(w => { w.color = v; restyle(w); }); }, "Text colour"));
    sw.appendChild(h("span", "lbl2", "Text"));
    sw.appendChild(swatch(ws[0].accent, t.accent, v => { hist.once("ma"); ws.forEach(w => { w.accent = v; restyle(w); }); }, "Accent colour"));
    sw.appendChild(h("span", "lbl2", "Accent"));
    row(s1, "Colour", sw);
    const s2 = sec(body, "Panel");
    row(s2, "Backing", seg([["glass", "Glass"], ["solid", "Solid"], ["none", "None"]], ws.every(w => (w.panel || "glass") === (ws[0].panel || "glass")) ? ws[0].panel || "glass" : "",
      v => { hist.push(); ws.forEach(w => { w.panel = v; restyle(w); }); }));
    const s3 = sec(body, "Arrange");
    const g = s3.appendChild(h("div", "btn-grid"));
    g.appendChild(ibtn("Bring forward", "front", () => layer(true)));
    g.appendChild(ibtn("Send back", "back", () => layer(false)));
    g.appendChild(ibtn("Duplicate", "copy", duplicateSel));
    g.appendChild(ibtn("Delete", "trash", deleteSel, "danger"));
  }

  function inspectSurface(s, head, body) {
    if (!s) return;
    const n = state.widgets.filter(w => w.surface && w.surface.id === s.id).length;
    headInto(head, "grid", "Surface", s.cols + " × " + s.rows + " grid · " + n + " widget" + (n === 1 ? "" : "s"));
    const s1 = sec(body, "Grid");
    const upd = () => { reflowSurface(s); drawSurfaces(); drawOverlay(); save(); };
    row(s1, "Columns", rng(1, 10, 1, s.cols, v => { hist.once("cols" + s.id); s.cols = v; upd(); head.querySelector("p").textContent = s.cols + " × " + s.rows + " grid"; }));
    row(s1, "Rows", rng(1, 10, 1, s.rows, v => { hist.once("rows" + s.id); s.rows = v; upd(); head.querySelector("p").textContent = s.cols + " × " + s.rows + " grid"; }));
    row(s1, "Gap", rng(0, 40, 1, Math.round((s.gap || 0) * 100), v => { hist.once("gap" + s.id); s.gap = v / 100; upd(); }, v => v + "%"));
    row(s1, "Widgets", seg([["fit", "Fit inside"], ["fill", "Fill cell"]], s.fit || "fit", v => { hist.push(); s.fit = v; upd(); }));
    hint(s1, "Drag the corners to match a flat surface in your scene. Then drag widgets onto it and they settle into the grid, in perspective. <b>Fill cell</b> stretches them to the cell's shape.");
    const s2 = sec(body, null);
    s2.appendChild(ibtn("Delete surface", "trash", deleteSel, "danger block"));
  }

  function inspectScreen(s, head, body) {
    if (!s) return;
    const four = s.pts.length === 4 && G.isConvex(G.orderQuad(s.pts));
    headInto(head, "screen", "Screen", s.pts.length + " corners · " + (four ? "true perspective" : "flat clip"));
    const src = s.src || { kind: "none" };
    const kind = src.kind === "video" || src.kind === "image" ? "link" : src.kind === "missing" ? "file" : src.kind;
    const s1 = sec(body, "Source");
    const setSrc = (next) => { hist.push(); s.src = next; renderScreen(s); commit(); };
    stack(s1, null, seg([["none", "None"], ["youtube", "YouTube", "video"], ["link", "Link", "link"], ["file", "File", "upload"]], kind, v => {
      if (v === kind) return;
      if (v === "none") setSrc({ kind: "none" });
      else if (v === "file") pickFile("video/*,image/*", async f => { const ref = await storeFile(f); if (ref) setSrc({ kind: "file", ref, name: f.name, type: f.type }); else renderInspector(); });
      else { s.src = { kind: v === "youtube" ? "youtube" : "video", url: "" }; renderScreen(s); renderInspector(); }
    }));
    if (kind === "youtube") {
      stack(s1, "YouTube link", urlRow(src.url, "https://youtu.be/…", v => {
        if (v && !store.youtubeId(v)) { toast("That doesn't look like a YouTube link."); return; }
        setSrc({ kind: "youtube", url: v });
      }));
      if (location.protocol === "file:") hint(s1, "YouTube won't play on a page opened straight from a file (error 153). Use the hosted site, or run <code>python -m http.server</code> in this folder and open <code>localhost:8000</code>.", "warn");
    } else if (kind === "link") {
      stack(s1, "Video or image link", urlRow(src.url, "https://…/clip.mp4", v => {
        if (!v) { setSrc({ kind: "none" }); return; }
        setSrc({ kind: store.isDirectVideo(v) ? "video" : "image", url: v });
      }));
      hint(s1, "A direct link to an .mp4 or .webm file, or to an image.");
    } else if (kind === "file") {
      s1.appendChild(ibtn(src.name ? "Replace “" + src.name + "”" : "Choose a file…", "upload", () =>
        pickFile("video/*,image/*", async f => { const ref = await storeFile(f); if (ref) setSrc({ kind: "file", ref, name: f.name, type: f.type }); }), "block"));
      hint(s1, "Stored in this browser, so it's still here after a reload. It isn't included in share links.");
    } else hint(s1, "Show a video or an image through this opening.");

    const isVid = src.kind === "youtube" || src.kind === "video" || (src.kind === "file" && /^video\//.test(src.type || ""));
    const s2 = sec(body, "Display");
    row(s2, "Fit", seg([["cover", "Fill"], ["contain", "Whole frame"]], s.fit || "cover", v => { hist.push(); s.fit = v; renderScreen(s); save(); }));
    if (isVid) {
      row(s2, "Player controls", tgl(!!s.controls, v => { hist.push(); s.controls = v; renderScreen(s); save(); }));
      row(s2, "Sound", tgl(s.muted === false, v => {
        hist.push(); s.muted = !v; renderScreen(s); save();
        const r = sRec.get(s.id), vid = r && r.mediaEl && r.mediaEl.querySelector("video");
        if (vid && v) { vid.muted = false; vid.play().catch(() => {}); }
      }));
      hint(s2, "Controls show while the dashboard is in view mode. Without them, click the video to pause.");
    }
    const s3 = sec(body, "Shape");
    hint(s3, four ? "Four corners, so the content is warped into true perspective."
                  : "With " + s.pts.length + " corners the content is clipped flat. Four corners give true perspective.");
    if (!four) s3.appendChild(ibtn("Use 4 corners", "perspective", () => fourCorners(s), "block"));
    hint(s3, "Drag a point to reshape. Drag a small dot on an edge to add a corner. <b>Alt-click</b> a point to remove it.");
    const s4 = sec(body, null);
    const g = s4.appendChild(h("div", "btn-grid"));
    g.appendChild(ibtn("Duplicate", "copy", duplicateSel));
    g.appendChild(ibtn("Delete", "trash", deleteSel, "danger"));
  }

  const thumbCache = {};
  function sceneThumb(id) {
    const k = id + ":" + state.theme;
    if (!thumbCache[k]) {
      const c = document.createElement("canvas");
      c.width = 160; c.height = 100;
      SS.scenes.draw(id, c, 160, 100, theme());
      thumbCache[k] = c.toDataURL();
    }
    return thumbCache[k];
  }
  const SHAPES = [["16:9", 1920, 1080], ["16:10", 1920, 1200], ["21:9", 2560, 1080], ["32:9", 3840, 1080], ["4:3", 1600, 1200], ["1:1", 1440, 1440], ["9:16", 1080, 1920], ["10:16", 1200, 1920]];

  function inspectScene(head, body) {
    headInto(head, "palette", "Scene", "Nothing selected. Click a widget to edit it.");
    const b = state.backdrop, t = theme();

    const s0 = sec(body, "Layout");
    row(s0, "Name", txt(state.name, "Untitled layout", v => { state.name = v; save(); }));
    const gal = ibtn("Browse starter scenes", "layers", () => openGallery(false), "block");
    s0.appendChild(gal);
    gal.style.marginBottom = "10px";

    const s1 = sec(body, "Theme");
    const tg = s1.appendChild(h("div", "themes"));
    Object.keys(SS.THEMES).forEach(k => {
      const th = SS.THEMES[k];
      const c = tg.appendChild(h("button", "theme-chip" + (k === state.theme ? " on" : "")));
      c.type = "button"; c.setAttribute("aria-pressed", String(k === state.theme));
      const swd = c.appendChild(h("div", "sw"));
      const tint = th.tint || [th.accent, th.solid, th.base];
      swd.style.background = "radial-gradient(circle at 20% 30%, " + alpha(tint[0], 0.9) + ", transparent 70%), radial-gradient(circle at 85% 70%, " + alpha(tint[1], 0.8) + ", transparent 70%), " + th.base;
      const dot = swd.appendChild(h("i")); dot.style.background = th.accent;
      const aa = swd.appendChild(h("span", "aa", "Aa"));
      aa.style.color = th.text; aa.style.fontFamily = (SS.FONTS[th.font] || SS.FONTS.sans).css;
      c.appendChild(h("span", null, th.label));
      c.onclick = () => {
        if (k === state.theme) return;
        hist.push();
        const keep = {};
        state.widgets.forEach(w => { if (w.pin && !w.surface) keep[w.id] = quadOf(w); });
        state.theme = k;
        if (state.backdrop.kind === "scene") delete state.backdrop.scene;
        applyTheme(); renderBackdrop(); renderWidgets();
        state.widgets.forEach(w => { if (keep[w.id]) { const r = wRec.get(w.id); w.pin = keep[w.id]; w.pinBase = [r.bw, r.bh]; place(w); } });
        commit();
      };
    });

    const s2 = sec(body, "Background");
    const sp = s2.appendChild(h("div", "scenes-pick"));
    Object.keys(SS.scenes.list).forEach(id => {
      const on = b.kind === "scene" && sceneId() === id;
      const c = sp.appendChild(h("button", "scene-chip" + (on ? " on" : "")));
      c.type = "button"; c.setAttribute("aria-pressed", String(on));
      const th = c.appendChild(h("div", "thumb"));
      th.style.backgroundImage = "url(" + sceneThumb(id) + ")";
      c.appendChild(h("span", null, SS.scenes.list[id].label));
      c.onclick = () => { hist.push(); state.backdrop = { kind: "scene", scene: id === t.scene ? undefined : id }; renderBackdrop(); commit(); };
    });
    const ph = sp.appendChild(h("button", "scene-chip" + (b.kind === "image" ? " on" : "")));
    ph.type = "button";
    const pth = ph.appendChild(h("div", "thumb"));
    if (b.kind === "image" && b.src) {
      const u = media.isRef(b.src) ? media.url(b.src) : b.src;
      if (u) pth.style.backgroundImage = 'url("' + u + '")';
    } else pth.innerHTML = icon("image");
    ph.appendChild(h("span", null, b.kind === "image" ? "Your photo" : "Photo"));
    ph.onclick = () => pickFile("image/*", async f => {
      const ref = await storeFile(f);
      if (!ref) return;
      hist.push();
      state.backdrop = { kind: "image", src: ref, name: f.name, x: 50, y: 50 };
      renderBackdrop(); commit();
      coachOnce("photo", "Tip: select a widget and choose Perspective to pin it onto a surface in your photo.");
    });
    const vd = sp.appendChild(h("button", "scene-chip" + (b.kind === "video" ? " on" : "")));
    vd.type = "button";
    const vth = vd.appendChild(h("div", "thumb")); vth.innerHTML = icon("video");
    vd.appendChild(h("span", null, "YouTube"));
    vd.onclick = () => { const i = s2.querySelector(".yt-in input"); if (i) i.focus(); };

    if (b.kind === "image") {
      row(s2, "Focus across", rng(0, 100, 1, b.x == null ? 50 : b.x, v => { hist.once("bx"); b.x = v; positionBackdrop(); save(); }, v => v + "%"));
      row(s2, "Focus up/down", rng(0, 100, 1, b.y == null ? 50 : b.y, v => { hist.once("by"); b.y = v; positionBackdrop(); save(); }, v => v + "%"));
    }
    const il = stack(s2, "Image link", urlRow(b.kind === "image" && !media.isRef(b.src) && (b.src || "").indexOf("data:") !== 0 ? b.src : "", "https://…/photo.jpg", v => {
      if (!v) return;
      hist.push(); state.backdrop = { kind: "image", src: v, x: 50, y: 50 }; renderBackdrop(); commit();
    }));
    il.style.marginTop = "4px";
    const yt = stack(s2, "YouTube background", urlRow(b.kind === "video" ? b.url : "", "https://youtu.be/…", v => {
      if (!v) return;
      if (!store.youtubeId(v)) { toast("That doesn't look like a YouTube link."); return; }
      hist.push(); state.backdrop = { kind: "video", url: v, fit: "cover", x: 50, y: 50, muted: true }; renderBackdrop(); commit();
    }));
    yt.classList.add("yt-in");
    if (b.kind === "video") {
      row(s2, "Fit", seg([["cover", "Fill"], ["contain", "Whole frame"]], b.fit || "cover", v => { hist.push(); b.fit = v; positionBackdrop(); save(); }));
      row(s2, "Across", rng(0, 100, 1, b.x == null ? 50 : b.x, v => { hist.once("vx"); b.x = v; positionBackdrop(); save(); }, v => v + "%"));
      row(s2, "Up/down", rng(0, 100, 1, b.y == null ? 50 : b.y, v => { hist.once("vy"); b.y = v; positionBackdrop(); save(); }, v => v + "%"));
      row(s2, "Sound", tgl(b.muted === false, v => { hist.push(); b.muted = !v; renderBackdrop(); save(); }));
      if (location.protocol === "file:") hint(s2, "YouTube won't play on a page opened straight from a file. Use the hosted site or a local web server.", "warn");
    }
    if (b.kind !== "scene") s2.appendChild(ibtn("Back to the theme's scene", "reset", () => { hist.push(); state.backdrop = { kind: "scene" }; renderBackdrop(); commit(); }, "block"));

    const s3 = sec(body, "Widget panels");
    const st = state.style;
    const styleUpd = () => { applyTheme(); save(); };
    row(s3, "Glass", rng(0, 90, 1, Math.round(st.glass * 100), v => { hist.once("glass"); st.glass = v / 100; styleUpd(); }, v => v + "%"));
    row(s3, "Blur", rng(0, 40, 1, st.blur, v => { hist.once("blur"); st.blur = v; styleUpd(); }, v => v + "px"));
    row(s3, "Corners", rng(0, 36, 1, st.radius, v => { hist.once("radius"); st.radius = v; styleUpd(); }, v => v + "px"));
    row(s3, "Readable text", tgl(!!st.legible, v => { hist.push(); st.legible = v; styleUpd(); }));
    hint(s3, "Readable text adds a soft shadow behind every widget's text, for busy photos.");

    const s4 = sec(body, "Canvas");
    const C = state.canvas;
    const cur = SHAPES.find(x => x[1] === C.w && x[2] === C.h);
    const shapeChoices = [["", cur ? cur[0] + " · " + C.w + "×" + C.h : "Custom · " + C.w + "×" + C.h]]
      .concat(SHAPES.filter(x => x !== cur).map(x => [x[0], x[0] + " · " + x[1] + "×" + x[2]]));
    row(s4, "Shape", selc(shapeChoices, "", v => { const x = SHAPES.find(q => q[0] === v); if (x) { setCanvas(x[1], x[2]); toast("Canvas is now " + x[0] + ". Everything was scaled to match."); } }));
    row(s4, "On screen", seg([["fit", "Fit"], ["fill", "Fill"]], C.fit || "fit", v => { hist.push(); C.fit = v; layoutViewport(); save(); }));
    const mw = ibtn("Match this window (" + innerWidth + "×" + innerHeight + ")", "expand", () => { setCanvas(innerWidth, innerHeight); }, "block");
    s4.appendChild(mw);
    hint(s4, "The layout is drawn on a fixed canvas and scaled to any screen, so it never falls apart. <b>Fit</b> shows all of it; <b>Fill</b> crops to cover the screen.");

    const s5 = sec(body, "Privacy shade");
    row(s5, "Shade", seg([["frost", "Frosted"], ["image", "Image"]], state.privacy.image ? "image" : "frost", v => {
      if (v === "frost") { hist.push(); state.privacy.image = null; save(); renderInspector(); }
      else pickFile("image/*", async f => { const ref = await storeFile(f); if (ref) { hist.push(); state.privacy.image = ref; save(); } renderInspector(); });
    }));
    const tryShade = ibtn("Try it", "lock", () => setShade(true), "block");
    s5.appendChild(tryShade);
    hint(s5, "Press <b>P</b> to slide a shade over the dashboard when someone walks up. Press it again to reveal.");

    const s6 = sec(body, "Save and share");
    const g = s6.appendChild(h("div", "btn-grid"));
    g.appendChild(ibtn("Share link", "share", openShare));
    g.appendChild(ibtn("Back up", "download", exportFile));
    g.appendChild(ibtn("Restore", "upload", () => pickFile("application/json,.json", importFile)));
    g.appendChild(ibtn("Start over", "reset", () => openGallery(false)));
    hint(s6, "Everything saves automatically in this browser. A share link carries the layout without your personal notes; a backup file carries everything.");
  }

  /* ======================= wiring ======================= */
  $("#dAdd").onclick = openCatalog;
  $("#dSurface").onclick = () => startTool("surface");
  $("#dScreen").onclick = () => startTool("screen");
  $("#dScenes").onclick = () => openGallery(false);
  $("#dUndo").onclick = () => hist.undo();
  $("#dRedo").onclick = () => hist.redo();
  $("#dHelp").onclick = openHelp;
  $("#dDone").onclick = () => setEditing(false);
  $("#vEdit").onclick = () => setEditing(true);
  $("#vScenes").onclick = () => openGallery(false);
  $("#vShade").onclick = () => setShade(true);
  $("#vFull").onclick = toggleFullscreen;
  $("#shadeOff").onclick = () => setShade(false);
  $("#modeCancel").onclick = () => endTool();
  $("#modeDone").onclick = () => { if (tool && tool.pts.length >= 3) finishTool(tool.pts); };
  $("#insToggle").innerHTML = icon("sliders");
  $("#insToggle").onclick = () => toggleInspector(true);

  document.addEventListener("keydown", (e) => {
    const typing = isTyping(e.target);
    const k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      if (closeTopModal()) return;
      if (pop) { closePop(); return; }
      if (typing) { e.target.blur(); return; }
      if (tool) { endTool(); return; }
      if (sel.kind) { select(null); return; }
      if (editing) setEditing(false);
      return;
    }
    if (typing || e.isComposing) return;
    if (modals.length) return;
    if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return; }
    if (mod && k === "y") { e.preventDefault(); hist.redo(); return; }
    if (tool) {
      if (e.key === "Enter" && tool.kind === "screen" && tool.pts.length >= 3) { e.preventDefault(); finishTool(tool.pts); }
      else if (e.key === "Backspace" && tool.pts.length) { e.preventDefault(); tool.pts.pop(); updateModebar(); drawOverlay(); }
      return;
    }
    if (!mod && !e.altKey) {
      if (k === "e") { e.preventDefault(); setEditing(!editing); return; }
      if (k === "p") { e.preventDefault(); setShade(!shadeOn()); return; }
      if (k === "f") { e.preventDefault(); toggleFullscreen(); return; }
      if (e.key === "?") { e.preventDefault(); openHelp(); return; }
    }
    if (shadeOn()) return;
    if (mod && !editing) return;
    if (mod && k === "a") { e.preventDefault(); if (!editing) setEditing(true); select("widget", state.widgets.map(w => w.id)); return; }
    if (!editing) return;
    if (mod && k === "c") { copySel(); return; }
    if (mod && k === "v") { e.preventDefault(); pasteClip(); return; }
    if (mod && k === "d") { e.preventDefault(); duplicateSel(); return; }
    if (mod) return;
    if (k === "a" && !e.shiftKey) { e.preventDefault(); openCatalog(); return; }
    if (k === "g") { e.preventDefault(); startTool("surface"); return; }
    if (k === "s") { e.preventDefault(); startTool("screen"); return; }
    if (k === "i") { e.preventDefault(); toggleInspector(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); return; }
    if (e.key === "]") { layer(true); return; }
    if (e.key === "[") { layer(false); return; }
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-step, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); nudge(step, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); nudge(0, -step); }
    else if (e.key === "ArrowDown") { e.preventDefault(); nudge(0, step); }
  });

  let rzT = 0;
  window.addEventListener("resize", () => {
    layoutViewport();
    clearTimeout(rzT);
    rzT = setTimeout(() => { if (editing && !sel.kind) renderInspector(); if (pop) closePop(); }, 250);
  });
  window.addEventListener("hashchange", () => { checkShareHash(); });
  window.addEventListener("storage", (e) => {
    // another tab changed the layout: follow it rather than overwrite it later
    if (e.key === store.KEY && e.newValue && !editing) {
      try { const next = JSON.parse(e.newValue); if (next && next.v === 2) { state = store.normalize(next); rebuildAll(); } } catch (err) { /* ignore */ }
    }
  });

  // one ticker drives every clock and timer
  setInterval(() => {
    if (!state) return;
    const now = new Date();
    let status = null;
    wRec.forEach((r, id) => {
      const inst = r.inst;
      if (!inst) return;
      if (inst.tick) { try { if (inst.tick(now)) requestPlace(id); } catch (e) { /* keep ticking the rest */ } }
      if (!status && inst.status) status = inst.status();
    });
    const base = state.name && state.name !== "Untitled layout" ? state.name + " · Second Screen" : "Second Screen";
    const title = status ? status + " · " + base : base;
    if (document.title !== title && !params.has("test")) document.title = title;
  }, 1000);

  /* ======================= boot ======================= */
  function fontsReady(ms) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const fam = (SS.FONTS[theme().font] || SS.FONTS.sans).css.split(",")[0].replace(/'/g, "");
    const loads = ["300", "400", "600"].map(wt => document.fonts.load(wt + " 16px '" + fam + "'").catch(() => {}))
      .concat([document.fonts.load("500 13px 'Inter'").catch(() => {})]);
    return Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, ms))]);
  }

  let bootCanvas = "";
  // a dashboard lives full screen, so new layouts take the monitor's shape
  function defaultCanvas() {
    const fixed = /^(\d{3,4})x(\d{3,4})$/.exec(params.get("canvas") || "");
    if (fixed) return [+fixed[1], +fixed[2]];
    const sw = (window.screen && screen.width) || 0, sh = (window.screen && screen.height) || 0;
    if (params.get("canvas") !== "window" && sw >= innerWidth && sh >= innerHeight && sw > 0) return [sw, sh];
    return [innerWidth, innerHeight];
  }

  async function boot() {
    let s = store.load(), fresh = false;
    const tp = params.get("template");
    const tpl = tp && SS.templates.find(x => x.id === tp);
    const dc = defaultCanvas();
    if (tpl) s = tpl.build(dc[0], dc[1]);
    if (!s) { s = SS.templates[0].build(dc[0], dc[1]); fresh = true; }
    state = store.normalize(s);
    bootCanvas = state.canvas.w + "x" + state.canvas.h;
    const migrated = !!state.migrated;
    if (migrated) { await store.internalize(state); delete state.migrated; }
    applyTheme();
    layoutViewport();
    renderBackdrop(true);
    await fontsReady(1500);
    renderWidgets();
    renderScreens();
    drawSurfaces();
    save();
    syncUndo();
    if (document.fonts) document.fonts.addEventListener("loadingdone", () => placeAll());
    setEditing(params.get("edit") === "1");
    if (params.has("select") && state.widgets.length) {
      const v = params.get("select");
      if (v === "all") select("widget", state.widgets.map(w => w.id));
      else if (v === "screen" && state.screens.length) select("screen", [state.screens[0].id]);
      else select("widget", [state.widgets[+v || 0].id]);
    }
    if (params.get("perspective") === "1" && sel.kind === "widget") setPerspective(selWidgets()[0]);
    if (migrated) toast("Your layout from the earlier version was carried over.");
    const shared = await checkShareHash();
    const shot = params.get("open");
    if (shot === "gallery") openGallery(true);
    else if (shot === "catalog") openCatalog();
    else if (shot === "help") openHelp();
    else if (fresh && !shared && !params.has("test")) openGallery(true);
    if (!params.has("test")) setTimeout(() => media.gc(store.refsIn(state)), 4000);
    document.body.classList.add("ready");
    if (params.has("test")) runTests();
  }

  /* ======================= self test (?test) ======================= */
  async function runTests() {
    const out = [], fail = [];
    const errors = [];
    window.addEventListener("error", (e) => errors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + String(e.reason)));
    const pre0 = $("#test-out");
    pre0.hidden = false;
    const ok = (cond, name) => { (cond ? out : fail).push(name); pre0.textContent = "RUNNING " + out.length + "/" + fail.length + " last: " + name + "\n" + fail.join("\n"); };
    const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
    const flush = () => { const ids = Array.from(placeQ); placeQ.clear(); ids.forEach(i => { const w = byId(i); if (w) place(w); }); };
    const tick = () => new Promise(r => { flush(); setTimeout(() => { flush(); r(); }, 20); });
    try {
      // geometry
      const q = [[10, 20], [300, 40], [30, 260], [320, 300]];
      const Hm = G.rectToQuad(100, 50, q);
      const c = [[0, 0], [100, 0], [0, 50], [100, 50]].map(p => G.apply(Hm, p[0], p[1]));
      ok(c.every((p, i) => near(p[0], q[i][0], 1e-6) && near(p[1], q[i][1], 1e-6)), "homography maps rect corners onto the quad");
      const uv = G.uv(q, ...G.apply(G.rectToQuad(1, 1, q), 0.3, 0.7));
      ok(near(uv[0], 0.3, 1e-9) && near(uv[1], 0.7, 1e-9), "uv round trip");
      const oq = G.orderQuad([q[3], q[0], q[2], q[1]]);
      ok(oq.every((p, i) => p === q[i]), "orderQuad recovers TL TR BL BR");
      ok(G.isConvex(q) && !G.isConvex([[0, 0], [10, 0], [10, 10], [0, 10]]), "convexity test");

      // every template, landscape and portrait
      const sizes = [[state.canvas.w, state.canvas.h], [1080, 1920], [2560, 1080]];
      for (const size of sizes) for (const t0 of SS.templates) {
        state.canvas.w = size[0]; state.canvas.h = size[1];
        const t = { id: t0.id + "@" + size.join("x"), name: t0.name, build: t0.build };
        applyTemplate(t);
        await tick();
        const n = state.widgets.length;
        ok(wRec.size === n, t.id + ": all " + n + " widgets rendered");
        ok(state.widgets.every(w => !w.anchor && !w.place), t.id + ": anchors resolved");
        ok(!widgetsLayer.textContent.includes("hit a snag"), t.id + ": no widget errors");
        ok(state.widgets.every(w => { const r = wRec.get(w.id); return r.bw > 10 && r.bh > 10; }), t.id + ": widgets have size");
        ok(state.widgets.every(w => !w.pin || G.isConvex(w.pin)), t.id + ": pins are convex");
        const C = state.canvas;
        ok(state.widgets.every(w => { const b = G.bbox(quadOf(w)); return b.x > -5 && b.y > -5 && b.x + b.w < C.w + 5 && b.y + b.h < C.h + 5; }), t.id + ": everything on canvas");
        // overlaps between flat widgets are a layout bug
        const boxes = state.widgets.map(w => G.bbox(quadOf(w)));
        let overlap = null;
        boxes.forEach((a, i) => boxes.forEach((b, j) => {
          if (j <= i || state.widgets[i].pin || state.widgets[j].pin) return;
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix > 4 && iy > 4) overlap = state.widgets[i].type + "/" + state.widgets[j].type;
        }));
        ok(!overlap, t.id + ": no overlapping widgets" + (overlap ? " (" + overlap + ")" : ""));
      }
      applyTemplate(SS.templates.find(t => t.id === "blank"));
      setEditing(true);
      Object.keys(T).forEach(k => addWidget(k));
      await tick();
      ok(state.widgets.length === Object.keys(T).length && wRec.size === state.widgets.length, "every widget type adds and renders");
      ok(!widgetsLayer.textContent.includes("hit a snag"), "no widget type errors");
      state.widgets.forEach(w => { select("widget", [w.id]); });
      ok(!ins.textContent.includes("went wrong"), "inspector renders for a widget");
      const w0 = state.widgets[0];
      select("widget", [w0.id]);
      const before = quadOf(w0);
      setPerspective(w0);
      ok(!!w0.pin && quadOf(w0).every((p, i) => near(p[0], before[i][0], 0.5) && near(p[1], before[i][1], 0.5)), "perspective keeps the widget in place");
      w0.pin[1] = [w0.pin[1][0] + 40, w0.pin[1][1] - 30]; place(w0);
      ok(near(quadOf(w0)[1][0], w0.pin[1][0], 0.5), "pinned corner follows the pin");
      setFlat(w0);
      ok(!w0.pin && !w0.surface, "flatten clears perspective");
      // surface + snapping
      tool = { kind: "surface", pts: [] };
      finishTool([[200, 200], [900, 180], [220, 700], [880, 760]]);
      const s = state.surfaces[0];
      ok(!!s && s.cols >= 1 && s.rows >= 1, "surface created with a grid");
      w0.surface = { id: s.id, c0: 0, r0: 0, c1: 0, r1: 0 }; place(w0);
      const cq = quadOf(w0), cell = G.uvRect(s.quad, 0, 1 / s.cols, 0, 1 / s.rows);
      const cellPoly = G.cyc(cell);
      ok(wRec.get(w0.id).H != null && cq.every(p => G.pointInPoly(G.centroid([p, G.centroid(cell)]), cellPoly)), "widget snaps into a surface cell");
      select("surface", [s.id]);
      ok(!ins.textContent.includes("went wrong"), "inspector renders for a surface");
      select("widget", state.widgets.slice(0, 3).map(w => w.id));
      ok(!ins.textContent.includes("went wrong"), "inspector renders for several widgets");
      // screens
      tool = { kind: "screen", pts: [] };
      finishTool([[1000, 100], [1400, 120], [1380, 400], [1010, 380]]);
      const sc = state.screens[state.screens.length - 1];
      ok(/matrix3d/.test(sRec.get(sc.id).el.style.transform), "four-corner screen is warped");
      tool = { kind: "screen", pts: [] };
      finishTool([[100, 600], [300, 580], [360, 700], [200, 820], [80, 760]]);
      const sc2 = state.screens[state.screens.length - 1];
      ok(/polygon/.test(sRec.get(sc2.id).el.style.clipPath), "five-corner screen is clipped");
      select("screen", [sc.id]);
      ok(!ins.textContent.includes("went wrong"), "inspector renders for a screen");
      sc.src = { kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }; renderScreen(sc);
      ok(!!sRec.get(sc.id).el.querySelector("iframe"), "youtube source builds an embed");
      const ifr = sRec.get(sc.id).el.querySelector("iframe");
      renderScreen(sc);
      ok(sRec.get(sc.id).el.querySelector("iframe") === ifr, "redraw keeps the same player (no restart)");
      select(null);
      ok(!ins.textContent.includes("went wrong"), "inspector renders for the scene");
      // undo / redo
      const n0 = state.widgets.length;
      addWidget("clock");
      hist.undo();
      ok(state.widgets.length === n0, "undo removes the added widget");
      hist.redo();
      ok(state.widgets.length === n0 + 1, "redo puts it back");
      // share round trip
      const tasks = state.widgets.find(w => w.type === "tasks");
      tasks.data = [{ text: "private", done: false }];
      const { token } = await store.encodeShare(state);
      const back = store.normalize(await store.decodeShare(token));
      ok(back.widgets.length === state.widgets.length && back.screens.length === state.screens.length, "share link round trip keeps the layout");
      ok(!JSON.stringify(back).includes("private"), "share link leaves out personal content");
      // v1 migration
      const v1 = { widgets: [{ id: "a1", type: "clock", x: 40, y: 50 }, { id: "a2", type: "tasks", x: 300, y: 80, data: [{ text: "x", done: false }], warped: true, quad: [[0, 0], [200, 10], [0, 150], [210, 160]], baseW: 200, baseH: 150 }],
                   zones: [{ id: "z1", quad: [[500, 100], [900, 100], [500, 400], [900, 400]] }], openings: [{ id: "o1", pts: [[10, 10], [100, 10], [100, 80], [10, 80]], src: "https://youtu.be/dQw4w9WgXcQ" }],
                   theme: "cyberpunk", designW: 1440, designH: 900, opacity: 30, blur: 10 };
      const m = store.normalize(store.migrateV1(v1));
      ok(m.widgets.length === 2 && m.widgets[1].pin && m.surfaces.length === 1 && m.screens[0].src.kind === "youtube" && m.theme === "synthwave", "v1 layouts migrate");
      hist.push(); swapState(m); await tick();
      ok(wRec.size === 2, "migrated layout renders");
      // canvas reshape
      setCanvas(1080, 1920);
      ok(state.canvas.w === 1080 && state.canvas.h === 1920 && wRec.size === 2, "canvas reshape rescales the layout");
      // real pointer and keyboard input, the way a person drives it
      const fire = (el, type, x, y, extra) => el.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0, isPrimary: true, pointerType: "mouse" }, extra || {})));
      const dragOn = async (el, x0, y0, x1, y1, extra) => {
        fire(el, "pointerdown", x0, y0, extra);
        for (let i = 1; i <= 6; i++) fire(document, "pointermove", x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, extra);
        fire(document, "pointerup", x1, y1, extra);
        await tick();
      };
      const key = (k, extra) => document.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
      applyTemplate(SS.templates.find(t => t.id === "desk"));
      setEditing(true); await tick();
      const dw = state.widgets.find(w => w.type === "focus");
      const c0 = toScreen(centerOf(dw)), x0 = dw.x;
      await dragOn(wRec.get(dw.id).el, c0[0], c0[1], c0[0] + 120, c0[1] + 40, { altKey: true });
      ok(Math.abs(dw.x - x0 - 120 / V.k) < 2, "dragging a widget moves it");
      ok(sel.kind === "widget" && sel.ids.has(dw.id), "dragging selects the widget");
      const fs0 = dw.fs, br = handlesLayer.querySelector(".hd-corner:nth-of-type(4)") || Array.from(handlesLayer.querySelectorAll(".hd-corner"))[3];
      const bp = [parseFloat(br.style.left), parseFloat(br.style.top)];
      await dragOn(br, bp[0], bp[1], bp[0] + 80, bp[1] + 30);
      ok(dw.fs > fs0 * 1.05, "pulling a corner resizes the widget");
      key("z", { ctrlKey: true });
      ok(Math.abs(byId(dw.id).fs - fs0) < 1e-6, "Ctrl+Z undoes the resize");
      const dw2 = byId(dw.id);
      select("widget", [dw2.id]);
      setPerspective(dw2); await tick();
      const pins = handlesLayer.querySelectorAll(".hd-pin");
      ok(pins.length === 4, "perspective shows four corner pins");
      const pp = [parseFloat(pins[1].style.left), parseFloat(pins[1].style.top)];
      const before1 = dw2.pin[1].slice();
      await dragOn(pins[1], pp[0], pp[1], pp[0] + 30, pp[1] - 40);
      ok(dw2.pin && Math.abs(dw2.pin[1][1] - before1[1]) > 10, "dragging a pin warps the widget");
      // draw a surface by clicking four corners, then drop a widget into it
      key("g");
      ok(!!tool && tool.kind === "surface", "G starts the surface tool");
      const corners = [[260, 420], [760, 400], [270, 760], [770, 790]];
      for (const p of corners) { const s = toScreen(p); fire(stage, "pointerdown", s[0], s[1]); fire(document, "pointerup", s[0], s[1]); }
      await tick();
      const sf = state.surfaces[state.surfaces.length - 1];
      ok(!!sf && !tool && sel.kind === "surface", "four clicks make a surface");
      const tw = state.widgets.find(w => w.type === "tasks");
      select("widget", [tw.id]);
      const tc = toScreen(centerOf(tw)), target = toScreen(G.centroid(sf.quad));
      await dragOn(wRec.get(tw.id).el, tc[0], tc[1], target[0], target[1]);
      ok(tw.surface && tw.surface.id === sf.id, "dropping a widget on a surface snaps it in");
      ok(!!handlesLayer.querySelector(".hd-span"), "a snapped widget shows the span handle");
      // marquee select on empty canvas
      select(null);
      const a = toScreen([20, 20]), bb = toScreen([state.canvas.w * 0.6, state.canvas.h * 0.6]);
      await dragOn(stage, a[0], a[1], bb[0], bb[1]);
      ok(sel.kind === "widget" && sel.ids.size >= 2, "dragging a box selects several widgets");
      const nSel = sel.ids.size, nAll = state.widgets.length;
      key("Delete");
      ok(state.widgets.length === nAll - nSel, "Delete removes the selection");
      key("z", { ctrlKey: true });
      ok(state.widgets.length === nAll, "and Ctrl+Z brings it back");
      key("e");
      ok(!editing && !document.body.classList.contains("editing"), "E leaves edit mode");
      key("p");
      ok($("#shade").classList.contains("on"), "P draws the privacy shade");
      key("p");
      ok(!$("#shade").classList.contains("on"), "P again reveals the dashboard");
      setEditing(true);
      openGallery(false); await tick(); await tick();
      ok(document.querySelectorAll(".card .mini .widget").length > 10, "gallery previews render");
      closeTopModal();
      openCatalog(); ok(!!pop && pop.querySelectorAll("button").length === Object.keys(T).length, "catalog lists every widget"); closePop();
      openHelp(); closeTopModal();
    } catch (err) {
      fail.push("threw: " + (err && err.stack || err));
    }
    if (errors.length) fail.push("runtime errors: " + errors.join(" | "));
    const pre = $("#test-out");
    pre.hidden = false;
    pre.textContent = (fail.length ? "FAIL " + fail.length : "PASS") + " (" + out.length + " passed) viewport " + innerWidth + "x" + innerHeight +
      " screen " + screen.width + "x" + screen.height + " canvas-at-boot " + bootCanvas + "\n" +
      fail.map(f => "  x " + f).join("\n") + "\n" + out.map(f => "  ok " + f).join("\n");
    document.title = fail.length ? "TEST FAIL " + fail.length : "TEST PASS " + out.length;
    try { localStorage.removeItem(store.KEY); } catch (e) { /* ignore */ }
  }

  boot().catch(err => { console.error(err); document.body.appendChild(h("pre", null, "Second Screen couldn't start: " + err.message)); });
})(window.SS = window.SS || {});
