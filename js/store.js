/* Second Screen · storage
   Layout JSON lives in localStorage. Images and video files live in IndexedDB,
   referenced from the layout as "idb:<id>", so they survive reloads and never
   push the layout past the localStorage ceiling. */
(function (SS) {
  "use strict";

  const KEY = "second-screen:v2";
  const LEGACY_KEY = "second-screen-neon-v1";
  const uid = (p) => (p || "w") + Math.random().toString(36).slice(2, 9);

  /* ---------- media URL helpers ---------- */
  function isDirectVideo(u) {
    return /^https?:\/\/\S+\.(mp4|webm|ogv|ogg|m4v|mov)(\?\S*)?$/i.test(String(u || "").trim());
  }
  function youtubeId(url) {
    const u = String(url || "").trim();
    const m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{11}$/.test(u) ? u : "";
  }
  function youtubeEmbed(url, o) {
    const id = youtubeId(url);
    if (!id) return "";
    o = o || {};
    const ctl = o.controls ? 1 : 0;
    // loop needs playlist=<id>; mute is what lets autoplay through
    return "https://www.youtube-nocookie.com/embed/" + id +
      "?autoplay=1&mute=" + (o.muted === false ? 0 : 1) + "&loop=1&playlist=" + id +
      "&controls=" + ctl + "&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=" + (ctl ? 0 : 1) +
      "&fs=" + ctl;
  }

  /* ---------- media (IndexedDB) ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open("second-screen-media", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("media");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction("media", mode);
      const out = fn(t.objectStore("media"));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    }));
  }
  const urls = {};       // ref -> object URL
  const pending = {};    // ref -> Promise<url>

  const media = {
    isRef: (s) => typeof s === "string" && s.indexOf("idb:") === 0,
    async put(blob, name) {
      const ref = "idb:" + uid("m");
      await tx("readwrite", st => st.put({ blob, name: name || "", type: blob.type || "" }, ref.slice(4)));
      urls[ref] = URL.createObjectURL(blob);
      return ref;
    },
    url(ref) { return urls[ref] || null; },
    load(ref) {
      if (urls[ref]) return Promise.resolve(urls[ref]);
      if (pending[ref]) return pending[ref];
      pending[ref] = tx("readonly", st => st.get(ref.slice(4))).then(rec => {
        delete pending[ref];
        if (!rec || !rec.blob) return null;
        return (urls[ref] = URL.createObjectURL(rec.blob));
      }).catch(() => { delete pending[ref]; return null; });
      return pending[ref];
    },
    async blob(ref) {
      try { const rec = await tx("readonly", st => st.get(ref.slice(4))); return rec ? rec.blob : null; }
      catch (e) { return null; }
    },
    // drop stored files nothing points at any more
    async gc(keep) {
      try {
        const keys = await tx("readonly", st => st.getAllKeys());
        const dead = (keys || []).filter(k => !keep.has("idb:" + k));
        if (dead.length) await tx("readwrite", st => dead.forEach(k => st.delete(k)));
      } catch (e) { /* storage unavailable: nothing to clean */ }
    }
  };

  function refsIn(state) {
    const out = new Set();
    const add = (v) => { if (media.isRef(v)) out.add(v); };
    if (state.backdrop) add(state.backdrop.src);
    if (state.privacy) add(state.privacy.image);
    (state.screens || []).forEach(s => s.src && add(s.src.ref));
    return out;
  }

  function dataURLToBlob(u) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(u);
    if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || "application/octet-stream" });
  }
  function blobToDataURL(b) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(b);
    });
  }

  // move any embedded data: URLs into IndexedDB (imports, v1 migrations)
  async function internalize(state) {
    const move = async (obj, key) => {
      const v = obj && obj[key];
      if (typeof v === "string" && v.indexOf("data:") === 0) {
        const b = dataURLToBlob(v);
        if (b) { try { obj[key] = await media.put(b); } catch (e) { /* keep the data URL */ } }
      }
    };
    await move(state.backdrop, "src");
    await move(state.privacy, "image");
    for (const s of state.screens || []) if (s.src) {
      if (s.src.data) { s.src.ref = s.src.data; delete s.src.data; await move(s.src, "ref"); }
    }
    return state;
  }
  // the reverse, for a self-contained backup file
  async function externalize(state) {
    const copy = JSON.parse(JSON.stringify(state));
    const embed = async (obj, key) => {
      const v = obj && obj[key];
      if (media.isRef(v)) {
        const b = await media.blob(v);
        obj[key] = (b && b.size < 40e6) ? await blobToDataURL(b) : null;
      }
    };
    await embed(copy.backdrop, "src");
    await embed(copy.privacy, "image");
    for (const s of copy.screens || []) if (s.src && media.isRef(s.src.ref)) {
      const b = await media.blob(s.src.ref);
      if (b && b.size < 40e6) { s.src.data = await blobToDataURL(b); delete s.src.ref; }
      else { s.src = { kind: "none" }; }
    }
    return copy;
  }

  /* ---------- the layout ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === 2) return s; }
    } catch (e) { /* fall through */ }
    try {
      const old = localStorage.getItem(LEGACY_KEY);
      if (old) { const s = migrateV1(JSON.parse(old)); if (s) return s; }
    } catch (e) { /* ignore */ }
    return null;
  }

  let saveTimer = null, lastError = null;
  function save(state, now) {
    clearTimeout(saveTimer);
    const run = () => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); lastError = null; }
      catch (e) {
        if (!lastError && SS.ui) SS.ui.toast("Could not save: browser storage is full or blocked.");
        lastError = e;
      }
    };
    if (now) run(); else saveTimer = setTimeout(run, 200);
  }

  /* ---------- v1 -> v2 ---------- */
  const V1_THEME = { cyberpunk: "synthwave", vapor: "vapor", terminal: "terminal", jungle: "forest", ocean: "ocean",
                     arctic: "midnight", sunset: "dusk", ember: "ember", sakura: "sakura", mono: "mono" };
  const V1_FONT = { mono: "mono", sans: "sans", serif: "serif", rounded: "grotesk", condensed: "condensed", display: "condensed" };

  function migrateV1(o) {
    if (!o || !Array.isArray(o.widgets)) return null;
    const W = o.designW || window.innerWidth, H = o.designH || window.innerHeight;
    const surfaces = (o.zones || []).map(z => {
      const q = z.quad;
      const d = SS.geo.quadDims(q);
      return { id: z.id, quad: SS.geo.clone(q), cols: Math.max(1, Math.round(d.w / 150)),
               rows: Math.max(1, Math.round(d.h / 150)), gap: 0, fit: "fill" };
    });
    const widgets = o.widgets.map(w => {
      const n = { id: w.id || uid(), type: w.type === "streak" ? "streak" : w.type,
                  x: w.x || 0, y: w.y || 0, fs: w.fs || 1, data: w.data, opts: {} };
      if (w.font && V1_FONT[w.font]) n.font = V1_FONT[w.font];
      if (w.bold) n.bold = true;
      if (w.italic) n.italic = true;
      if (w.color) n.color = w.color;
      if (w.color2) n.accent = w.color2;
      if (w.glow === false) n.glow = false;
      if (w.glass === false) n.panel = "none";
      if (w.zoneId && surfaces.some(s => s.id === w.zoneId)) {
        n.surface = { id: w.zoneId, c0: w.c0 || 0, c1: w.c1 || 0, r0: w.r0 || 0, r1: w.r1 || 0 };
      } else if (w.warped && Array.isArray(w.quad)) {
        n.pin = w.quad.map(p => [n.x + p[0], n.y + p[1]]);
      }
      return n;
    }).filter(w => SS.widgets && SS.widgets.types[w.type]);
    const screens = (o.openings || []).map(op => {
      let src = { kind: "none" };
      const u = (op.src || "").trim();
      if (u && isDirectVideo(u)) src = { kind: "video", url: u };
      else if (u) src = { kind: "youtube", url: u };
      else if (op.localName) src = { kind: "missing", name: op.localName };
      else if (op.img) src = { kind: "image", url: op.img };
      return { id: op.id || uid("s"), pts: SS.geo.clone(op.pts), src, controls: !!op.controls, fit: "cover", muted: true };
    });
    const s = blank(W, H);
    Object.assign(s, {
      name: "My layout",
      theme: V1_THEME[o.theme] || "synthwave",
      canvas: { w: W, h: H, fit: o.fitMode === "fill" ? "fill" : "fit" },
      style: Object.assign(s.style, { glass: (o.opacity == null ? 22 : o.opacity) / 100,
                                      blur: o.blur == null ? 14 : o.blur, legible: !!o.contrast }),
      widgets, surfaces, screens
    });
    if (o.bgVideo) s.backdrop = { kind: "video", url: o.bgVideo, fit: o.bgFit || "cover",
                                  x: o.bgPosX == null ? 50 : o.bgPosX, y: o.bgPosY == null ? 50 : o.bgPosY,
                                  muted: o.bgMuted !== false };
    else if (o.bg) s.backdrop = { kind: "image", src: o.bg, x: 50, y: 50 };
    if (o.cover) s.privacy.image = o.cover;
    s.migrated = true;
    return s;
  }

  function blank(W, H) {
    return {
      v: 2, name: "Untitled layout", theme: "midnight",
      canvas: { w: Math.round(W), h: Math.round(H), fit: "fit" },
      backdrop: { kind: "scene" },
      style: { glass: 0.3, blur: 18, radius: 18, legible: false },
      widgets: [], surfaces: [], screens: [],
      privacy: { image: null }
    };
  }

  // fill any gaps so a hand-edited or older file never crashes the app
  function normalize(s) {
    const d = blank(window.innerWidth, window.innerHeight);
    s.v = 2;
    if (!s.canvas || !(s.canvas.w > 0) || !(s.canvas.h > 0)) s.canvas = d.canvas;
    if (!s.backdrop) s.backdrop = d.backdrop;
    s.style = Object.assign({}, d.style, s.style || {});
    if (!s.privacy) s.privacy = { image: null };
    if (!SS.THEMES[s.theme]) s.theme = "midnight";
    ["widgets", "surfaces", "screens"].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    s.widgets = s.widgets.filter(w => w && SS.widgets.types[w.type]);
    s.widgets.forEach(w => {
      if (!w.id) w.id = uid();
      if (!w.opts) w.opts = {};
      if (!(w.fs > 0)) w.fs = 1;
      if (typeof w.x !== "number") w.x = 0;
      if (typeof w.y !== "number") w.y = 0;
    });
    s.screens.forEach(sc => { if (!sc.src) sc.src = { kind: "none" }; if (!sc.id) sc.id = uid("s"); });
    s.surfaces.forEach(sf => { if (!sf.id) sf.id = uid("z"); sf.cols = sf.cols || 2; sf.rows = sf.rows || 2; });
    return s;
  }

  /* ---------- share links: layout without personal content ---------- */
  function b64url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  function shareable(state) {
    const c = JSON.parse(JSON.stringify(state));
    const dropped = [];
    c.widgets.forEach(w => { delete w.data; });   // notes, tasks and logs stay private
    if (media.isRef(c.backdrop.src) || (c.backdrop.src || "").indexOf("data:") === 0) {
      c.backdrop = { kind: "scene" }; dropped.push("background image");
    }
    c.screens.forEach(s => {
      if (s.src && (s.src.kind === "file" || s.src.kind === "missing")) { s.src = { kind: "none" }; dropped.push("screen file"); }
    });
    c.privacy = { image: null };
    delete c.migrated;
    return { state: c, dropped };
  }
  async function encodeShare(state) {
    const { state: c, dropped } = shareable(state);
    const bytes = new TextEncoder().encode(JSON.stringify(c));
    let token;
    if ("CompressionStream" in window) token = "z" + b64url(await pipe(bytes, new CompressionStream("deflate-raw")));
    else token = "j" + b64url(bytes);
    return { token, dropped: Array.from(new Set(dropped)) };
  }
  async function decodeShare(token) {
    const kind = token[0], body = unb64url(token.slice(1));
    let bytes = body;
    if (kind === "z") bytes = await pipe(body, new DecompressionStream("deflate-raw"));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  SS.store = { KEY, uid, load, save, blank, normalize, migrateV1, internalize, externalize,
               refsIn, encodeShare, decodeShare, isDirectVideo, youtubeId, youtubeEmbed };
  SS.media = media;
})(window.SS = window.SS || {});
