/* Second Screen · themes, fonts and code-drawn scenes
   Scenes are painted once into a canvas at the layout's size. The room scene
   exposes its wall planes so templates can pin widgets onto them exactly. */
(function (SS) {
  "use strict";
  const G = SS.geo;

  const FONTS = {
    sans:      { label: "Inter",         css: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" },
    grotesk:   { label: "Space Grotesk", css: "'Space Grotesk', 'Inter', system-ui, sans-serif" },
    serif:     { label: "Fraunces",      css: "'Fraunces', Georgia, 'Times New Roman', serif" },
    mono:      { label: "JetBrains Mono",css: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace" },
    condensed: { label: "Oswald",        css: "'Oswald', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif" },
    system:    { label: "System",        css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }
  };

  /* Each theme sets the art direction for widgets and a default scene.
     surf is the glass tint as "r,g,b". glow is 0..1. */
  const THEMES = {
    midnight: { label: "Midnight", font: "sans", text: "#f2f4ff", accent: "#9fb3ff", surf: "14,16,32",
      solid: "#141729", border: "rgba(255,255,255,0.12)", glow: 0.15, scene: "aurora", base: "#070914",
      tint: ["#2a3f9e", "#5b2d8c", "#0d6e80"] },
    dusk: { label: "Dusk", font: "grotesk", text: "#fff3ee", accent: "#ffb38a", surf: "40,16,30",
      solid: "#2a1424", border: "rgba(255,220,200,0.16)", glow: 0.2, scene: "aurora", base: "#1a0b16",
      tint: ["#c2410c", "#9d174d", "#6d28d9"] },
    synthwave: { label: "Night Drive", font: "mono", text: "#eafcff", accent: "#ff2d95", surf: "10,2,26",
      solid: "#160733", border: "rgba(34,224,255,0.38)", glow: 1, scene: "synthwave", base: "#180029",
      glowColor: "#22e0ff" },
    terminal: { label: "Terminal", font: "mono", text: "#b9ffd0", accent: "#3dff7a", surf: "0,12,5",
      solid: "#03140a", border: "rgba(61,255,122,0.28)", glow: 0.7, scene: "terminal", base: "#010604" },
    concrete: { label: "Concrete", font: "condensed", text: "#f6f2ea", accent: "#ffbd7a", surf: "24,23,22",
      solid: "#1e1d1c", border: "rgba(255,255,255,0.16)", glow: 0, scene: "room", base: "#262523" },
    paper: { label: "Paper", font: "serif", text: "#2b2622", accent: "#b4532a", surf: "255,252,246",
      solid: "#fbf7ef", border: "rgba(70,45,20,0.14)", glow: 0, scene: "paper", base: "#e9e1d3", light: true },
    forest: { label: "Forest", font: "serif", text: "#eef6e8", accent: "#e9c46a", surf: "8,24,14",
      solid: "#0d2216", border: "rgba(233,196,106,0.2)", glow: 0.15, scene: "aurora", base: "#04110a",
      tint: ["#14532d", "#3f6212", "#115e59"] },
    ocean: { label: "Deep Ocean", font: "sans", text: "#e8f8ff", accent: "#5eead4", surf: "4,22,38",
      solid: "#062236", border: "rgba(94,234,212,0.2)", glow: 0.3, scene: "aurora", base: "#020d18",
      tint: ["#075985", "#0e7490", "#1e3a8a"] },
    sakura: { label: "Sakura", font: "serif", text: "#fff2f6", accent: "#ffadc8", surf: "44,20,30",
      solid: "#2e1622", border: "rgba(255,173,200,0.22)", glow: 0.2, scene: "aurora", base: "#1a0c12",
      tint: ["#be185d", "#9f1239", "#7e22ce"] },
    ember: { label: "Ember", font: "condensed", text: "#fff1e4", accent: "#ff8c42", surf: "30,12,6",
      solid: "#26120a", border: "rgba(255,140,66,0.25)", glow: 0.45, scene: "aurora", base: "#120806",
      tint: ["#9a3412", "#7c2d12", "#b45309"] },
    mono: { label: "Mono", font: "sans", text: "#f2f2f2", accent: "#bdbdbd", surf: "20,20,20",
      solid: "#1a1a1a", border: "rgba(255,255,255,0.14)", glow: 0, scene: "gradient", base: "#0e0e0e",
      stops: ["#1c1c1c", "#101010", "#0a0a0a"] },
    vapor: { label: "Vaporwave", font: "grotesk", text: "#f7ecff", accent: "#ff9ad5", surf: "30,16,52",
      solid: "#241240", border: "rgba(183,140,255,0.3)", glow: 0.6, scene: "aurora", base: "#140b26",
      tint: ["#7c3aed", "#db2777", "#2563eb"] }
  };

  /* ---------- small canvas helpers ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rgb(hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) { const c = rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  const tiles = {};
  function noiseTile(size, seed) {
    const k = size + ":" + seed;
    if (tiles[k]) return tiles[k];
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d");
    const img = x.createImageData(size, size);
    const r = rng(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (r() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return (tiles[k] = c);
  }
  // fine film grain
  function grain(ctx, W, H, alpha, s) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "overlay";
    const k = Math.max(1, s * 1.1);
    ctx.scale(k, k);
    ctx.fillStyle = ctx.createPattern(noiseTile(256, 7), "repeat");
    ctx.fillRect(0, 0, W / k + 2, H / k + 2);
    ctx.restore();
  }
  // soft large-scale mottling
  function mottle(ctx, W, H, alpha, cells, seed, mode) {
    const t = noiseTile(cells, seed);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = mode || "overlay";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(t, 0, 0, cells, cells, 0, 0, W, H);
    ctx.restore();
  }
  function vignette(ctx, W, H, strength, color) {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, color || "rgba(0,0,0," + strength + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  }
  const canBlur = (() => {
    try { const c = document.createElement("canvas").getContext("2d"); c.filter = "blur(2px)"; return c.filter === "blur(2px)"; }
    catch (e) { return false; }
  })();
  function blurred(ctx, px, fn) {
    ctx.save();
    if (canBlur) ctx.filter = "blur(" + Math.max(0, px) + "px)";
    fn();
    ctx.restore();
  }

  /* ---------- scenes ---------- */
  function aurora(ctx, W, H, t, s) {
    ctx.fillStyle = t.base; ctx.fillRect(0, 0, W, H);
    const tint = t.tint || [t.accent, t.accent, t.accent];
    const M = Math.max(W, H);
    const blobs = [[0.16, 0.18, 0.62, tint[0], 0.55], [0.86, 0.28, 0.55, tint[1], 0.5],
                   [0.52, 1.02, 0.7, tint[2], 0.5], [1.02, 0.96, 0.4, tint[0], 0.35],
                   [0.4, 0.45, 0.35, tint[1], 0.18]];
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    blobs.forEach(b => {
      const x = b[0] * W, y = b[1] * H, r = b[2] * M;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(b[3], b[4]));
      g.addColorStop(0.45, rgba(b[3], b[4] * 0.35));
      g.addColorStop(1, rgba(b[3], 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
    ctx.restore();
    mottle(ctx, W, H, 0.10, 24, 3, "soft-light");
    vignette(ctx, W, H, 0.5);
    grain(ctx, W, H, 0.07, s);
  }

  function gradient(ctx, W, H, t, s) {
    const st = t.stops || [t.base, t.base];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    st.forEach((c, i) => g.addColorStop(i / (st.length - 1), c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    vignette(ctx, W, H, 0.35);
    grain(ctx, W, H, 0.06, s);
  }

  function synthwave(ctx, W, H, t, s) {
    const R = rng(11);
    const hz = H * 0.7;
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    [["#14002b", 0], ["#3d0a52", 0.32], ["#7a1f6b", 0.56], ["#d6336c", 0.76], ["#ff5e3a", 0.9], ["#ffb14e", 1]]
      .forEach(([c, o]) => sky.addColorStop(o, c));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz + 2);

    // stars
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 160; i++) {
      ctx.globalAlpha = 0.15 + R() * 0.6;
      const r = (0.6 + R() * 1.2) * s;
      ctx.fillRect(R() * W, R() * hz * 0.5, r, r);
    }
    ctx.globalAlpha = 1;

    // striped sun on its own layer so the stripes can be cut out
    const Rs = H * 0.21, cx = W / 2, cy = hz - Rs * 0.42;
    const L = document.createElement("canvas"); L.width = Math.ceil(Rs * 2 + 4); L.height = L.width;
    const l = L.getContext("2d"), o = L.width / 2;
    const sg = l.createLinearGradient(0, o - Rs, 0, o + Rs);
    sg.addColorStop(0, "#fff27a"); sg.addColorStop(0.45, "#ff9a3c"); sg.addColorStop(1, "#ff2d95");
    l.fillStyle = sg; l.beginPath(); l.arc(o, o, Rs, 0, Math.PI * 2); l.fill();
    l.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 7; i++) {
      const y = o + Rs * (0.02 + i * 0.15), h = Rs * (0.018 + i * 0.022);
      l.fillRect(0, y, L.width, h);
    }
    ctx.save();
    ctx.shadowColor = "rgba(255,80,130,0.75)"; ctx.shadowBlur = 90 * s;
    ctx.drawImage(L, cx - o, cy - o);
    ctx.restore();

    // skyline
    let x = -10 * s;
    const neon = ["#22e0ff", "#ff2d95", "#ffd23f", "#b14eff"];
    while (x < W) {
      const bw = W * (0.016 + R() * 0.026), bh = H * (0.05 + R() * 0.2 * (0.4 + 0.6 * Math.abs(Math.sin(x / W * 5.1))));
      const bg = ctx.createLinearGradient(0, hz - bh, 0, hz);
      bg.addColorStop(0, "#26073f"); bg.addColorStop(1, "#0c0118");
      ctx.fillStyle = bg; ctx.fillRect(x, hz - bh, bw, bh);
      ctx.fillStyle = "rgba(34,224,255,0.55)"; ctx.fillRect(x, hz - bh, bw, Math.max(1, 1.2 * s));
      const ws = 3.2 * s, gap = 7 * s;
      for (let wx = x + 4 * s; wx < x + bw - ws; wx += gap)
        for (let wy = hz - bh + 6 * s; wy < hz - 4 * s; wy += gap * 1.3)
          if (R() > 0.68) {
            ctx.fillStyle = neon[(R() * neon.length) | 0];
            ctx.globalAlpha = 0.55 + R() * 0.45;
            ctx.fillRect(wx, wy, ws, ws);
          }
      ctx.globalAlpha = 1;
      x += bw + 2.5 * s;
    }

    // floor and grid
    const fg = ctx.createLinearGradient(0, hz, 0, H);
    fg.addColorStop(0, "#2a0a3d"); fg.addColorStop(1, "#0a0114");
    ctx.fillStyle = fg; ctx.fillRect(0, hz, W, H - hz);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, hz, W, H - hz); ctx.clip();
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.shadowBlur = 10 * s;
    ctx.strokeStyle = "rgba(255,45,149,0.7)"; ctx.shadowColor = "#ff2d95";
    for (let k = -40; k <= 40; k++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + k * W * 0.006, hz);
      ctx.lineTo(W / 2 + k * W * 0.075, H);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(34,224,255,0.65)"; ctx.shadowColor = "#22e0ff";
    for (let i = 1; i <= 16; i++) {
      const y = hz + (H - hz) * Math.pow(i / 16, 2.1);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
    // haze where the floor meets the sky
    const hg = ctx.createLinearGradient(0, hz - H * 0.02, 0, hz + H * 0.09);
    hg.addColorStop(0, "rgba(255,120,120,0.0)");
    hg.addColorStop(0.2, "rgba(255,110,140,0.35)");
    hg.addColorStop(1, "rgba(42,10,61,0)");
    ctx.fillStyle = hg; ctx.fillRect(0, hz - H * 0.02, W, H * 0.11);
    vignette(ctx, W, H, 0.35);
    grain(ctx, W, H, 0.05, s);
  }

  function terminal(ctx, W, H, t, s) {
    ctx.fillStyle = "#010604"; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(61,255,122,0.10)"); g.addColorStop(1, "rgba(61,255,122,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(61,255,122,0.035)";
    const step = Math.max(2, 3 * s);
    for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, Math.max(1, step / 3));
    vignette(ctx, W, H, 0.75);
    grain(ctx, W, H, 0.08, s);
  }

  function paper(ctx, W, H, t, s) {
    const R = rng(5);
    ctx.fillStyle = t.light ? t.base : "#e9e1d3"; ctx.fillRect(0, 0, W, H);
    mottle(ctx, W, H, 0.10, 20, 9, "multiply");
    // fibres
    ctx.save();
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    for (let i = 0; i < 420; i++) {
      ctx.strokeStyle = R() > 0.5 ? "rgba(120,95,70,0.07)" : "rgba(255,255,255,0.12)";
      const x = R() * W, y = R() * H, a = R() * Math.PI, l = (12 + R() * 40) * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (R() - 0.5) * 8 * s, y + Math.sin(a) * l * 0.5,
                           x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.restore();
    // afternoon window light falling across the sheet
    blurred(ctx, 70 * s, () => {
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(255,244,214,0.9)";
      poly(ctx, [[W * 0.42, -H * 0.1], [W * 1.15, -H * 0.1], [W * 0.92, H * 1.1], [W * 0.12, H * 1.1]]);
      ctx.fill();
    });
    blurred(ctx, 26 * s, () => {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(120,95,70,0.10)";
      poly(ctx, [[W * 0.74, -H * 0.1], [W * 0.765, -H * 0.1], [W * 0.555, H * 1.1], [W * 0.53, H * 1.1]]);
      ctx.fill();
      poly(ctx, [[W * 0.2, H * 0.46], [W * 1.2, H * 0.36], [W * 1.2, H * 0.38], [W * 0.2, H * 0.48]]);
      ctx.fill();
    });
    vignette(ctx, W, H, 0, "rgba(90,66,40,0.22)");
    grain(ctx, W, H, 0.06, s);
  }

  /* ---------- the room: two concrete walls in two-point perspective ---------- */
  const ROOM = {
    left: [[-0.02, -0.12], [0.34, 0.10], [-0.02, 1.10], [0.34, 0.78]],
    back: [[0.34, 0.10], [1.02, 0.02], [0.34, 0.78], [1.02, 0.90]],
    niche: [0.53, 0.905, 0.2, 0.6],    // u0,u1,v0,v1 on the back wall
    leftRatio: 1.6, backRatio: 1.7       // world width / height of each wall, at 16:9
  };
  function roomNicheQuad() {
    const n = ROOM.niche;
    return G.uvRect(ROOM.back, n[0], n[1] - 0.03, n[2] + 0.028, n[3] - 0.012);
  }

  function room(ctx, W, H, t, s) {
    const P = q => q.map(p => [p[0] * W, p[1] * H]);
    const left = P(ROOM.left), back = P(ROOM.back);
    const Hb = G.rectToQuad(1, 1, back), Hl = G.rectToQuad(1, 1, left);
    const at = (Hm, u, v) => G.apply(Hm, u, v);

    // ceiling
    const cg = ctx.createLinearGradient(0, 0, 0, H * 0.12);
    cg.addColorStop(0, "#151413"); cg.addColorStop(1, "#262422");
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);

    // floor
    const floor = [left[2], left[3], back[3], [W * 1.1, H * 1.2], [-W * 0.1, H * 1.2]];
    ctx.save(); poly(ctx, floor); ctx.clip();
    const fg = ctx.createLinearGradient(0, H * 0.78, 0, H);
    fg.addColorStop(0, "#5b5853"); fg.addColorStop(1, "#2f2d2a");
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    mottle(ctx, W, H, 0.18, 40, 21, "overlay");
    // soft reflection of the sunlit patch
    blurred(ctx, 30 * s, () => {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255,226,186,0.16)";
      poly(ctx, [at(Hb, 0.1, 1), at(Hb, 0.42, 1), [W * 0.62, H * 1.05], [W * 0.38, H * 1.05]]);
      ctx.fill();
    });
    ctx.restore();

    function wall(q, Hm, c0, c1, ratio, cols, rows, seed) {
      ctx.save(); poly(ctx, G.cyc(q)); ctx.clip();
      const a = at(Hm, 0, 0.5), b = at(Hm, 1, 0.5);
      const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, H * 3);
      const tp = at(Hm, 0.5, 0), bt = at(Hm, 0.5, 1);
      const vg = ctx.createLinearGradient(tp[0], tp[1], bt[0], bt[1]);
      vg.addColorStop(0, "rgba(0,0,0,0.28)"); vg.addColorStop(0.35, "rgba(0,0,0,0)");
      vg.addColorStop(0.8, "rgba(0,0,0,0.02)"); vg.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = vg; ctx.fillRect(-W, -H, W * 3, H * 3);
      mottle(ctx, W, H, 0.07, 110, seed, "overlay");
      mottle(ctx, W, H, 0.16, 9, seed + 1, "soft-light");

      // formwork panel seams
      ctx.lineWidth = Math.max(1, 1.3 * s);
      for (let i = 1; i < cols; i++) {
        const p0 = at(Hm, i / cols, 0), p1 = at(Hm, i / cols, 1);
        ctx.strokeStyle = "rgba(20,18,16,0.16)"; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.beginPath(); ctx.moveTo(p0[0] + s, p0[1]); ctx.lineTo(p1[0] + s, p1[1]); ctx.stroke();
      }
      for (let j = 1; j < rows; j++) {
        const p0 = at(Hm, 0, j / rows), p1 = at(Hm, 1, j / rows);
        ctx.strokeStyle = "rgba(20,18,16,0.16)"; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.beginPath(); ctx.moveTo(p0[0], p0[1] + s); ctx.lineTo(p1[0], p1[1] + s); ctx.stroke();
      }
      // tie holes, three by two per panel
      const ru = 0.0055, rv = ru * ratio;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++)
        for (let hx = 0; hx < 3; hx++) for (let hy = 0; hy < 2; hy++) {
          const u = (i + (hx * 2 + 1) / 6) / cols, v = (j + (hy * 2 + 1) / 4) / rows;
          const c = at(Hm, u, v);
          const rx = G.dist(c, at(Hm, u + ru, v)), ry = G.dist(c, at(Hm, u, v + rv));
          if (rx < 0.4) continue;
          const hg = ctx.createRadialGradient(c[0], c[1] - ry * 0.2, 0, c[0], c[1], Math.max(rx, ry) * 1.3);
          hg.addColorStop(0, "rgba(28,26,24,0.75)"); hg.addColorStop(0.6, "rgba(40,38,35,0.45)");
          hg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = hg;
          ctx.beginPath(); ctx.ellipse(c[0], c[1], rx * 1.3, ry * 1.3, 0, 0, Math.PI * 2); ctx.fill();
        }
      grain(ctx, W, H, 0.09, s);
      ctx.restore();
    }

    wall(left, Hl, "#46443f", "#6b6862", ROOM.leftRatio, 5, 3, 31);
    wall(back, Hb, "#8a8781", "#a8a59e", ROOM.backRatio, 4, 3, 41);

    // sunlight falling through an unseen window onto the back wall
    ctx.save(); poly(ctx, G.cyc(back)); ctx.clip();
    blurred(ctx, 16 * s, () => {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255,224,182,0.42)";
      poly(ctx, [at(Hb, 0.06, 0.1), at(Hb, 0.36, 0.1), at(Hb, 0.44, 0.97), at(Hb, 0.14, 0.97)]);
      ctx.fill();
    });
    blurred(ctx, 8 * s, () => {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(90,80,70,0.55)";
      poly(ctx, [at(Hb, 0.2, 0.1), at(Hb, 0.215, 0.1), at(Hb, 0.295, 0.97), at(Hb, 0.28, 0.97)]);
      ctx.fill();
      poly(ctx, [at(Hb, 0.08, 0.5), at(Hb, 0.4, 0.5), at(Hb, 0.405, 0.525), at(Hb, 0.085, 0.525)]);
      ctx.fill();
    });
    ctx.restore();

    // recessed niche, the natural home for a screen
    const n = ROOM.niche;
    const o = G.uvRect(ROOM.back, n[0], n[1], n[2], n[3]).map(p => [p[0] * W, p[1] * H]);
    const i = roomNicheQuad().map(p => [p[0] * W, p[1] * H]);
    const face = (pts, c0, c1, a, b) => {
      const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      ctx.fillStyle = g; poly(ctx, pts); ctx.fill();
    };
    face([o[0], o[1], i[1], i[0]], "#2b2927", "#3a3734", o[0], i[0]);           // underside of the lintel
    face([o[1], o[3], i[3], i[1]], "#77736c", "#5e5a55", o[1], i[1]);           // right reveal, catching light
    face([o[2], o[3], i[3], i[2]], "#5c5954", "#48453f", o[2], i[2]);           // sill
    face([i[0], i[1], i[3], i[2]], "#141414", "#1f1e1d", i[0], i[2]);           // back of the recess
    blurred(ctx, 10 * s, () => {
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 10 * s;
      ctx.beginPath(); ctx.moveTo(i[0][0], i[0][1]); ctx.lineTo(i[1][0], i[1][1]); ctx.stroke();
    });

    // ambient occlusion in the corner and along the floor line
    blurred(ctx, 26 * s, () => {
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 34 * s;
      ctx.beginPath(); ctx.moveTo(back[0][0], back[0][1]); ctx.lineTo(back[2][0], back[2][1]); ctx.stroke();
      ctx.lineWidth = 26 * s;
      ctx.beginPath(); ctx.moveTo(left[2][0], left[2][1]); ctx.lineTo(back[2][0], back[2][1]); ctx.lineTo(back[3][0], back[3][1]); ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]); ctx.lineTo(back[0][0], back[0][1]); ctx.lineTo(back[1][0], back[1][1]); ctx.stroke();
    });
    vignette(ctx, W, H, 0.45);
  }

  const SCENES = {
    aurora:    { label: "Aurora",      draw: aurora },
    synthwave: { label: "Night Drive", draw: synthwave },
    room:      { label: "Concrete",    draw: room },
    terminal:  { label: "Phosphor",    draw: terminal },
    paper:     { label: "Paper",       draw: paper },
    gradient:  { label: "Plain",       draw: gradient }
  };

  function draw(id, canvas, W, H, theme) {
    const ctx = canvas.getContext("2d");
    const sc = SCENES[id] || SCENES.aurora;
    const s = H / 1000;
    ctx.save();
    try { sc.draw(ctx, W, H, theme, s); }
    catch (err) { console.error("scene", id, err); ctx.fillStyle = theme.base; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  SS.FONTS = FONTS;
  SS.THEMES = THEMES;
  SS.scenes = { list: SCENES, draw, room: ROOM, roomNicheQuad, rgb, rgba };
})(window.SS = window.SS || {});
