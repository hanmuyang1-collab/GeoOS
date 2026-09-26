/* GeoOS desktop — real windowed OS on top of the local geov server.
   Talks to the server when available (geov deploy); falls back to a
   self-contained demo mode so the static preview still works. */

let DEMO = false;
let RUNTIMES = { geovariable: { version: 1 }, python: { version: "demo" } };

/* ============================ API layer ============================ */
async function api(path, body) {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return r.json();
}
async function apiGet(path) {
  const r = await fetch(path, { cache: "no-store" });
  return r.json();
}

/* ============================ settings ============================ */
const SETTINGS_KEY = "geovos-settings";
let settings = { accent: "cyan", wallpaper: "nebula" };

async function loadSettings() {
  try {
    if (DEMO) {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) settings = Object.assign(settings, JSON.parse(s));
    } else {
      const s = await apiGet("/api/settings");
      if (s && !s.error) settings = Object.assign(settings, s);
    }
  } catch (e) { /* keep defaults */ }
  applySettings();
}

function applySettings() {
  document.body.dataset.accent = settings.accent || "cyan";
  document.getElementById("screen").dataset.wp = settings.wallpaper || "nebula";
}

async function saveSettings() {
  applySettings();
  if (DEMO) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  else await api("/api/settings", { settings });
}

/* ============================ window manager ============================ */
let winSeq = 0, zTop = 10;
const wins = new Map();   // wid -> win

function openApp(id, opts = {}) {
  const app = APPS[id];
  if (!app) return null;
  if (app.singleton) {
    for (const w of wins.values()) {
      if (w.id === id) { restoreWin(w.wid); focusWin(w.wid); return w; }
    }
  }
  const wid = id + "-" + (++winSeq);
  const screen = document.getElementById("screen");
  const [W, H] = app.size;
  const w = Math.min(W, screen.clientWidth - 16);
  const h = Math.min(H, screen.clientHeight - 16);
  const off = (winSeq % 7) * 26;
  const el = document.createElement("div");
  el.className = "window";
  el.dataset.wid = wid;
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.left = Math.max(6, Math.min(screen.clientWidth - w - 6,
    (screen.clientWidth - w) / 2 - 140 + off)) + "px";
  el.style.top = Math.max(6, Math.min(screen.clientHeight - h - 6,
    (screen.clientHeight - h) / 2 - 30 + off)) + "px";
  el.innerHTML =
    `<div class="w-titlebar"><span class="w-glyph">${app.glyph}</span>` +
    `<span class="w-title">${app.title}</span>` +
    `<div class="w-btns"><button class="w-min" title="Minimize">–</button>` +
    `<button class="w-max" title="Maximize">&#9634;</button>` +
    `<button class="w-close" title="Close">&#10005;</button></div></div>` +
    `<div class="w-body"></div><div class="w-resize"></div>`;
  document.getElementById("winlayer").appendChild(el);
  const win = { id, wid, el, app, minimized: false, prevRect: null, cleanup: null };
  wins.set(wid, win);
  wireWindow(win);
  app.mount(el.querySelector(".w-body"), win, opts);
  focusWin(wid);
  renderDock();
  return win;
}

function focusWin(wid) {
  const w = wins.get(wid);
  if (!w) return;
  w.el.style.zIndex = ++zTop;
  for (const x of wins.values()) x.el.classList.toggle("focused", x === w);
  document.getElementById("menubar-app").textContent = w.app.title;
}

function minimizeWin(wid) {
  const w = wins.get(wid);
  if (!w) return;
  w.minimized = true;
  w.el.style.display = "none";
  document.getElementById("menubar-app").textContent = "Desktop";
  renderDock();
}

function restoreWin(wid) {
  const w = wins.get(wid);
  if (!w) return;
  w.minimized = false;
  w.el.style.display = "flex";
  renderDock();
}

function toggleMaxWin(wid) {
  const w = wins.get(wid);
  if (!w) return;
  if (w.prevRect) {
    Object.assign(w.el.style, w.prevRect);
    w.prevRect = null;
    w.el.classList.remove("maximized");
  } else {
    w.prevRect = { left: w.el.style.left, top: w.el.style.top,
                   width: w.el.style.width, height: w.el.style.height };
    Object.assign(w.el.style, { left: "0px", top: "0px", width: "100%", height: "100%" });
    w.el.classList.add("maximized");
  }
}

function closeWin(wid) {
  const w = wins.get(wid);
  if (!w) return;
  if (w.cleanup) { try { w.cleanup(); } catch (e) {} }
  w.el.remove();
  wins.delete(wid);
  document.getElementById("menubar-app").textContent = "Desktop";
  renderDock();
}

function wireWindow(win) {
  const el = win.el;
  const bar = el.querySelector(".w-titlebar");
  el.addEventListener("pointerdown", () => focusWin(win.wid), true);

  // drag
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    if (win.prevRect) toggleMaxWin(win.wid);  // drag out of maximized
    const rect = el.getBoundingClientRect();
    const layer = document.getElementById("winlayer").getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const move = (ev) => {
      let x = ev.clientX - layer.left - dx;
      let y = ev.clientY - layer.top - dy;
      x = Math.max(-rect.width + 90, Math.min(layer.width - 70, x));
      y = Math.max(0, Math.min(layer.height - 36, y));
      el.style.left = x + "px";
      el.style.top = y + "px";
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
  bar.addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) toggleMaxWin(win.wid);
  });

  // resize
  const rz = el.querySelector(".w-resize");
  rz.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, sw = rect.width, sh = rect.height;
    const move = (ev) => {
      el.style.width = Math.max(280, sw + ev.clientX - sx) + "px";
      el.style.height = Math.max(180, sh + ev.clientY - sy) + "px";
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });

  el.querySelector(".w-min").onclick = () => minimizeWin(win.wid);
  el.querySelector(".w-max").onclick = () => toggleMaxWin(win.wid);
  el.querySelector(".w-close").onclick = () => closeWin(win.wid);
}

function minimizeAll() {
  for (const w of wins.values()) { w.minimized = true; w.el.style.display = "none"; }
  document.getElementById("menubar-app").textContent = "Desktop";
  renderDock();
}

/* ============================ dock + icons ============================ */
function renderDock() {
  const dock = document.getElementById("dock");
  dock.innerHTML = "";
  for (const [id, app] of Object.entries(APPS)) {
    const running = [...wins.values()].filter(w => w.id === id);
    const d = document.createElement("div");
    d.className = "dock-item" + (running.length ? " running" : "");
    d.innerHTML = `<span class="dock-glyph">${app.glyph}</span><span>${app.title}</span>`;
    d.title = app.title + (running.length ? ` (${running.length} open)` : "");
    d.onclick = () => {
      if (running.length) {
        const w = running[running.length - 1];
        if (w.minimized) restoreWin(w.wid);
        focusWin(w.wid);
      } else openApp(id);
    };
    dock.appendChild(d);
  }
  const status = document.createElement("span");
  status.className = "dock-status";
  status.id = "dock-status";
  status.textContent = DEMO ? "demo mode" : "sandboxed · connected";
  dock.appendChild(status);
}

function renderIcons() {
  const box = document.getElementById("icons");
  box.innerHTML = "";
  for (const [id, app] of Object.entries(APPS)) {
    if (!app.desktop) continue;
    const d = document.createElement("div");
    d.className = "icon";
    d.innerHTML = `<div class="icon-glyph">${app.glyph}</div><span>${app.title}</span>`;
    d.onclick = () => {
      document.querySelectorAll(".icon").forEach(x => x.classList.remove("sel"));
      d.classList.add("sel");
    };
    d.ondblclick = () => openApp(id);
    box.appendChild(d);
  }
}

/* ============================ boot ============================ */
function tickClock() {
  const d = new Date();
  document.getElementById("clock").textContent =
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

window.addEventListener("load", async () => {
  tickClock(); setInterval(tickClock, 1000);
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    if (!r.ok) throw 0;
    const j = await r.json();
    if (!j.ok) throw 0;
    try { RUNTIMES = await apiGet("/api/runtimes"); } catch (e) {}
  } catch {
    DEMO = true;
    document.getElementById("demo-badge").hidden = false;
  }
  await loadSettings();
  renderIcons();
  renderDock();
  document.getElementById("brand-btn").onclick = minimizeAll;
  document.getElementById("host-btn").onclick = () => openApp("host");
  setTimeout(() => {
    document.getElementById("boot").classList.add("done");
    document.getElementById("desktop").hidden = false;
  }, 1300);
});


/* ============================ terminal app ============================ */
function mountTerminal(body, win) {
  body.innerHTML =
    `<div class="term-wrap"><div class="term-out"></div>` +
    `<div class="term-input-row"><span class="term-prompt"></span>` +
    `<input class="term-in" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="type 'help' ..."></div></div>`;
  const out = body.querySelector(".term-out");
  const inp = body.querySelector(".term-in");
  const promptEl = body.querySelector(".term-prompt");
  const session = win.wid;
  let cwd = "/home/user";
  const hist = []; let histIdx = -1;

  const print = (text, cls) => {
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text + (text.endsWith("\n") ? "" : "\n");
    out.appendChild(span);
    out.scrollTop = out.scrollHeight;
  };
  const promptText = () => {
    const short = cwd === "/home/user" ? "~" : cwd.replace("/home/user", "~");
    return `user@geov:${short}$`;
  };
  const setPrompt = () => { promptEl.textContent = promptText(); };

  print("GeoOS 0.3.0 (Geode) — geosh 0.3" + (DEMO ? "  [demo mode]" : ""));
  print("unified shell: linux + powershell + macos commands in one. type 'help'.\n");
  setPrompt();

  inp.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowUp") {
      if (hist.length) { histIdx = Math.max(0, histIdx < 0 ? hist.length - 1 : histIdx - 1); inp.value = hist[histIdx] || ""; }
      e.preventDefault(); return;
    }
    if (e.key === "ArrowDown") {
      if (histIdx >= 0) { histIdx = Math.min(hist.length - 1, histIdx + 1); inp.value = hist[histIdx] || ""; }
      e.preventDefault(); return;
    }
    if (e.key !== "Enter") return;
    const cmd = inp.value.trim();
    inp.value = "";
    if (!cmd) return;
    hist.push(cmd); histIdx = -1;
    print(promptText() + " " + cmd, "cmd-line");
    let res;
    try {
      if (DEMO) {
        const ctx = { cwd };
        res = demoShell(cmd, ctx);
        cwd = ctx.cwd;
      } else {
        const j = await api("/api/exec", { session, cmd });
        res = j.error ? "error: " + j.error : (j.output || "");
        if (j.cwd) cwd = j.cwd;
      }
    } catch (err) { res = "error: " + err.message; }
    if (res.includes("\x1bCLEAR\x1b")) { out.innerHTML = ""; setPrompt(); return; }
    if (res.includes("\x1bEXIT\x1b")) { closeWin(win.wid); return; }
    if (res) print(res, res.startsWith("error:") ? "err-line" : "");
    setPrompt();
  });
  body.addEventListener("pointerdown", () => setTimeout(() => inp.focus(), 0));
  setTimeout(() => inp.focus(), 50);
}
