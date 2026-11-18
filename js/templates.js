/* Second Screen · starter scenes
   Each template builds a full layout for a given canvas size, with its own
   arrangement for portrait monitors. Widgets are placed by anchor
   (place: {x, y, ax, ay}, resolved once the widget's size is known) or
   pinned onto a plane of the scene (anchor: {plane, u0, v0, uw, ratio}). */
(function (SS) {
  "use strict";

  const mk = (type, extra) => SS.widgets.create(type, extra);
  const dayKey = SS.widgets.dayKey;
  function daysBack(n, skip) {
    const out = [], d = new Date();
    for (let i = 0; i < n; i++) {
      if (!skip || skip.indexOf(i) === -1) out.push(dayKey(d));
      d.setDate(d.getDate() - 1);
    }
    return out;
  }
  function base(W, H, theme, name) {
    const s = SS.store.blank(W, H);
    s.theme = theme; s.name = name;
    return s;
  }
  // k scales type with the short side of the canvas; tall canvases stack things
  function frame(W, H) {
    return { k: Math.min(W, H) / 1000, tall: H > W * 1.05 };
  }

  const TEMPLATES = [
    {
      id: "desk", name: "Quiet Desk", blurb: "Calm and readable. A good place to start.",
      build(W, H) {
        const s = base(W, H, "midnight", "Quiet Desk"), { k, tall } = frame(W, H), m = Math.round(W * 0.065);
        const tasks = { data: [{ text: "Sketch the new layout", done: false }, { text: "Reply to the studio", done: false },
                               { text: "Twenty minute walk", done: true }] };
        s.widgets = tall ? [
          mk("clock", { place: { x: m, y: H * 0.07 }, fs: 2.1 * k, panel: "none", title: "", opts: { showDate: true } }),
          mk("focus", { place: { x: m, y: H * 0.25 }, fs: 1.3 * k, panel: "none", data: "" }),
          mk("tasks", Object.assign({ place: { x: m, y: H * 0.37 }, fs: 1.2 * k }, tasks)),
          mk("pomodoro", { place: { x: m, y: H * 0.62 }, fs: 1.05 * k }),
          mk("weather", { place: { x: W - m, y: H * 0.62, ax: 1 }, fs: 1.05 * k })
        ] : [
          mk("clock", { place: { x: m, y: H * 0.13 }, fs: 2.1 * k, panel: "none", title: "", opts: { showDate: true } }),
          mk("focus", { place: { x: m, y: H * 0.47 }, fs: 1.3 * k, panel: "none", data: "" }),
          mk("pomodoro", { place: { x: m, y: H * 0.64 }, fs: 1.0 * k }),
          mk("tasks", Object.assign({ place: { x: W - m, y: H * 0.13, ax: 1 }, fs: 1.1 * k }, tasks)),
          mk("weather", { place: { x: W - m, y: H * 0.64, ax: 1 }, fs: 1.05 * k })
        ];
        return s;
      }
    },
    {
      id: "room", name: "Concrete Room", blurb: "Widgets set into the walls in true perspective, and a niche for a video.",
      build(W, H) {
        const s = base(W, H, "concrete", "Concrete Room"), { k } = frame(W, H);
        const R = SS.scenes.room, kr = (W / H) / (16 / 9);
        const P = q => q.map(p => [p[0] * W, p[1] * H]);
        const left = P(R.left), back = P(R.back);
        const onLeft = (u0, v0, uw, vmax) => ({ plane: left, u0, v0, uw, ratio: R.leftRatio * kr, vmax: vmax || 0.86 });
        const onBack = (u0, v0, uw) => ({ plane: back, u0, v0, uw, ratio: R.backRatio * kr });
        s.style.radius = 6;
        s.widgets = [
          mk("clock", { anchor: onLeft(0.22, 0.2, 0.5, 0.62), fs: 2 * k, panel: "none", title: "", blend: "overlay",
            opts: { hour12: false } }),
          mk("date", { anchor: onLeft(0.27, 0.66, 0.36), fs: 1.2 * k, panel: "none", blend: "overlay" }),
          mk("focus", { anchor: onBack(0.06, 0.16, 0.34), fs: 1.2 * k, panel: "none", data: "" }),
          mk("tasks", { anchor: onBack(0.07, 0.36, 0.26), fs: 1 * k,
            data: [{ text: "Pour the second wall", done: true }, { text: "Order oak for the bench", done: false },
                   { text: "Call the glazier", done: false }] }),
          mk("weather", { anchor: onBack(0.6, 0.64, 0.22), fs: 1 * k, panel: "none" })
        ];
        const niche = SS.scenes.roomNicheQuad().map(p => [p[0] * W, p[1] * H]);
        s.screens = [{ id: SS.store.uid("s"), pts: SS.geo.cyc(niche), src: { kind: "none" }, controls: false, fit: "cover", muted: true }];
        return s;
      }
    },
    {
      id: "drive", name: "Night Drive", blurb: "Neon synthwave, the original look.",
      build(W, H) {
        const s = base(W, H, "synthwave", "Night Drive"), { k, tall } = frame(W, H);
        s.style.glass = 0.38;
        const streak = { data: { name: "Practice guitar", unit: "days", count: 12, days: daysBack(9, [4]) } };
        s.widgets = [
          mk("clock", { place: { x: W / 2, y: H * (tall ? 0.12 : 0.1), ax: 0.5 }, fs: 2.3 * k, panel: "none", title: "", color: "#eafcff" }),
          mk("date", { place: { x: W / 2, y: H * (tall ? 0.24 : 0.31), ax: 0.5 }, fs: 1.1 * k, panel: "none", opts: { style: "short" } }),
          mk("pomodoro", { place: tall ? { x: W * 0.06, y: H * 0.36 } : { x: W * 0.06, y: H * 0.43 }, fs: 1.05 * k }),
          mk("streak", Object.assign({ place: tall ? { x: W * 0.94, y: H * 0.36, ax: 1 } : { x: W * 0.94, y: H * 0.43, ax: 1 }, fs: 1.05 * k }, streak))
        ];
        return s;
      }
    },
    {
      id: "terminal", name: "Terminal", blurb: "Phosphor green panes, tidy as a tmux session.",
      build(W, H) {
        const s = base(W, H, "terminal", "Terminal"), { k, tall } = frame(W, H), m = Math.round(W * 0.06);
        s.style.radius = 4; s.style.glass = 0.5;
        const todo = { panel: "solid", title: "todo.txt",
          data: [{ text: "ship v2 of the dashboard", done: false }, { text: "rotate api keys", done: true },
                 { text: "write the changelog", done: false }] };
        const inbox = { panel: "solid", title: "inbox", data: ["look into the flaky test", "idea: weekly digest view"] };
        const scratch = { panel: "solid", title: "scratch", data: "deploy checklist\n- bump version\n- tag release\n- post notes" };
        const prompt = { panel: "none", opts: { text: "~/today $ uptime --pretty", weight: "400" } };
        const clock = { panel: "none", title: "local", opts: { hour12: false, seconds: true, showDate: true } };
        s.widgets = tall ? [
          mk("text", Object.assign({ place: { x: m, y: H * 0.05 }, fs: 0.62 * k }, prompt)),
          mk("clock", Object.assign({ place: { x: m, y: H * 0.1 }, fs: 1.45 * k }, clock)),
          mk("calendar", { place: { x: m, y: H * 0.27 }, fs: 1.15 * k, panel: "solid", opts: { monday: true } }),
          mk("tasks", Object.assign({ place: { x: W - m, y: H * 0.27, ax: 1 }, fs: 1.15 * k }, todo)),
          mk("notes", Object.assign({ place: { x: m, y: H * 0.55 }, fs: 1.15 * k, opts: { lines: "9" } }, scratch)),
          mk("capture", Object.assign({ place: { x: W - m, y: H * 0.55, ax: 1 }, fs: 1.15 * k }, inbox))
        ] : [
          mk("text", Object.assign({ place: { x: m, y: H * 0.08 }, fs: 0.62 * k }, prompt)),
          mk("clock", Object.assign({ place: { x: m, y: H * 0.17 }, fs: 1.45 * k }, clock)),
          mk("tasks", Object.assign({ place: { x: m, y: H * 0.52 }, fs: 1.15 * k }, todo)),
          mk("calendar", { place: { x: W / 2, y: H * 0.17, ax: 0.5 }, fs: 1.15 * k, panel: "solid", opts: { monday: true } }),
          mk("capture", Object.assign({ place: { x: W / 2, y: H * 0.6, ax: 0.5 }, fs: 1.15 * k }, inbox)),
          mk("notes", Object.assign({ place: { x: W - m, y: H * 0.17, ax: 1 }, fs: 1.15 * k, opts: { lines: "14" } }, scratch))
        ];
        return s;
      }
    },
    {
      id: "paper", name: "Paper Studio", blurb: "Warm daylight, ink and serif type.",
      build(W, H) {
        const s = base(W, H, "paper", "Paper Studio"), { k, tall } = frame(W, H), m = Math.round(W * 0.07);
        s.style.radius = 14; s.style.glass = 0.55;
        const headline = { panel: "none", opts: { text: "Make something\ngood today.", weight: "300" } };
        const wins = { panel: "solid", data: [{ text: "Finished the first chapter", date: dayKey() }, { text: "Fixed the leaky tap", date: daysBack(2)[1] }] };
        s.widgets = tall ? [
          mk("text", Object.assign({ place: { x: m, y: H * 0.07 }, fs: 2.0 * k }, headline)),
          mk("date", { place: { x: m, y: H * 0.24 }, fs: 1.15 * k, panel: "none" }),
          mk("countdown", { place: { x: W - m, y: H * 0.24, ax: 1 }, fs: 1.0 * k, panel: "none", align: "right" }),
          mk("calendar", { place: { x: m, y: H * 0.38 }, fs: 1.15 * k, panel: "solid" }),
          mk("checkin", { place: { x: m, y: H * 0.66 }, fs: 1.0 * k, panel: "solid" }),
          mk("wins", Object.assign({ place: { x: W - m, y: H * 0.66, ax: 1 }, fs: 1.0 * k }, wins))
        ] : [
          mk("text", Object.assign({ place: { x: m, y: H * 0.12 }, fs: 2.0 * k }, headline)),
          mk("date", { place: { x: m, y: H * 0.46 }, fs: 1.15 * k, panel: "none" }),
          mk("countdown", { place: { x: m, y: H * 0.67 }, fs: 1.0 * k, panel: "none" }),
          mk("calendar", { place: { x: W - m, y: H * 0.12, ax: 1 }, fs: 1.05 * k, panel: "solid" }),
          mk("checkin", { place: { x: W * 0.745, y: H * 0.58, ax: 1 }, fs: 0.95 * k, panel: "solid" }),
          mk("wins", Object.assign({ place: { x: W - m, y: H * 0.58, ax: 1 }, fs: 0.95 * k }, wins))
        ];
        return s;
      }
    },
    {
      id: "focus", name: "Deep Work", blurb: "One intention, one timer, nothing else.",
      build(W, H) {
        const s = base(W, H, "dusk", "Deep Work"), { k, tall } = frame(W, H);
        s.widgets = [
          mk("focus", { place: { x: W / 2, y: H * (tall ? 0.2 : 0.14), ax: 0.5 }, fs: 1.35 * k, panel: "none", title: "", data: "", align: "center" }),
          mk("pomodoro", { place: { x: W / 2, y: H * (tall ? 0.32 : 0.3), ax: 0.5 }, fs: 1.9 * k, panel: "none", title: "", align: "center" }),
          mk("clock", { place: { x: W / 2, y: H * 0.86, ax: 0.5, ay: 0.5 }, fs: 0.75 * k, panel: "none", title: "", align: "center" })
        ];
        return s;
      }
    },
    {
      id: "blank", name: "Blank Canvas", blurb: "Start from nothing. Bring your own photo.",
      build(W, H) { return base(W, H, "midnight", "Untitled layout"); }
    }
  ];

  SS.templates = TEMPLATES;
})(window.SS = window.SS || {});
