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

/* ============================ app registry ============================ */
const APPS = {
  terminal: { title: "Terminal", glyph: "&gt;_", size: [740, 460], singleton: false, desktop: true, mount: mountTerminal },
  studio:   { title: "Code Studio", glyph: "&lt;/&gt;", size: [880, 580], singleton: false, desktop: true, mount: mountStudio },
  files:    { title: "Files", glyph: "&#128193;", size: [780, 490], singleton: false, desktop: true, mount: mountFiles },
  monitor:  { title: "Monitor", glyph: "&#9638;", size: [800, 540], singleton: true, desktop: true, mount: mountMonitor },
  paint:    { title: "Paint", glyph: "&#9998;", size: [780, 580], singleton: false, desktop: true, mount: mountPaint },
  calc:     { title: "Calculator", glyph: "=", size: [300, 430], singleton: false, desktop: true, mount: mountCalc },
  settings: { title: "Settings", glyph: "&#9881;", size: [580, 470], singleton: true, desktop: true, mount: mountSettings },
  help:     { title: "Help &amp; Docs", glyph: "?", size: [660, 540], singleton: true, desktop: true, mount: mountHelp },
  host:     { title: "Host OS", glyph: "&#x29C9;", size: [660, 500], singleton: true, desktop: false, mount: mountHost },
};

/* ============================ terminal app ============================ */
function mountTerminal(body, win) {
  body.innerHTML =
    `<div class="term-wrap"><div class="term-out"></div>` +
    `<div class="term-input-row"><span class="term-prompt"></span>` +
    `<input class="term-in" autocomplete="off" spellcheck="false" placeholder="type 'help' ..."></div></div>`;
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

  print("GeoOS 0.2.0 (Geode) — geosh 0.2" + (DEMO ? "  [demo mode]" : ""));
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

/* ============================ files app ============================ */
function mountFiles(body, win, opts) {
  body.innerHTML =
    `<div class="files-layout"><div class="files-side">` +
    `<div class="files-crumbs"><button data-a="up">&#8593;</button>` +
    `<span class="fs-path">/</span><button data-a="refresh">&#x21bb;</button></div>` +
    `<div class="fs-list"></div></div>` +
    `<div class="files-main"><div class="files-toolbar">` +
    `<span class="fs-file-name">no file open</span><span class="spacer"></span>` +
    `<button data-a="new">New file</button><button data-a="mkdir">New folder</button>` +
    `<button data-a="rename">Rename</button><button data-a="del">Delete</button>` +
    `<button data-a="save" disabled>Save</button></div>` +
    `<textarea class="fs-editor" placeholder="select a file, or create a new one" disabled></textarea>` +
    `</div></div>`;
  const list = body.querySelector(".fs-list");
  const pathEl = body.querySelector(".fs-path");
  const nameEl = body.querySelector(".fs-file-name");
  const editor = body.querySelector(".fs-editor");
  const saveBtn = body.querySelector('[data-a="save"]');
  let fsPath = "/home/user";
  let fsFile = null;

  const join = (base, name) => (base === "/" ? "" : base) + "/" + name;

  async function refresh() {
    pathEl.textContent = fsPath;
    let entries;
    if (DEMO) entries = demoLs(fsPath);
    else {
      const j = await apiGet("/api/fs?path=" + encodeURIComponent(fsPath));
      if (j.error) { list.innerHTML = `<div class="fs-item">${j.error}</div>`; return; }
      entries = j.entries;
    }
    list.innerHTML = "";
    for (const e of entries) {
      const div = document.createElement("div");
      div.className = "fs-item";
      div.innerHTML = `<span>${e.type === "dir" ? "&#128193;" : "&#128196;"}</span>` +
        `<span class="fname">${e.name}</span>` +
        `<span class="fsize">${e.type === "dir" ? "" : e.size + " B"}</span>`;
      div.ondblclick = () => e.type === "dir"
        ? (fsPath = join(fsPath, e.name), refresh())
        : openFile(join(fsPath, e.name));
      div.onclick = () => {
        list.querySelectorAll(".fs-item").forEach(x => x.style.background = "");
        div.style.background = "rgba(34,211,238,.14)";
        if (e.type === "file") openFile(join(fsPath, e.name));
      };
      list.appendChild(div);
    }
  }

  async function openFile(path) {
    let content;
    if (DEMO) { content = demoRead(path); if (content === null) return; }
    else {
      const j = await apiGet("/api/file?path=" + encodeURIComponent(path));
      if (j.error) { nameEl.textContent = j.error; return; }
      content = j.content;
    }
    fsFile = path;
    nameEl.textContent = path;
    editor.disabled = false; editor.value = content;
    saveBtn.disabled = false;
  }

  body.querySelector('[data-a="up"]').onclick = () => {
    if (fsPath !== "/") { fsPath = fsPath.replace(/\/[^/]+\/?$/, "") || "/"; refresh(); }
  };
  body.querySelector('[data-a="refresh"]').onclick = refresh;
  saveBtn.onclick = async () => {
    if (!fsFile) return;
    if (DEMO) demoWrite(fsFile, editor.value);
    else await api("/api/file", { path: fsFile, content: editor.value });
    nameEl.textContent = fsFile + "  (saved)";
    refresh();
  };
  body.querySelector('[data-a="new"]').onclick = async () => {
    const name = prompt("new file name (inside " + fsPath + "):");
    if (!name) return;
    fsFile = join(fsPath, name);
    if (DEMO) demoWrite(fsFile, "");
    else await api("/api/file", { path: fsFile, content: "" });
    editor.disabled = false; editor.value = "";
    nameEl.textContent = fsFile + "  (unsaved)";
    saveBtn.disabled = false;
    refresh();
  };
  body.querySelector('[data-a="mkdir"]').onclick = async () => {
    const name = prompt("new folder name (inside " + fsPath + "):");
    if (!name) return;
    if (DEMO) demoMkdir(join(fsPath, name));
    else await api("/api/fsop", { op: "mkdir", path: join(fsPath, name) });
    refresh();
  };
  body.querySelector('[data-a="rename"]').onclick = async () => {
    if (!fsFile) { alert("select a file first"); return; }
    const name = prompt("rename to:", fsFile.split("/").pop());
    if (!name) return;
    const to = join(fsPath, name);
    if (DEMO) demoRename(fsFile, to);
    else await api("/api/fsop", { op: "rename", path: fsFile, to });
    fsFile = to; nameEl.textContent = to;
    refresh();
  };
  body.querySelector('[data-a="del"]').onclick = async () => {
    if (!fsFile) { alert("select a file first"); return; }
    if (!confirm("delete " + fsFile + " ?")) return;
    if (DEMO) demoDelete(fsFile);
    else await api("/api/fsop", { op: "rm", path: fsFile });
    fsFile = null; editor.value = ""; editor.disabled = true;
    nameEl.textContent = "no file open"; saveBtn.disabled = true;
    refresh();
  };
  refresh();
}

/* ============================ code studio app ============================ */
const STUDIO_EXAMPLES = {
  hello: `let name = "GeoOS user"\nprint("hello " + name + "!")\nlet lucky = 7\nprint("lucky number:", lucky)\n`,
  fizzbuzz: `for i in 1..20 {\n    if i % 15 == 0 { print("FizzBuzz") }\n    elif i % 3 == 0 { print("Fizz") }\n    elif i % 5 == 0 { print("Buzz") }\n    else { print(i) }\n}\n`,
  fib: `fn fib(n) {\n    if n < 2 { return n }\n    return fib(n - 1) + fib(n - 2)\n}\nfor i in 0..12 { print(fib(i)) }\n`,
  loops: `let total = 0\nfor i in 1..100 {\n    if i % 2 == 0 { continue }\n    if i > 9 { break }\n    set total = total + i\n}\nprint("sum of odd 1..9:", total)\n\nlet n = 10\nwhile n > 0 { set n = n - 3 }\nprint("countdown ended at", n)\n`,
  python: `for i in range(1, 11):\n    print(f"{i:2d} squared is {i*i}")\nprint("hello from real python on", __import__("platform").system())\n`,
};

const LANG_BY_EXT = { gv: "geovariable", py: "python", js: "javascript",
                      sh: "bash", bash: "bash", md: "markdown", txt: "text", json: "json" };

function mountStudio(body, win, opts) {
  body.innerHTML =
    `<div class="studio-layout"><div class="studio-side">` +
    `<div class="files-crumbs"><span class="fs-path">/home/user</span><button data-a="refresh" title="Refresh">&#x21bb;</button></div>` +
    `<div class="fs-list"></div></div>` +
    `<div class="studio-main"><div class="studio-toolbar">` +
    `<span class="studio-file">untitled</span><span class="studio-lang">geovariable</span>` +
    `<span class="spacer"></span>` +
    `<select data-a="examples"><option value="">examples...</option>` +
    `<option value="hello">hello.gv</option><option value="fizzbuzz">fizzbuzz.gv</option>` +
    `<option value="fib">fib.gv</option><option value="loops">loops.gv</option>` +
    `<option value="python">python demo</option></select>` +
    `<button data-a="new">New</button><button data-a="save">Save</button>` +
    `<button data-a="hex">Hex</button>` +
    `<button class="btn-primary" data-a="run">&#9654; Run</button></div>` +
    `<textarea class="studio-editor" spellcheck="false"></textarea>` +
    `<div class="studio-out-wrap"><div class="studio-out-head">output` +
    `<span class="studio-status"></span></div>` +
    `<div class="studio-out">press Run to execute — .gv compiles to real .gvb bytecode, .py runs on the host python, .js on node</div>` +
    `</div></div></div>`;

  const editor = body.querySelector(".studio-editor");
  const outEl = body.querySelector(".studio-out");
  const statusEl = body.querySelector(".studio-status");
  const fileEl = body.querySelector(".studio-file");
  const langEl = body.querySelector(".studio-lang");
  const listEl = body.querySelector(".fs-list");
  const sidePathEl = body.querySelector(".fs-path");
  let curFile = null;
  let sidePath = "/home/user";

  const ext = (p) => (p.split(".").pop() || "").toLowerCase();
  const langOf = (p) => LANG_BY_EXT[ext(p)] || "text";
  const setLang = () => {
    const l = curFile ? langOf(curFile) : "geovariable";
    langEl.textContent = l;
    const rt = RUNTIMES[l] || (l === "bash" ? RUNTIMES.bash || RUNTIMES.sh : null);
    langEl.title = rt ? ("runtime: " + (rt.version || "available")) : "not runnable (edit only)";
  };
  const setStatus = (t) => { statusEl.textContent = t; };
  const setOut = (t, isErr) => {
    outEl.innerHTML = "";
    const s = document.createElement("span");
    if (isErr) s.className = "err";
    s.textContent = t;
    outEl.appendChild(s);
  };

  async function refreshSide() {
    sidePathEl.textContent = sidePath;
    let entries;
    if (DEMO) entries = demoLs(sidePath);
    else {
      const j = await apiGet("/api/fs?path=" + encodeURIComponent(sidePath));
      if (j.error) return;
      entries = j.entries;
    }
    listEl.innerHTML = "";
    if (sidePath !== "/") {
      const up = document.createElement("div");
      up.className = "fs-item";
      up.innerHTML = `<span>&#128193;</span><span class="fname">..</span>`;
      up.onclick = () => { sidePath = sidePath.replace(/\/[^/]+\/?$/, "") || "/"; refreshSide(); };
      listEl.appendChild(up);
    }
    for (const e of entries) {
      const div = document.createElement("div");
      div.className = "fs-item";
      div.innerHTML = `<span>${e.type === "dir" ? "&#128193;" : "&#128196;"}</span><span class="fname">${e.name}</span>`;
      const full = (sidePath === "/" ? "" : sidePath) + "/" + e.name;
      div.onclick = () => e.type === "dir" ? (sidePath = full, refreshSide()) : openFile(full);
      listEl.appendChild(div);
    }
  }

  async function openFile(path) {
    let content;
    if (DEMO) { content = demoRead(path); if (content === null) return; }
    else {
      const j = await apiGet("/api/file?path=" + encodeURIComponent(path));
      if (j.error) { setOut("error: " + j.error, true); return; }
      content = j.content;
    }
    curFile = path;
    fileEl.textContent = path;
    editor.value = content;
    setLang();
  }

  body.querySelector('[data-a="refresh"]').onclick = refreshSide;
  body.querySelector('[data-a="examples"]').onchange = (e) => {
    const k = e.target.value;
    if (k && STUDIO_EXAMPLES[k]) {
      editor.value = STUDIO_EXAMPLES[k];
      curFile = k === "python" ? "/home/user/untitled.py" : "/home/user/untitled.gv";
      fileEl.textContent = curFile + "  (unsaved)";
      setLang();
    }
    e.target.value = "";
  };
  body.querySelector('[data-a="new"]').onclick = async () => {
    const name = prompt("new file name (.gv .py .js .sh .md ...) — created on disk:");
    if (!name) return;
    const path = (sidePath === "/" ? "" : sidePath) + "/" + name;
    if (DEMO) demoWrite(path, "");
    else {
      const j = await api("/api/file", { path, content: "" });
      if (j.error) { setOut("error: " + j.error, true); return; }
    }
    curFile = path;
    fileEl.textContent = path;
    editor.value = "";
    setLang();
    refreshSide();
    setStatus("created " + path);
  };
  body.querySelector('[data-a="save"]').onclick = async () => {
    if (!curFile) {
      const name = prompt("save as (file name):");
      if (!name) return;
      curFile = "/home/user/" + name;
    }
    if (DEMO) demoWrite(curFile, editor.value);
    else {
      const j = await api("/api/file", { path: curFile, content: editor.value });
      if (j.error) { setOut("error: " + j.error, true); return; }
    }
    fileEl.textContent = curFile;
    setLang();
    refreshSide();
    setStatus("saved " + curFile);
  };
  body.querySelector('[data-a="hex"]').onclick = async () => {
    const src = editor.value;
    if (DEMO) {
      setOut(hexDump(demoFakeCompile(src)) +
        "\n\n[demo preview — the real compiler runs under `geov deploy`]");
      return;
    }
    setStatus("compiling...");
    const j = await api("/api/compile", { source: src });
    if (j.error) { setOut("compile error: " + j.error, true); setStatus("failed"); return; }
    setOut(hexDump(j.hex));
    setStatus(`${j.size} bytes · ${j.constants} consts · ${j.functions} fns`);
  };
  body.querySelector('[data-a="run"]').onclick = async () => {
    const src = editor.value;
    const lang = curFile ? langOf(curFile) : "geovariable";
    setStatus("running...");
    if (lang === "geovariable" || (!curFile)) {
      if (DEMO) {
        try { setOut(demoRunGeo(src) + "\n\n[demo interpreter — deploy for the bytecode VM]"); }
        catch (e) { setOut("error: " + e.message, true); }
        setStatus("done (demo)");
        return;
      }
      const j = await api("/api/run", { source: src });
      if (j.error) { setOut("error: " + j.error, true); setStatus("failed"); return; }
      setOut((j.output || "(no output)") + `\n\n[gevm] ${j.steps} instructions · sandboxed bytecode`);
      setStatus("done");
      return;
    }
    if (["python", "javascript", "bash"].includes(lang)) {
      if (DEMO) {
        setOut(`${lang} execution needs the real server.\nRun:  pip install geov-os && geov deploy`, true);
        setStatus("demo");
        return;
      }
      const j = await api("/api/runcode", { language: lang, code: src });
      if (j.error) { setOut("error: " + j.error, true); setStatus("failed"); return; }
      let text = j.stdout || "";
      if (j.stderr) text += (text ? "\n" : "") + j.stderr;
      if (j.note) text += (text ? "\n" : "") + "[" + j.note + "]";
      text += `\n[exit ${j.exit}${j.timeout ? " · timeout-killed" : ""}]`;
      setOut(text || "(no output)", !j.ok);
      setStatus(j.ok ? "done" : "failed");
      return;
    }
    setOut(`'${lang}' files are not runnable — save as .gv .py .js or .sh to run.`, true);
    setStatus("not runnable");
  };

  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = editor.selectionStart;
      editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(editor.selectionEnd);
      editor.selectionStart = editor.selectionEnd = s + 4;
    }
  });

  refreshSide();
  if (opts && opts.file) openFile(opts.file);
  else { editor.value = STUDIO_EXAMPLES.hello; curFile = null; setLang(); }
}

/* ============================ shared helpers ============================ */
function hexDump(hex) {
  const lines = [];
  for (let off = 0; off < Math.min(hex.length, 1024); off += 32) {
    const chunk = hex.slice(off, off + 32);
    const bytes = chunk.match(/../g) || [];
    const hexs = bytes.join(" ");
    const text = bytes.map(h => {
      const c = parseInt(h, 16);
      return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
    }).join("");
    lines.push((off / 2).toString(16).padStart(8, "0") + "  " +
      hexs.padEnd(48) + "  |" + text + "|");
  }
  if (hex.length > 1024) lines.push(`... (${hex.length / 2 - 512} more bytes)`);
  return lines.join("\n");
}

/* ============================ monitor app ============================ */
function mountMonitor(body, win) {
  body.innerHTML =
    `<div class="monitor-grid">` +
    `<div class="card"><h3>host CPU (real)</h3><canvas width="360" height="84"></canvas><div class="stat" data-s="cpu">--</div></div>` +
    `<div class="card"><h3>host memory (real)</h3><canvas width="360" height="84"></canvas><div class="stat" data-s="mem">--</div></div>` +
    `<div class="card procs-card"><h3>host processes (real, top by memory)</h3>` +
    `<table class="procs"><thead><tr><th>PID</th><th>NAME</th><th>MEM MB</th></tr></thead>` +
    `<tbody></tbody></table></div>` +
    `<div class="card procs-card"><h3>system</h3><div class="sys-info">loading...</div></div>` +
    `</div>`;
  const canvases = body.querySelectorAll("canvas");
  const cpuStat = body.querySelector('[data-s="cpu"]');
  const memStat = body.querySelector('[data-s="mem"]');
  const tbody = body.querySelector("tbody");
  const sysEl = body.querySelector(".sys-info");
  const cpuData = Array(60).fill(0), memData = Array(60).fill(0);
  const fmtUptime = (s) => {
    if (s == null) return "—";
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return (d ? d + "d " : "") + h + "h " + m + "m";
  };

  function draw(c, data, color) {
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    data.forEach((v, i) => {
      const x = i / (data.length - 1) * c.width;
      const y = c.height - (v / 100) * c.height;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.lineTo(c.width, c.height); ctx.lineTo(0, c.height); ctx.closePath();
    ctx.fillStyle = color + "22"; ctx.fill();
  }

  async function tick() {
    if (DEMO) {
      cpuData.push(Math.max(2, Math.min(97, cpuData[59] + (Math.random() - 0.5) * 14))); cpuData.shift();
      memData.push(Math.max(10, Math.min(92, memData[59] + (Math.random() - 0.5) * 4))); memData.shift();
      draw(canvases[0], cpuData, "#22d3ee");
      draw(canvases[1], memData, "#a78bfa");
      cpuStat.textContent = cpuData[59].toFixed(1) + "% (simulated — deploy for real)";
      memStat.textContent = (memData[59] * 0.64).toFixed(0) + " MB / 4096 MB (simulated)";
      tbody.innerHTML = [[1, "geovd", "12.0"], [42, "gevm", "48.5"], [43, "geosh", "9.2"], [77, "webd", "33.7"]]
        .map(p => `<tr><td>${p[0]}</td><td>${p[1]}</td><td>${p[2]}</td></tr>`).join("");
      sysEl.textContent = "GeoOS 0.2.0 Geode\nkernel: geokernel 0.2.0\nmode: demo (static preview)\n\nrun `geov deploy` for live host telemetry";
      return;
    }
    try {
      const j = await apiGet("/api/sysinfo");
      const cpu = j.cpu_percent ?? 0;
      const memPct = j.mem ? 100 * j.mem.used_mb / j.mem.total_mb : 0;
      cpuData.push(cpu); cpuData.shift();
      memData.push(memPct); memData.shift();
      draw(canvases[0], cpuData, "#22d3ee");
      draw(canvases[1], memData, "#a78bfa");
      cpuStat.textContent = cpu.toFixed(1) + "%  (host, live)";
      memStat.textContent = j.mem
        ? `${j.mem.used_mb.toFixed(0)} MB / ${j.mem.total_mb.toFixed(0)} MB (${memPct.toFixed(1)}%)` : "—";
      tbody.innerHTML = (j.procs || [])
        .map(p => `<tr><td>${p.pid}</td><td>${p.name}</td><td>${p.mem_mb}</td></tr>`).join("");
      sysEl.textContent =
        `GeoOS 0.2.0 Geode\nkernel: geokernel 0.2.0\n` +
        `host uptime: ${fmtUptime(j.uptime_s)}\n` +
        (j.loadavg ? `load avg: ${j.loadavg.map(x => x.toFixed(2)).join("  ")}\n` : "") +
        `processes shown: ${(j.procs || []).length} (of host)`;
    } catch (e) { /* window closing or server gone */ }
  }
  tick();
  const timer = setInterval(tick, 1500);
  win.cleanup = () => clearInterval(timer);
}

/* ============================ settings app ============================ */
function mountSettings(body, win) {
  const accents = [["cyan", "#22d3ee"], ["violet", "#a78bfa"], ["teal", "#2dd4bf"],
                   ["amber", "#fbbf24"], ["rose", "#fb7185"]];
  const wps = [["nebula", "Nebula (AI art)", "url('assets/wallpaper.jpg') center/cover, #12203f"],
               ["vector", "Vector Geo", "url('assets/wallpaper.svg') center/cover, #0d1526"],
               ["midnight", "Midnight", "radial-gradient(ellipse at 50% 20%, #101a33, #04060d 75%)"],
               ["sunset", "Sunset", "linear-gradient(160deg, #1a0f2e, #3b1547 45%, #7a2545)"]];
  body.innerHTML =
    `<div class="settings-body"><h3>Accent color</h3><div class="swatches">` +
    accents.map(([k, c]) => `<button class="swatch" data-k="${k}" style="background:${c}" title="${k}"></button>`).join("") +
    `</div><h3>Wallpaper</h3><div class="wp-opts">` +
    wps.map(([k, n, bg]) => `<button class="wp-opt" data-k="${k}" style="background:${bg}">${n}</button>`).join("") +
    `</div><h3>System</h3>` +
    `<button data-a="reset">Reset GeoOS files &amp; settings</button>` +
    `<div class="settings-note">settings persist on the host at ~/.geovos/settings.json` +
    (DEMO ? "<br>(demo mode: stored in browser localStorage)" : "") + `</div></div>`;

  const markSel = () => {
    body.querySelectorAll(".swatch").forEach(b => b.classList.toggle("sel", b.dataset.k === settings.accent));
    body.querySelectorAll(".wp-opt").forEach(b => b.classList.toggle("sel", b.dataset.k === settings.wallpaper));
  };
  body.querySelectorAll(".swatch").forEach(b => b.onclick = () => {
    settings.accent = b.dataset.k; saveSettings(); markSel();
  });
  body.querySelectorAll(".wp-opt").forEach(b => b.onclick = () => {
    settings.wallpaper = b.dataset.k; saveSettings(); markSel();
  });
  body.querySelector('[data-a="reset"]').onclick = async () => {
    if (!confirm("Reset the GeoOS virtual filesystem and settings?")) return;
    if (DEMO) { demoReset(); localStorage.removeItem(SETTINGS_KEY); location.reload(); return; }
    await api("/api/exec", { session: "settings", cmd: "reset --yes" });
    settings = { accent: "cyan", wallpaper: "nebula" };
    await saveSettings();
    markSel();
    alert("GeoOS reset. New terminals will see a fresh filesystem.");
  };
  markSel();
}

/* ============================ calculator app ============================ */
function mountCalc(body, win) {
  body.innerHTML =
    `<div class="calc-body"><div class="calc-display"><span class="calc-expr"></span><span class="calc-val">0</span></div>` +
    `<div class="calc-grid"></div></div>`;
  const exprEl = body.querySelector(".calc-expr");
  const valEl = body.querySelector(".calc-val");
  const grid = body.querySelector(".calc-grid");
  let expr = "";
  const keys = ["C", "⌫", "(", ")",
                "7", "8", "9", "/",
                "4", "5", "6", "*",
                "1", "2", "3", "-",
                "0", ".", "%", "+",
                "^", "=", "", ""];
  grid.style.gridTemplateColumns = "repeat(4, 1fr)";
  for (const k of keys) {
    if (!k) { const s = document.createElement("span"); grid.appendChild(s); continue; }
    const b = document.createElement("button");
    b.textContent = k;
    if ("/ * - + % ^".includes(k) && k.length === 1) b.className = "op";
    if (k === "=") { b.className = "eq"; b.style.gridColumn = "span 3"; }
    b.onclick = () => press(k);
    grid.appendChild(b);
  }
  function press(k) {
    if (k === "C") expr = "";
    else if (k === "⌫") expr = expr.slice(0, -1);
    else if (k === "=") {
      try {
        const v = calcEval(expr);
        exprEl.textContent = expr + " =";
        valEl.textContent = String(v);
        expr = String(v);
        return;
      } catch (e) { valEl.textContent = "error"; return; }
    } else expr += k;
    valEl.textContent = expr || "0";
  }
}

/* tiny safe arithmetic evaluator: numbers, + - * / % ^ and parens */
function calcEval(src) {
  let i = 0;
  const peek = () => src[i];
  const skip = () => { while (src[i] === " ") i++; };
  function parseExpr() {
    let v = parseTerm();
    for (;;) { skip();
      if (peek() === "+") { i++; v += parseTerm(); }
      else if (peek() === "-") { i++; v -= parseTerm(); }
      else return v; }
  }
  function parseTerm() {
    let v = parsePow();
    for (;;) { skip();
      if (peek() === "*") { i++; v *= parsePow(); }
      else if (peek() === "/") { i++; const d = parsePow(); if (d === 0) throw new Error("div0"); v /= d; }
      else if (peek() === "%") { i++; const d = parsePow(); if (d === 0) throw new Error("mod0"); v %= d; }
      else return v; }
  }
  function parsePow() {
    let b = parseUnary(); skip();
    if (peek() === "^") { i++; return Math.pow(b, parsePow()); }
    return b;
  }
  function parseUnary() {
    skip();
    if (peek() === "-") { i++; return -parseUnary(); }
    if (peek() === "(") { i++; const v = parseExpr(); skip(); if (peek() !== ")") throw new Error("paren"); i++; return v; }
    let num = "";
    while (i < src.length && /[\d.]/.test(src[i])) num += src[i++];
    if (!num) throw new Error("syntax");
    return parseFloat(num);
  }
  const v = parseExpr();
  skip();
  if (i < src.length) throw new Error("trailing");
  if (!isFinite(v)) throw new Error("inf");
  return Math.round(v * 1e10) / 1e10;
}

/* ============================ paint app ============================ */
function mountPaint(body, win) {
  body.innerHTML =
    `<div class="paint-body"><div class="paint-tools">` +
    `<input type="color" value="#22d3ee" title="brush color">` +
    `<input type="range" min="1" max="40" value="5" title="brush size">` +
    `<button data-a="erase">Eraser</button><button data-a="clear">Clear</button>` +
    `<span class="spacer"></span><button class="btn-primary" data-a="save">Save to Files</button>` +
    `</div><div class="paint-canvas-wrap"><canvas class="paint-canvas" width="1200" height="680"></canvas></div></div>`;
  const canvas = body.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const colorIn = body.querySelector('input[type="color"]');
  const sizeIn = body.querySelector('input[type="range"]');
  let drawing = false, erasing = false, last = null;
  ctx.fillStyle = "#0b1120";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * canvas.width / r.width,
            (e.clientY - r.top) * canvas.height / r.height];
  };
  canvas.addEventListener("pointerdown", (e) => {
    drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = erasing ? "#0b1120" : colorIn.value;
    ctx.lineWidth = erasing ? sizeIn.value * 4 : sizeIn.value;
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    last = p;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
  body.querySelector('[data-a="erase"]').onclick = (e) => {
    erasing = !erasing;
    e.target.textContent = erasing ? "Brush" : "Eraser";
  };
  body.querySelector('[data-a="clear"]').onclick = () => {
    ctx.fillStyle = "#0b1120"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  body.querySelector('[data-a="save"]').onclick = async () => {
    const b64 = canvas.toDataURL("image/png").split(",")[1];
    const name = "paint-" + Date.now() + ".png";
    const path = "/home/user/pictures/" + name;
    if (DEMO) {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = name;
      a.click();
      return;
    }
    await api("/api/fsop", { op: "mkdir", path: "/home/user/pictures" });
    const j = await api("/api/file", { path, content: b64, encoding: "base64" });
    if (j.error) alert("save failed: " + j.error);
    else alert("saved to " + path + "  (real file on disk, see Files app)");
  };
}

/* ============================ help app ============================ */
function mountHelp(body, win) {
  body.innerHTML = `<div class="help-body">
<h2>GeoOS 0.2.0 “Geode”</h2>
<p>A hobby OS that runs sandboxed on your machine: real windows, a real virtual filesystem
on disk, a unified shell, a binary scripting language, and live host telemetry.</p>

<h3>The apps</h3>
<table>
<tr><th>App</th><th>What it does</th></tr>
<tr><td>Terminal</td><td>geosh — unified Linux + PowerShell + macOS commands, pipes, redirects, packages</td></tr>
<tr><td>Code Studio</td><td>writes real local files; runs geoVariable (.gv), Python (.py), JavaScript (.js), Bash (.sh)</td></tr>
<tr><td>Files</td><td>browse / edit / rename / delete the VFS at ~/.geovos/vfs</td></tr>
<tr><td>Monitor</td><td>live host CPU / memory / process table from the real kernel</td></tr>
<tr><td>Paint</td><td>draw and save PNGs straight into the VFS</td></tr>
<tr><td>Calculator</td><td>safe arithmetic, no eval</td></tr>
<tr><td>Settings</td><td>accent color + wallpaper, persisted on the host</td></tr>
<tr><td>Host OS</td><td>your real machine — the layer GeoOS floats above</td></tr>
</table>

<h3>geoVariable quick reference</h3>
<ul>
<li><code>let x = 5</code> / <code>set x = x + 1</code> — variables</li>
<li><code>for i in 1..10 { ... }</code> — ranges, <code>break</code> / <code>continue</code></li>
<li><code>while x &gt; 0 { ... }</code> · <code>if / elif / else</code></li>
<li><code>fn add(a, b) { return a + b }</code> — functions, recursion ok</li>
<li>builtins: <code>print str num len upper lower abs min max type input</code></li>
</ul>
<p>Compiles to <b>real binary bytecode</b> (.gvb, magic “GEVB”) and executes in a sandboxed
stack VM with an instruction budget — Code Studio → Run, or <code>run file.gv</code> in Terminal.</p>

<h3>Shell aliases (all equivalent)</h3>
<table>
<tr><th>GeoOS</th><th>Linux/mac</th><th>PowerShell</th></tr>
<tr><td>ls</td><td>ls</td><td>Get-ChildItem, gci, dir</td></tr>
<tr><td>cat</td><td>cat</td><td>Get-Content, gc, type</td></tr>
<tr><td>clear</td><td>clear</td><td>cls, Clear-Host</td></tr>
<tr><td>ps</td><td>ps</td><td>Get-Process, tasklist</td></tr>
<tr><td>sysinfo</td><td>uname -a</td><td>systeminfo</td></tr>
</table>
</div>`;
}

/* ============================ host os app ============================ */
function mountHost(body, win) {
  body.innerHTML =
    `<div class="host-wrap"><div class="host-card">` +
    `<h2>&#x29C9; Your current OS</h2>` +
    `<p class="host-sub">GeoOS runs sandboxed on top of this system. Nothing GeoOS does can touch it — ` +
    `guest code gets timeouts, output caps and a jailed working directory.</p>` +
    `<table class="host-table"></table></div></div>`;
  const tbl = body.querySelector(".host-table");
  (async () => {
    let info;
    if (DEMO) {
      const ua = navigator.userAgent;
      const os = ua.includes("Win") ? "Windows" : ua.includes("Mac") ? "macOS"
        : ua.includes("Linux") ? "Linux" : "unknown";
      info = { system: os + " (via browser)", platform: navigator.platform,
               device: "this device", geov: "0.2.0 (demo)",
               note: "run `geov deploy` for live host details" };
    } else {
      info = await apiGet("/api/host");
      try {
        const s = await apiGet("/api/sysinfo");
        if (s.loadavg) info["load average"] = s.loadavg.map(x => x.toFixed(2)).join("  ");
        info["runtimes"] = Object.keys(RUNTIMES).join(", ");
      } catch (e) {}
    }
    tbl.innerHTML = Object.entries(info)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v || "—"}</td></tr>`).join("");
  })();
}

/* ============================ DEMO MODE (static preview) ============================ */
function demoDefaults() {
  return {
    dirs: {
      "/": ["bin/", "docs/", "etc/", "examples/", "home/", "tmp/", "var/"],
      "/docs": ["welcome.txt"],
      "/etc": ["os-release"],
      "/examples": ["hello.gv", "fizzbuzz.gv", "fib.gv"],
      "/home": ["user/"],
      "/home/user": ["notes.txt"],
      "/bin": ["README"], "/tmp": [], "/var": ["pkg/"], "/var/pkg": ["installed.json"],
    },
    files: {
      "/etc/os-release": 'NAME=GeoOS\nVERSION=0.2.0 (Geode)\nKERNEL=geokernel 0.2.0\nSHELL=geosh 0.2\nSCRIPT=geoVariable 1 (binary, sandboxed)\nPRETTY_NAME="GeoOS 0.2.0 Geode"\n',
      "/docs/welcome.txt": "Welcome to GeoOS!\n\nThis static preview runs in demo mode.\nFor the real thing:  pip install geov-os  &&  geov deploy\n\nTry in the Terminal: help, ls /, geofetch, run /examples/fizzbuzz.gv, pkg list",
      "/examples/hello.gv": STUDIO_EXAMPLES.hello,
      "/examples/fizzbuzz.gv": STUDIO_EXAMPLES.fizzbuzz,
      "/examples/fib.gv": STUDIO_EXAMPLES.fib,
      "/home/user/notes.txt": "My GeoOS notes\n==============\n\n- everything here is sandboxed\n",
      "/bin/README": "GeoOS built-in commands are provided by geosh.\n",
      "/var/pkg/installed.json": "{}",
    },
  };
}
let DEMO_DB = demoDefaults();
function demoReset() { DEMO_DB = demoDefaults(); }

function demoLs(path) {
  return (DEMO_DB.dirs[path] || []).map(n => ({
    name: n.replace(/\/$/, ""),
    type: n.endsWith("/") ? "dir" : "file",
    size: DEMO_DB.files[path === "/" ? "/" + n : path + "/" + n]?.length || 0,
  }));
}

function demoRead(path) { return DEMO_DB.files[path] ?? null; }

function demoWrite(path, content) {
  DEMO_DB.files[path] = content;
  const dir = path.replace(/\/[^/]+$/, "") || "/";
  const name = path.split("/").pop();
  if (!DEMO_DB.dirs[dir]) DEMO_DB.dirs[dir] = [];
  if (!DEMO_DB.dirs[dir].includes(name)) DEMO_DB.dirs[dir].push(name);
}

function demoMkdir(path) {
  const dir = path.replace(/\/[^/]+$/, "") || "/";
  const name = path.split("/").pop();
  if (!DEMO_DB.dirs[path]) DEMO_DB.dirs[path] = [];
  if (DEMO_DB.dirs[dir] && !DEMO_DB.dirs[dir].includes(name + "/"))
    DEMO_DB.dirs[dir].push(name + "/");
}

function demoRename(from, to) {
  if (from in DEMO_DB.files) {
    DEMO_DB.files[to] = DEMO_DB.files[from];
    delete DEMO_DB.files[from];
  }
  const dir = from.replace(/\/[^/]+$/, "") || "/";
  const name = from.split("/").pop();
  const entries = DEMO_DB.dirs[dir] || [];
  const i = entries.indexOf(name);
  if (i >= 0) { entries.splice(i, 1); entries.push(to.split("/").pop()); }
}

function demoDelete(path) {
  delete DEMO_DB.files[path];
  delete DEMO_DB.dirs[path];
  const dir = path.replace(/\/[^/]+$/, "") || "/";
  const name = path.split("/").pop();
  const entries = DEMO_DB.dirs[dir] || [];
  const i = entries.findIndex(x => x === name || x === name + "/");
  if (i >= 0) entries.splice(i, 1);
}

function demoResolve(p, cwd) {
  if (!p) return cwd;
  if (p.startsWith("~")) p = "/home/user" + p.slice(1);
  if (!p.startsWith("/")) p = cwd.replace(/\/$/, "") + "/" + p;
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop(); else parts.push(seg);
  }
  return "/" + parts.join("/");
}

function demoShell(cmdline, ctx) {
  const out = [];
  for (const chain of cmdline.split(";")) {
    for (const stage of chain.split("|")) {
      const toks = stage.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      out.push(demoCommand(toks, ctx));
    }
  }
  return out.filter(Boolean).join("\n");
}

function demoCommand(toks, ctx) {
  const alias = { dir: "ls", "Get-ChildItem": "ls", gci: "ls", type: "cat", gc: "cat",
    "Get-Content": "cat", cls: "clear", "Clear-Host": "clear", uname: "sysinfo",
    systeminfo: "sysinfo", tasklist: "ps", "Get-Process": "ps", man: "help",
    "Set-Location": "cd", "Get-Location": "pwd", open: "cat", pbcopy: "echo" };
  let [cmd, ...args] = toks;
  cmd = alias[cmd] || cmd;
  switch (cmd) {
    case "help":
      return "FILES       ls, cd, pwd, cat, echo, clear, find, grep\n" +
        "SYSTEM      sysinfo, ps, date, whoami, geofetch, about\n" +
        "GEOVARIABLE run <x.gv>   (demo runs the in-browser interpreter)\n" +
        "PACKAGES    pkg list\n" +
        "NOTE        demo mode — full shell (pipes, redirects, pkg install,\n" +
        "            compile to .gvb binary) needs `geov deploy`";
    case "pwd": return ctx.cwd;
    case "cd": {
      const t = demoResolve(args[0] || "/home/user", ctx.cwd);
      if (DEMO_DB.dirs[t] || t === "/") { ctx.cwd = t; return ""; }
      return "error: cd: " + args[0] + ": no such directory";
    }
    case "ls": {
      const t = demoResolve(args.find(a => !a.startsWith("-")) || ctx.cwd, ctx.cwd);
      const items = DEMO_DB.dirs[t];
      return items ? (items.join("  ") || "(empty)") : "error: ls: no such directory";
    }
    case "cat": {
      const t = demoResolve(args[0], ctx.cwd);
      return DEMO_DB.files[t] ?? ("error: cat: " + args[0] + ": no such file");
    }
    case "echo": return args.join(" ");
    case "clear": return "\x1bCLEAR\x1b";
    case "date": return new Date().toString();
    case "whoami": return "user";
    case "sysinfo":
      return "GeoOS 0.2.0 Geode\nkernel:   geokernel 0.2.0\nshell:    geosh 0.2 (demo)\n" +
        "script:   geoVariable 1 (binary, sandboxed)\nhost os:  detected from browser";
    case "geofetch":
      return "      .-~~~~~~~~-.\n    .'  .-~~~-.   '.\n" +
        "   /   / ,--. \\     \\\n  |   | (Geo)  |     |\n" +
        "   \\   \\ `--' /     /\n    '.  `-~~~-'   .'\n" +
        "      '-~~~~~~~~-'\n\nuser@geov-box\nOS: GeoOS 0.2.0 Geode (demo)\n" +
        "Shell: geosh 0.2\nScript: geoVariable 1 (.gvb binary, sandboxed)";
    case "about":
      return "GeoOS — a hobby OS layer. Demo mode; run `geov deploy` for the full system.";
    case "ps":
      return "  PID  NAME         CPU%   MEM(MB)\n    1  geovd        0.2      12.0\n" +
        "   42  gevm         1.1      48.5\n   43  geosh        0.4       9.2\n" +
        "   77  webd         0.8      33.7";
    case "pkg":
      return "NAME         VER    STATE       DESCRIPTION\n" +
        "cowsay       1.0    available   A talking cow. Essential system component.\n" +
        "geoquote     1.2    available   Prints inspirational quotes.\n" +
        "hello-gv     0.3    available   Demo script installer.\n" +
        "(install needs `geov deploy`)";
    case "run": {
      const t = demoResolve(args[0], ctx.cwd);
      const src = DEMO_DB.files[t];
      if (!src) return "error: run: " + (args[0] || "") + ": no such script";
      try { return demoRunGeo(src) + "\n[gevm-demo] interpreted (deploy for bytecode VM)"; }
      catch (e) { return "error: " + e.message; }
    }
    case "grep": {
      const t = demoResolve(args[1], ctx.cwd);
      const text = DEMO_DB.files[t] || "";
      return (text.split("\n").filter(l =>
        l.toLowerCase().includes((args[0] || "").toLowerCase())).join("\n")) || "(no matches)";
    }
    case "find": return "(demo: find needs `geov deploy`)";
    case "exit": case "logout": return "\x1bEXIT\x1b";
    default:
      return "error: " + cmd + ": command not found in demo mode (try 'help')";
  }
}

function demoFakeCompile(src) {
  // preview-only: wraps a hash of the source in a GEVB-looking envelope
  let h = 2166136261;
  const bytes = [0x47, 0x45, 0x56, 0x42, 0x01, 0x01];
  for (const ch of src) {
    h ^= ch.codePointAt(0); h = (h * 16777619) >>> 0;
    bytes.push(h & 0xff);
  }
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* -------- tiny demo interpreter for geoVariable (preview only) -------- */
function demoRunGeo(src) {
  const tokens = gvLex(src);
  const ast = gvParse(tokens);
  const out = [];
  const globals = {};
  const fns = {};
  const MAX = 200000; let steps = 0;
  const tick = () => { if (++steps > MAX) throw new Error("instruction budget exceeded (sandbox halted)"); };

  const truthy = v => !(v === null || v === false || v === 0 || v === "");
  const fmt = v => v === null ? "null" : v === true ? "true" : v === false ? "false"
    : typeof v === "number" && Number.isInteger(v) ? String(v) : String(v);

  function evalE(e, loc) {
    tick();
    switch (e[0]) {
      case "num": case "str": case "bool": return e[1];
      case "null": return null;
      case "var": {
        if (loc && e[1] in loc) return loc[e[1]];
        if (e[1] in globals) return globals[e[1]];
        throw new Error("undefined variable '" + e[1] + "'");
      }
      case "un": {
        const v = evalE(e[2], loc);
        return e[1] === "not" ? !truthy(v) : -v;
      }
      case "bin": {
        const [, op, l, r] = e;
        const a = evalE(l, loc), b = evalE(r, loc);
        switch (op) {
          case "+": return (typeof a === "string" || typeof b === "string") ? fmt(a) + fmt(b) : a + b;
          case "-": return a - b;
          case "*": return typeof a === "string" ? a.repeat(b) : a * b;
          case "/": if (b === 0) throw new Error("division by zero"); return a / b;
          case "%": if (b === 0) throw new Error("modulo by zero"); return a % b;
          case "==": return a === b;
          case "!=": return a !== b;
          case "<": return a < b; case "<=": return a <= b;
          case ">": return a > b; case ">=": return a >= b;
          case "and": return truthy(a) && truthy(b);
          case "or": return truthy(a) || truthy(b);
        }
        break;
      }
      case "call": {
        const [, name, argEs] = e;
        const argv = argEs.map(x => evalE(x, loc));
        if (fns[name]) {
          const fn = fns[name];
          const scope = {};
          fn.params.forEach((p, i) => scope[p] = argv[i]);
          try { execBlock(fn.body, scope); }
          catch (r) { if (r && r.__ret) return r.value; throw r; }
          return null;
        }
        if (name === "print") { out.push(argv.map(fmt).join(" ")); return null; }
        if (name === "str") return fmt(argv[0]);
        if (name === "num") return Number(argv[0]);
        if (name === "len") return String(argv[0]).length;
        if (name === "upper") return fmt(argv[0]).toUpperCase();
        if (name === "lower") return fmt(argv[0]).toLowerCase();
        if (name === "abs") return Math.abs(argv[0]);
        if (name === "min") return Math.min(...argv);
        if (name === "max") return Math.max(...argv);
        if (name === "type") return argv[0] === null ? "null" : typeof argv[0] === "boolean" ? "bool" : typeof argv[0] === "number" ? "number" : "string";
        if (name === "input") return "";
        throw new Error("unknown function '" + name + "'");
      }
    }
    throw new Error("bad expression " + e[0]);
  }

  function setVar(name, v, loc) {
    if (loc && name in loc) { loc[name] = v; return; }
    if (loc && !(name in globals)) { loc[name] = v; return; }
    globals[name] = v;
  }

  function execBlock(stmts, loc) {
    for (const s of stmts) execS(s, loc);
  }

  function execS(s, loc) {
    tick();
    switch (s[0]) {
      case "let": case "set": setVar(s[1], evalE(s[2], loc), loc); return;
      case "expr": evalE(s[1], loc); return;
      case "if": {
        for (const [cond, body] of s[1])
          if (truthy(evalE(cond, loc))) { execBlock(body, loc); return; }
        if (s[2]) execBlock(s[2], loc);
        return;
      }
      case "while":
        while (truthy(evalE(s[1], loc))) {
          tick();
          try { execBlock(s[2], loc); }
          catch (b) { if (b === "break") break; if (b !== "continue") throw b; }
        }
        return;
      case "for": {
        const [, name, se, ee, ste, body] = s;
        const start = evalE(se, loc), end = evalE(ee, loc), step = evalE(ste, loc);
        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
          tick();
          setVar(name, i, loc);
          try { execBlock(body, loc); }
          catch (b) { if (b === "break") break; if (b !== "continue") throw b; }
        }
        return;
      }
      case "fn": fns[s[1]] = { params: s[2], body: s[3] }; return;
      case "return": throw { __ret: true, value: evalE(s[1], loc) };
      case "break": throw "break";
      case "continue": throw "continue";
    }
  }

  execBlock(ast, null);
  return out.join("\n");
}

/* demo lexer/parser mirroring the Python one (subset) */
function gvLex(src) {
  const KW = new Set(["let","set","if","elif","else","while","for","in","fn",
    "return","true","false","and","or","not","break","continue","null"]);
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n" || c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, buf = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { buf += { n: "\n", t: "\t" }[src[j + 1]] ?? src[j + 1]; j += 2; }
        else buf += src[j++];
      }
      toks.push(["STR", buf]); i = j + 1; continue;
    }
    if (/\d/.test(c)) {
      let j = i;
      while (j < src.length && /\d/.test(src[j])) j++;
      if (src[j] === "." && /\d/.test(src[j + 1])) { j++; while (j < src.length && /\d/.test(src[j])) j++; }
      toks.push(["NUM", parseFloat(src.slice(i, j))]); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push([KW.has(w) ? "KW" : "IDENT", w]); i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", ".."].includes(two)) { toks.push(["OP", two]); i += 2; continue; }
    if ("+-*/%(){}<>,=".includes(c)) { toks.push(["OP", c]); i++; continue; }
    throw new Error("unexpected character '" + c + "'");
  }
  toks.push(["EOF", null]);
  return toks;
}

function gvParse(toks) {
  let i = 0;
  const peek = (k = 0) => toks[Math.min(i + k, toks.length - 1)];
  const next = () => toks[i++];
  const expect = v => { const t = next(); if (t[1] !== v) throw new Error("expected '" + v + "', got '" + t[1] + "'"); };

  function block() {
    expect("{");
    const stmts = [];
    while (peek()[1] !== "}") stmts.push(stmt());
    expect("}");
    return stmts;
  }

  function stmt() {
    const t = peek();
    if (t[0] === "KW") {
      if (t[1] === "let" || t[1] === "set") {
        const kind = next()[1]; const name = next()[1]; expect("=");
        return [kind, name, expr()];
      }
      if (t[1] === "if") {
        next();
        const branches = [[expr(), block()]]; let els = null;
        while (peek()[1] === "elif" || peek()[1] === "else") {
          if (next()[1] === "elif") branches.push([expr(), block()]);
          else els = block();
        }
        return ["if", branches, els];
      }
      if (t[1] === "while") { next(); const c = expr(); return ["while", c, block()]; }
      if (t[1] === "for") {
        next(); const name = next()[1]; expect("in");
        const s = expr(); expect(".."); const e = expr();
        let step = ["num", 1];
        if (peek()[1] === "..") { next(); step = expr(); }
        return ["for", name, s, e, step, block()];
      }
      if (t[1] === "fn") {
        next(); const name = next()[1]; expect("(");
        const params = [];
        if (peek()[1] !== ")") do { params.push(next()[1]); } while (peek()[1] === "," && next());
        expect(")");
        return ["fn", name, params, block()];
      }
      if (t[1] === "return") { next(); return ["return", peek()[1] === "}" ? ["null"] : expr()]; }
      if (t[1] === "break") { next(); return ["break"]; }
      if (t[1] === "continue") { next(); return ["continue"]; }
    }
    if (t[0] === "IDENT" && peek(1)[1] === "=") { next(); next(); return ["set", t[1], expr()]; }
    return ["expr", expr()];
  }

  function expr() { return orE(); }
  function orE() { let l = andE(); while (peek()[1] === "or") { next(); l = ["bin", "or", l, andE()]; } return l; }
  function andE() { let l = notE(); while (peek()[1] === "and") { next(); l = ["bin", "and", l, notE()]; } return l; }
  function notE() { if (peek()[1] === "not") { next(); return ["un", "not", notE()]; } return cmpE(); }
  function cmpE() {
    let l = addE();
    if (["==", "!=", "<", "<=", ">", ">="].includes(peek()[1])) l = ["bin", next()[1], l, addE()];
    return l;
  }
  function addE() { let l = mulE(); while (["+", "-"].includes(peek()[1])) l = ["bin", next()[1], l, mulE()]; return l; }
  function mulE() { let l = unE(); while (["*", "/", "%"].includes(peek()[1])) l = ["bin", next()[1], l, unE()]; return l; }
  function unE() { if (peek()[1] === "-") { next(); return ["un", "-", unE()]; } return prim(); }
  function prim() {
    const t = next();
    if (t[0] === "NUM") return ["num", t[1]];
    if (t[0] === "STR") return ["str", t[1]];
    if (t[0] === "KW" && t[1] === "true") return ["bool", true];
    if (t[0] === "KW" && t[1] === "false") return ["bool", false];
    if (t[0] === "KW" && t[1] === "null") return ["null"];
    if (t[1] === "(") { const e = expr(); expect(")"); return e; }
    if (t[0] === "IDENT") {
      if (peek()[1] === "(") {
        next();
        const args = [];
        if (peek()[1] !== ")") do { args.push(expr()); } while (peek()[1] === "," && next());
        expect(")");
        return ["call", t[1], args];
      }
      return ["var", t[1]];
    }
    throw new Error("unexpected '" + t[1] + "'");
  }

  const stmts = [];
  while (peek()[0] !== "EOF") stmts.push(stmt());
  return stmts;
}
