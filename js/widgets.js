/* Second Screen · widget library
   Each type declares: name, desc, category, icon, make() for fresh data/opts,
   options[] shown in the inspector, and render(ctx) which builds the content
   and may return { tick(now), status(), destroy() }. Everything is sized in em,
   so a widget's font size is its scale. */
(function (SS) {
  "use strict";

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function btn(label, onClick, cls, iconName) {
    const b = h("button", "w-btn" + (cls ? " " + cls : ""));
    b.type = "button";
    if (iconName) b.innerHTML = SS.icon(iconName);
    if (label) b.appendChild(h("span", null, label));
    if (!label && iconName) b.setAttribute("aria-label", iconName);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }
  function caption(c, def) {
    const t = c.w.title === undefined ? def : c.w.title;
    if (!t) return null;
    return c.root.appendChild(h("div", "w-cap", t));
  }
  const pad = (n) => String(n).padStart(2, "0");
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function shiftDay(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dayKey(dt);
  }

  /* ---------- formatting ---------- */
  const fmtCache = {};
  function fmt(opts) {
    const k = JSON.stringify(opts);
    if (!fmtCache[k]) {
      try { fmtCache[k] = new Intl.DateTimeFormat(undefined, opts); }
      catch (e) { const o = Object.assign({}, opts); delete o.timeZone; fmtCache[k] = new Intl.DateTimeFormat(undefined, o); }
    }
    return fmtCache[k];
  }
  function timeParts(now, o) {
    const base = { hour: "numeric", minute: "2-digit", hourCycle: o.hour12 ? "h12" : "h23" };
    if (o.seconds) base.second = "2-digit";
    if (o.tz) base.timeZone = o.tz;
    const parts = fmt(base).formatToParts(now);
    let main = "", ap = "";
    parts.forEach(p => { if (p.type === "dayPeriod") ap = p.value; else main += p.value; });
    const dopt = { weekday: "long", month: "long", day: "numeric" };
    if (o.tz) dopt.timeZone = o.tz;
    return { main: main.trim(), ap: ap.trim(), date: fmt(dopt).format(now) };
  }
  function localTZ() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } }
  function cityFromTZ() {
    const tz = localTZ();
    if (!tz || tz.indexOf("/") < 0 || tz.indexOf("Etc/") === 0) return "";
    return tz.split("/").pop().replace(/_/g, " ");
  }
  function prefersF() {
    const l = (navigator.language || "").toUpperCase();
    return /-(US|LR|MM|BS|BZ|KY|PW)$/.test(l) || l === "EN";
  }

  /* ---------- tiny chime for timer transitions ---------- */
  let actx = null;
  function wakeAudio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); }
    catch (e) { actx = null; }
  }
  function chime() {
    if (!actx) return;
    const t0 = actx.currentTime;
    [[784, 0], [1046.5, 0.18]].forEach(([f, dt]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(0.18, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.9);
      o.connect(g).connect(actx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 1);
    });
  }

  /* ---------- weather (Open-Meteo, no key needed) ---------- */
  const WMO = [
    [[0], "Clear", "sun"], [[1], "Mostly clear", "partly"], [[2], "Partly cloudy", "partly"], [[3], "Overcast", "cloud"],
    [[45, 48], "Fog", "fog"], [[51, 53, 55, 56, 57], "Drizzle", "rain"], [[61, 63, 65, 66, 67], "Rain", "rain"],
    [[71, 73, 75, 77], "Snow", "snow"], [[80, 81, 82], "Showers", "rain"], [[85, 86], "Snow showers", "snow"],
    [[95, 96, 99], "Thunderstorms", "storm"]
  ];
  function wmo(code, isDay) {
    for (const row of WMO) if (row[0].indexOf(code) !== -1) {
      const ic = (row[2] === "sun" && isDay === 0) ? "moon" : row[2];
      return { text: row[1], icon: ic };
    }
    return { text: "—", icon: "cloud" };
  }
  const inflight = {};
  async function fetchWeather(w) {
    const o = w.opts, q = (o.city || "").trim();
    if (!q && !(o.lat && o.lon)) return;
    const key = w.id;
    if (inflight[key]) return inflight[key];
    inflight[key] = (async () => {
      let lat = o.lat, lon = o.lon, place = o.place || q;
      if (q && (!lat || o.geoFor !== q)) {
        const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(q));
        if (!r.ok) throw new Error("lookup failed");
        const j = await r.json();
        if (!j.results || !j.results.length) throw new Error("notfound");
        const g = j.results[0];
        lat = g.latitude; lon = g.longitude; place = g.name;
        o.lat = lat; o.lon = lon; o.place = place; o.geoFor = q;
      }
      const unit = o.units === "c" ? "celsius" : "fahrenheit";
      const r2 = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
        "&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto&temperature_unit=" + unit);
      if (!r2.ok) throw new Error("forecast failed");
      const f = await r2.json();
      w.data = {
        place, temp: Math.round(f.current.temperature_2m), code: f.current.weather_code, isDay: f.current.is_day,
        hi: Math.round(f.daily.temperature_2m_max[0]), lo: Math.round(f.daily.temperature_2m_min[0]),
        units: o.units, at: Date.now(), q: q + "|" + o.units
      };
    })().finally(() => { delete inflight[key]; });
    return inflight[key];
  }

  /* ---------- the library ---------- */
  const TZ_COMMON = ["", "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "America/Toronto", "America/Mexico_City", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
    "Europe/Madrid", "Europe/Istanbul", "Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Asia/Dubai",
    "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Seoul", "Asia/Tokyo",
    "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu"];

  const T = {};

  T.clock = {
    name: "Clock", desc: "The time, anywhere", cat: "time", icon: "clock",
    make: () => ({ opts: { hour12: !/^en-GB|^de|^fr|^es|^it|^ja|^zh|^ko|^ru|^pt/.test(navigator.language || ""), seconds: false, showDate: false, tz: "" } }),
    options: [
      { key: "hour12", label: "12-hour clock", type: "toggle" },
      { key: "seconds", label: "Seconds", type: "toggle" },
      { key: "showDate", label: "Date underneath", type: "toggle" },
      { key: "tz", label: "Time zone", type: "tz" }
    ],
    render(c) {
      const o = c.w.opts;
      const tzLabel = o.tz ? o.tz.split("/").pop().replace(/_/g, " ") : "";
      caption(c, tzLabel);
      const t = c.root.appendChild(h("div", "clock-time"));
      const main = t.appendChild(h("span", "ct-main"));
      const ap = t.appendChild(h("span", "ct-ap"));
      const dl = o.showDate ? c.root.appendChild(h("div", "clock-date")) : null;
      let last = "";
      function tick(now) {
        const p = timeParts(now, o);
        const s = p.main + p.ap + (dl ? p.date : "");
        if (s === last) return false;
        last = s;
        main.textContent = p.main; ap.textContent = p.ap;
        if (dl) dl.textContent = p.date;
        return true;
      }
      tick(new Date());
      return { tick };
    }
  };

  T.date = {
    name: "Date", desc: "Today, in your format", cat: "time", icon: "date",
    make: () => ({ opts: { style: "long" } }),
    options: [{ key: "style", label: "Format", type: "select",
      choices: [["long", "Wednesday / November 18"], ["short", "Wed 18 Nov"], ["dots", "11.18"], ["iso", "2026-11-18"]] }],
    render(c) {
      const o = c.w.opts;
      caption(c, "");
      const top = o.style === "long" ? c.root.appendChild(h("div", "date-day")) : null;
      const big = c.root.appendChild(h("div", "date-big"));
      let last = "";
      function tick(now) {
        const k = dayKey(now) + o.style;
        if (k === last) return false;
        last = k;
        if (o.style === "long") {
          top.textContent = fmt({ weekday: "long" }).format(now);
          big.textContent = fmt({ month: "long", day: "numeric" }).format(now);
        } else if (o.style === "short") {
          big.textContent = fmt({ weekday: "short", day: "numeric", month: "short" }).format(now);
        } else if (o.style === "dots") {
          big.textContent = pad(now.getMonth() + 1) + "." + pad(now.getDate());
        } else big.textContent = dayKey(now);
        return true;
      }
      tick(new Date());
      return { tick };
    }
  };

  T.calendar = {
    name: "Calendar", desc: "This month at a glance", cat: "time", icon: "calendar",
    make: () => ({ opts: { monday: false } }),
    options: [{ key: "monday", label: "Week starts Monday", type: "toggle" }],
    render(c) {
      const o = c.w.opts;
      const cap = caption(c, "month");
      const grid = c.root.appendChild(h("div", "cal-grid"));
      let last = "";
      function build(now) {
        grid.innerHTML = "";
        if (cap && c.w.title === undefined) cap.textContent = fmt({ month: "long", year: "numeric" }).format(now);
        const names = [];
        for (let i = 0; i < 7; i++) names.push(fmt({ weekday: "narrow" }).format(new Date(2023, 0, 1 + i + (o.monday ? 1 : 0))));
        names.forEach(n => grid.appendChild(h("div", "cal-head", n)));
        const y = now.getFullYear(), m = now.getMonth();
        let first = new Date(y, m, 1).getDay();
        if (o.monday) first = (first + 6) % 7;
        const days = new Date(y, m + 1, 0).getDate();
        for (let i = 0; i < first; i++) grid.appendChild(h("div", "cal-cell blank"));
        for (let d = 1; d <= days; d++) {
          const cell = grid.appendChild(h("div", "cal-cell" + (d === now.getDate() ? " today" : ""), String(d)));
          const wd = new Date(y, m, d).getDay();
          if (wd === 0 || wd === 6) cell.classList.add("wkend");
        }
        const total = first + days;
        for (let i = total; i < 42; i++) grid.appendChild(h("div", "cal-cell blank"));
      }
      function tick(now) { const k = dayKey(now); if (k === last) return false; last = k; build(now); return true; }
      tick(new Date());
      return { tick };
    }
  };

  T.weather = {
    name: "Weather", desc: "Now, plus today's high and low", cat: "time", icon: "weather",
    make: () => ({ opts: { city: cityFromTZ(), units: prefersF() ? "f" : "c" }, data: null }),
    options: [
      { key: "city", label: "City", type: "text", placeholder: "e.g. Tuscaloosa", commit: true },
      { key: "units", label: "Units", type: "seg", choices: [["f", "°F"], ["c", "°C"]] }
    ],
    render(c) {
      const w = c.w, o = w.opts;
      const cap = caption(c, "Weather");
      const row = c.root.appendChild(h("div", "wx-row"));
      const ic = row.appendChild(h("div", "wx-ic"));
      const temp = row.appendChild(h("div", "wx-temp"));
      const line = c.root.appendChild(h("div", "wx-line"));
      let err = "";
      function paint() {
        let d = w.data;
        if (c.preview && !d) d = { place: o.city || "Your city", temp: o.units === "c" ? 21 : 70, code: 1, isDay: 1, hi: o.units === "c" ? 24 : 75, lo: o.units === "c" ? 13 : 56 };
        if (!o.city && !o.lat && !c.preview) {
          ic.innerHTML = SS.icon("weather"); temp.textContent = "—";
          line.textContent = "Add a city in the panel";
          return;
        }
        if (!d) { ic.innerHTML = SS.icon("cloud"); temp.textContent = "…"; line.textContent = err || "Loading"; return; }
        const k = wmo(d.code, d.isDay);
        ic.innerHTML = SS.icon(k.icon);
        temp.textContent = d.temp + "°";
        line.textContent = (err ? err + " · " : "") + k.text + " · H " + d.hi + "°  L " + d.lo + "°";
        if (cap && w.title === undefined && d.place) cap.textContent = d.place;
      }
      function stale() {
        const d = w.data;
        return !d || d.q !== (o.city || "").trim() + "|" + o.units || Date.now() - d.at > 30 * 60e3;
      }
      function refresh() {
        if (c.preview || !(o.city || o.lat) || !stale()) return;
        fetchWeather(w).then(() => { err = ""; c.save(); paint(); c.relayout(); })
          .catch(e => {
            err = e && e.message === "notfound" ? "Couldn't find “" + o.city + "”" : "Offline";
            paint(); c.relayout();
          });
      }
      paint(); refresh();
      let n = 0;
      return { tick() { if (++n % 60 === 0) refresh(); return false; } };
    }
  };

  T.countdown = {
    name: "Countdown", desc: "Days until something", cat: "time", icon: "countdown",
    make: () => {
      const d = new Date(); d.setMonth(d.getMonth() + 1);
      return { opts: { title: "the launch", date: dayKey(d) } };
    },
    options: [
      { key: "title", label: "Until", type: "text", placeholder: "the launch" },
      { key: "date", label: "Date", type: "date" }
    ],
    render(c) {
      const o = c.w.opts;
      caption(c, "Countdown");
      const num = c.root.appendChild(h("div", "cd-num"));
      const sub = c.root.appendChild(h("div", "cd-sub"));
      let last = "";
      function tick(now) {
        const k = dayKey(now);
        if (k === last) return false;
        last = k;
        const [y, m, d] = (o.date || k).split("-").map(Number);
        const target = new Date(y, m - 1, d), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const days = Math.round((target - today) / 864e5);
        const what = o.title || "the day";
        if (days > 0) { num.textContent = days; sub.textContent = (days === 1 ? "day" : "days") + " until " + what; }
        else if (days === 0) { num.textContent = "Today"; sub.textContent = what; }
        else { num.textContent = -days; sub.textContent = (days === -1 ? "day" : "days") + " since " + what; }
        return true;
      }
      tick(new Date());
      return { tick };
    }
  };

  T.text = {
    name: "Text", desc: "A heading, quote or label", cat: "time", icon: "text",
    make: () => ({ opts: { text: "Make something good today.", weight: "400" } }),
    options: [
      { key: "text", label: "Text", type: "textarea" },
      { key: "weight", label: "Weight", type: "seg", choices: [["300", "Light"], ["400", "Regular"], ["600", "Bold"]] }
    ],
    render(c) {
      const o = c.w.opts;
      caption(c, "");
      const t = c.root.appendChild(h("div", "w-text", o.text || " "));
      t.style.fontWeight = o.weight || "400";
    }
  };

  T.focus = {
    name: "Focus", desc: "One intention for today", cat: "focus", icon: "focus",
    make: () => ({ data: "" }),
    options: [],
    render(c) {
      caption(c, "Focus");
      const inp = c.root.appendChild(h("input", "w-input focus-in"));
      inp.placeholder = "Today, I will…";
      inp.value = typeof c.w.data === "string" ? c.w.data : "";
      inp.setAttribute("aria-label", "Today's focus");
      inp.addEventListener("input", () => { c.w.data = inp.value; c.save(); });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    }
  };

  T.tasks = {
    name: "Tasks", desc: "A short checklist", cat: "focus", icon: "tasks",
    make: () => ({ data: [] }),
    options: [],
    render(c) {
      if (!Array.isArray(c.w.data)) c.w.data = [];
      caption(c, "Tasks");
      const list = c.root.appendChild(h("div", "tk-list"));
      const add = c.root.appendChild(h("input", "w-input tk-add"));
      add.placeholder = "Add a task";
      add.setAttribute("aria-label", "Add a task");
      const foot = c.root.appendChild(h("div", "tk-foot"));
      function paint() {
        list.innerHTML = "";
        c.w.data.forEach((t, i) => {
          const row = list.appendChild(h("div", "tk-row" + (t.done ? " done" : "")));
          const ck = row.appendChild(h("button", "w-check" + (t.done ? " on" : "")));
          ck.type = "button"; ck.innerHTML = SS.icon("check");
          ck.setAttribute("aria-label", (t.done ? "Mark not done: " : "Mark done: ") + t.text);
          ck.addEventListener("click", () => { t.done = !t.done; c.save(); paint(); });
          row.appendChild(h("span", "tk-text", t.text));
          const x = row.appendChild(h("button", "w-x"));
          x.type = "button"; x.innerHTML = SS.icon("x"); x.setAttribute("aria-label", "Remove " + t.text);
          x.addEventListener("click", () => { c.w.data.splice(i, 1); c.save(); paint(); });
        });
        foot.innerHTML = "";
        const done = c.w.data.filter(t => t.done).length;
        if (c.w.data.length) {
          foot.appendChild(h("span", null, done + " of " + c.w.data.length + " done"));
          if (done) foot.appendChild(btn("Clear done", () => { c.w.data = c.w.data.filter(t => !t.done); c.save(); paint(); }, "w-link"));
        }
        c.relayout();
      }
      add.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && add.value.trim()) {
          c.w.data.push({ text: add.value.trim(), done: false });
          add.value = ""; c.save(); paint();
        }
      });
      paint();
    }
  };

  T.notes = {
    name: "Notes", desc: "A scratchpad", cat: "focus", icon: "notes",
    make: () => ({ data: "" }),
    options: [{ key: "lines", label: "Height", type: "seg", choices: [["5", "Short"], ["9", "Medium"], ["14", "Tall"]] }],
    render(c) {
      caption(c, "Notes");
      const ta = c.root.appendChild(h("textarea", "w-area"));
      ta.placeholder = "Notes to self…";
      ta.value = typeof c.w.data === "string" ? c.w.data : "";
      ta.rows = +(c.w.opts.lines || 9);
      ta.setAttribute("aria-label", "Notes");
      ta.addEventListener("input", () => { c.w.data = ta.value; c.save(); });
    }
  };

  T.pomodoro = {
    name: "Pomodoro", desc: "Focus and break cycles", cat: "focus", icon: "pomodoro",
    make: () => ({ data: { phase: "work", left: 25 * 60, done: 0, day: dayKey() },
                   opts: { work: 25, short: 5, long: 15, sound: true } }),
    options: [
      { key: "work", label: "Focus minutes", type: "number", min: 1, max: 180 },
      { key: "short", label: "Short break", type: "number", min: 1, max: 60 },
      { key: "long", label: "Long break", type: "number", min: 1, max: 90 },
      { key: "sound", label: "Chime when done", type: "toggle" }
    ],
    render(c) {
      const o = c.w.opts;
      const d = (c.w.data && typeof c.w.data === "object") ? c.w.data : (c.w.data = { phase: "work", left: o.work * 60, done: 0 });
      const LEN = (p) => 60 * Math.max(1, +(p === "work" ? o.work : p === "short" ? o.short : o.long) || 1);
      const NAME = { work: "Focus", short: "Short break", long: "Long break" };
      if (d.day !== dayKey()) { d.day = dayKey(); d.done = 0; }
      if (typeof d.left !== "number" || d.left > LEN(d.phase)) d.left = LEN(d.phase);

      caption(c, "Pomodoro");
      const phase = c.root.appendChild(h("div", "pm-phase"));
      const time = c.root.appendChild(h("div", "pm-time"));
      const bar = c.root.appendChild(h("div", "w-bar"));
      const fill = bar.appendChild(h("i"));
      const dots = c.root.appendChild(h("div", "pm-dots"));
      const row = c.root.appendChild(h("div", "w-row"));
      const rem = () => d.endsAt ? Math.max(0, Math.round((d.endsAt - Date.now()) / 1000)) : d.left;

      const startBtn = btn("Start", () => {
        if (d.endsAt) { d.left = rem(); d.endsAt = null; }
        else { wakeAudio(); d.endsAt = Date.now() + d.left * 1000; }
        c.save(); paint();
      }, "primary", "play");
      row.appendChild(startBtn);
      row.appendChild(btn("", () => { d.endsAt = null; d.left = LEN(d.phase); c.save(); paint(); }, "icon", "reset"));
      row.appendChild(btn("", () => advance(false), "icon", "skip"));
      startBtn.title = "Start or pause";

      function advance(natural) {
        if (d.phase === "work") { d.done++; d.phase = (d.done % 4 === 0) ? "long" : "short"; }
        else d.phase = "work";
        d.left = LEN(d.phase); d.endsAt = null;
        if (natural && o.sound) chime();
        c.save(); paint();
      }
      function paint() {
        const r = rem();
        phase.textContent = NAME[d.phase];
        time.textContent = Math.floor(r / 60) + ":" + pad(r % 60);
        fill.style.width = (100 * (1 - r / LEN(d.phase))).toFixed(2) + "%";
        dots.innerHTML = "";
        for (let i = 0; i < 4; i++) dots.appendChild(h("i", i < d.done % 4 || (d.done && d.done % 4 === 0 && d.phase === "long") ? "on" : ""));
        dots.appendChild(h("span", null, d.done + " today"));
        const run = !!d.endsAt;
        if (run !== wasRunning) {
          wasRunning = run;
          startBtn.querySelector("span").textContent = run ? "Pause" : "Start";
          startBtn.querySelector("svg").outerHTML = SS.icon(run ? "pause" : "play");
          const shell = c.root.closest(".widget");
          if (shell) shell.classList.toggle("running", run);
        }
      }
      let wasRunning = null;
      paint();
      return {
        tick() { if (d.endsAt) { if (rem() <= 0) advance(true); else paint(); } return false; },
        status() { if (!d.endsAt) return null; const r = rem(); return Math.floor(r / 60) + ":" + pad(r % 60) + " · " + NAME[d.phase]; }
      };
    }
  };

  T.goal = {
    name: "Goal", desc: "Progress toward a target", cat: "focus", icon: "goal",
    make: () => ({ data: { title: "", current: 0, target: 10, unit: "" } }),
    options: [
      { key: "target", label: "Target", type: "number", min: 1, max: 1e6, in: "data" },
      { key: "unit", label: "Unit", type: "text", placeholder: "e.g. pages", in: "data" }
    ],
    render(c) {
      const d = (c.w.data && typeof c.w.data === "object") ? c.w.data : (c.w.data = { title: "", current: 0, target: 10, unit: "" });
      caption(c, "Goal");
      const title = c.root.appendChild(h("input", "w-input"));
      title.placeholder = "What are you working toward?";
      title.value = d.title || "";
      title.setAttribute("aria-label", "Goal");
      title.addEventListener("input", () => { d.title = title.value; c.save(); });
      const num = c.root.appendChild(h("div", "gl-num"));
      const bar = c.root.appendChild(h("div", "w-bar"));
      const fill = bar.appendChild(h("i"));
      const row = c.root.appendChild(h("div", "w-row"));
      const pct = row.appendChild(h("span", "gl-pct"));
      row.appendChild(h("span", "w-grow"));
      row.appendChild(btn("", () => { d.current = Math.max(0, d.current - 1); c.save(); paint(); }, "icon", "minus"));
      row.appendChild(btn("+1", () => { d.current++; c.save(); paint(); }, "primary"));
      function paint() {
        const t = Math.max(1, +d.target || 1);
        const p = Math.min(100, Math.round(d.current / t * 100));
        num.innerHTML = "";
        num.appendChild(h("b", null, String(d.current)));
        num.appendChild(document.createTextNode(" / " + t + (d.unit ? " " + d.unit : "")));
        fill.style.width = p + "%";
        pct.textContent = p >= 100 ? "Done — nice." : p + "%";
      }
      paint();
    }
  };

  T.streak = {
    name: "Tracker", desc: "Count anything, keep a chain", cat: "focus", icon: "streak",
    make: () => ({ data: { name: "", unit: "days", count: 0, days: [] } }),
    options: [],
    render(c) {
      const d = (c.w.data && typeof c.w.data === "object") ? c.w.data : (c.w.data = { name: "", unit: "days", count: 0, days: [] });
      if (!Array.isArray(d.days)) d.days = [];
      if (typeof d.unit !== "string") d.unit = "days";
      if (typeof d.count !== "number") d.count = 0;
      caption(c, "Tracker");
      const name = c.root.appendChild(h("input", "w-input"));
      name.placeholder = "What are you tracking?";
      name.value = d.name || "";
      name.setAttribute("aria-label", "What you are tracking");
      name.addEventListener("input", () => { d.name = name.value; c.save(); });
      const line = c.root.appendChild(h("div", "st-line"));
      const num = line.appendChild(h("div", "st-num"));
      const unit = line.appendChild(h("input", "st-unit"));
      unit.value = d.unit; unit.setAttribute("aria-label", "Unit");
      unit.addEventListener("input", () => { d.unit = unit.value; size(); c.save(); });
      const chain = c.root.appendChild(h("div", "st-chain"));
      const row = c.root.appendChild(h("div", "w-row"));
      row.appendChild(btn("", () => { d.count = Math.max(0, d.count - 1); c.save(); paint(); }, "icon", "minus"));
      row.appendChild(btn("", () => { d.count++; c.save(); paint(); }, "icon", "plus"));
      row.appendChild(h("span", "w-grow"));
      const mark = row.appendChild(btn("Mark today", () => {
        const k = dayKey(), i = d.days.indexOf(k);
        if (i === -1) { d.days.push(k); d.count++; } else { d.days.splice(i, 1); d.count = Math.max(0, d.count - 1); }
        c.save(); paint();
      }, "primary"));
      function size() { unit.style.width = Math.max(3, unit.value.length + 1) + "ch"; }
      let last = "";
      function paint() {
        num.textContent = d.count; size();
        chain.innerHTML = "";
        const today = dayKey();
        for (let i = 13; i >= 0; i--) {
          const k = shiftDay(today, -i);
          const dot = chain.appendChild(h("i", d.days.indexOf(k) !== -1 ? "on" : ""));
          dot.title = k;
        }
        mark.querySelector("span").textContent = d.days.indexOf(today) !== -1 ? "Done today" : "Mark today";
        mark.classList.toggle("on", d.days.indexOf(today) !== -1);
        last = today;
      }
      paint();
      return { tick() { if (dayKey() !== last) paint(); return false; } };
    }
  };

  function logWidget(kind) {
    return function render(c) {
      if (!Array.isArray(c.w.data)) c.w.data = [];
      caption(c, kind === "wins" ? "Wins" : "Capture");
      const inp = c.root.appendChild(h("input", "w-input"));
      inp.placeholder = kind === "wins" ? "Something that went well…" : "Park a thought…";
      inp.setAttribute("aria-label", inp.placeholder);
      const list = c.root.appendChild(h("div", "lg-list"));
      function paint() {
        list.innerHTML = "";
        c.w.data.slice(0, 7).forEach((it, i) => {
          const row = list.appendChild(h("div", "lg-row"));
          const text = typeof it === "string" ? it : it.text;
          row.appendChild(h("span", "lg-text", text));
          if (it && it.date) row.appendChild(h("span", "lg-date", it.date.slice(5).replace("-", "/")));
          const x = row.appendChild(h("button", "w-x"));
          x.type = "button"; x.innerHTML = SS.icon("x"); x.setAttribute("aria-label", "Remove");
          x.addEventListener("click", () => { c.w.data.splice(i, 1); c.save(); paint(); });
        });
        if (c.w.data.length > 7) list.appendChild(h("div", "lg-more", "+" + (c.w.data.length - 7) + " more"));
        c.relayout();
      }
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && inp.value.trim()) {
          c.w.data.unshift(kind === "wins" ? { text: inp.value.trim(), date: dayKey() } : inp.value.trim());
          inp.value = ""; c.save(); paint();
        }
      });
      paint();
    };
  }
  T.capture = { name: "Capture", desc: "Park a thought for later", cat: "focus", icon: "capture",
    make: () => ({ data: [] }), options: [], render: logWidget("capture") };
  T.wins = { name: "Wins", desc: "A log of what went well", cat: "focus", icon: "wins",
    make: () => ({ data: [] }), options: [], render: logWidget("wins") };

  T.checkin = {
    name: "Check-in", desc: "Mood and energy, daily", cat: "focus", icon: "checkin",
    make: () => ({ data: { date: dayKey(), mood: 0, energy: 0, log: {} } }),
    options: [],
    render(c) {
      const d = (c.w.data && typeof c.w.data === "object") ? c.w.data : (c.w.data = {});
      if (!d.log) d.log = {};
      if (d.date !== dayKey()) { d.date = dayKey(); d.mood = 0; d.energy = 0; }
      caption(c, "Check-in");
      function scale(key, label) {
        c.root.appendChild(h("div", "ck-label", label));
        const row = c.root.appendChild(h("div", "ck-row"));
        for (let i = 1; i <= 5; i++) {
          const b = row.appendChild(h("button", "ck-b" + (d[key] === i ? " on" : ""), String(i)));
          b.type = "button";
          b.setAttribute("aria-label", label + " " + i + " of 5");
          b.addEventListener("click", () => {
            d[key] = d[key] === i ? 0 : i;
            d.log[dayKey()] = [d.mood, d.energy];
            c.save();
            Array.from(row.children).forEach((x, j) => x.classList.toggle("on", d[key] === j + 1));
            week();
          });
        }
      }
      scale("mood", "Mood");
      scale("energy", "Energy");
      const wk = c.root.appendChild(h("div", "ck-week"));
      function week() {
        wk.innerHTML = "";
        const today = dayKey();
        for (let i = 6; i >= 0; i--) {
          const k = shiftDay(today, -i), v = d.log[k] || [0, 0];
          const col = wk.appendChild(h("div", "ck-col"));
          const bar = col.appendChild(h("i"));
          bar.style.height = (v[0] ? 18 + v[0] * 16 : 6) + "%";
          if (!v[0]) bar.classList.add("empty");
          col.title = k + (v[0] ? " · mood " + v[0] + ", energy " + v[1] : "");
        }
      }
      week();
    }
  };

  const CATS = [["time", "Time & information"], ["focus", "Focus & motivation"]];

  function create(type, extra) {
    const def = T[type];
    const base = def.make ? def.make() : {};
    const w = Object.assign({ id: SS.store.uid(), type, x: 0, y: 0, fs: 1, opts: {} }, base, extra || {});
    w.opts = Object.assign({}, base.opts || {}, (extra && extra.opts) || {});
    return w;
  }

  SS.widgets = { types: T, cats: CATS, create, dayKey, localTZ, TZ_COMMON, wakeAudio };
})(window.SS = window.SS || {});
