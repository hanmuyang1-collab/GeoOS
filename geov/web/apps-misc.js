/* GeoOS desktop — Monitor, Settings, Calculator, Paint, Help and Host OS apps.
   Part of the split web UI; index.html loads app.js first, then the
   apps-*.js files, then demo.js. All files share one global scope. */

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
      sysEl.textContent = "GeoOS 0.3.0 Geode\nkernel: geokernel 0.3.0\nmode: demo (static preview)\n\nrun `geov deploy` for live host telemetry";
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
        `GeoOS 0.3.0 Geode\nkernel: geokernel 0.3.0\n` +
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
<h2>GeoOS 0.3.0 “Geode”</h2>
<p>A hobby OS that runs sandboxed on your machine: real windows, a real virtual filesystem
on disk, a unified shell, a binary scripting language, and live host telemetry.</p>

<h3>The apps</h3>
<table>
<tr><th>App</th><th>What it does</th></tr>
<tr><td>Terminal</td><td>geosh — unified Linux + PowerShell + macOS commands, pipes, redirects, packages</td></tr>
<tr><td>GeoSearch</td><td>web browser + search — real results from the server, pages render in-window through the sandboxed proxy (SSRF-guarded)</td></tr>
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
               device: "this device", geov: "0.3.0 (demo)",
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

/* ============================ app registry ============================ */
const APPS = {
  terminal: { title: "Terminal", glyph: "&gt;_", size: [740, 460], singleton: false, desktop: true, mount: mountTerminal },
  geosearch: { title: "GeoSearch", glyph: "&#127758;", size: [920, 620], singleton: false, desktop: true, mount: mountGeoSearch },
  studio:   { title: "Code Studio", glyph: "&lt;/&gt;", size: [880, 580], singleton: false, desktop: true, mount: mountStudio },
  files:    { title: "Files", glyph: "&#128193;", size: [780, 490], singleton: false, desktop: true, mount: mountFiles },
  monitor:  { title: "Monitor", glyph: "&#9638;", size: [800, 540], singleton: true, desktop: true, mount: mountMonitor },
  paint:    { title: "Paint", glyph: "&#9998;", size: [780, 580], singleton: false, desktop: true, mount: mountPaint },
  calc:     { title: "Calculator", glyph: "=", size: [300, 430], singleton: false, desktop: true, mount: mountCalc },
  settings: { title: "Settings", glyph: "&#9881;", size: [580, 470], singleton: true, desktop: true, mount: mountSettings },
  help:     { title: "Help &amp; Docs", glyph: "?", size: [660, 540], singleton: true, desktop: true, mount: mountHelp },
  host:     { title: "Host OS", glyph: "&#x29C9;", size: [660, 500], singleton: true, desktop: false, mount: mountHost },
};
