/* GeoOS desktop app.
   Talks to the local geov server when available (geov deploy).
   Falls back to a self-contained demo mode (in-browser shell + interpreter)
   so the static preview still works. */

let DEMO = false;
const SESSION = "web-" + Math.random().toString(36).slice(2, 9);

/* ============================ boot / frame ============================ */
window.addEventListener("load", async () => {
  tickClock(); setInterval(tickClock, 1000);
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    if (!r.ok) throw 0;
    document.getElementById("dock-status").textContent = "sandboxed · connected";
  } catch {
    DEMO = true;
    document.getElementById("demo-badge").hidden = false;
    document.getElementById("dock-status").textContent = "demo mode";
  }
  setTimeout(() => {
    document.getElementById("boot").classList.add("done");
    document.getElementById("desktop").hidden = false;
    termPrint("GeoOS 0.1.0 (Geode) — geosh 0.1" + (DEMO ? "  [demo mode]" : ""));
    termPrint("type 'help' to see the unified command set.\n");
    if (DEMO) fsRefresh();
    loadHostInfo();
    startMonitor();
  }, 1400);
  document.getElementById("term-in").addEventListener("keydown", onTermKey);
  document.getElementById("gv-examples").addEventListener("change", loadExample);
  document.querySelectorAll("#tabs .tab").forEach(b =>
    b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.getElementById("host-btn").addEventListener("click", () => showTab("host"));
});

function tickClock() {
  const d = new Date();
  document.getElementById("clock").textContent =
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function showTab(name) {
  document.querySelectorAll("#tabs .tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".pane").forEach(p =>
    p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "terminal") document.getElementById("term-in").focus();
  if (name === "files") fsRefresh();
  if (name === "host") loadHostInfo();
}

function iconTap(tab) { showTab(tab); }

/* ============================ terminal ============================ */
const termOut = () => document.getElementById("term-out");

function termPrint(text, cls) {
  const el = termOut();
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text + (text.endsWith("\n") ? "" : "\n");
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

let cwd = "/home/user";
const hist = []; let histIdx = -1;

function promptText() {
  const short = cwd === "/home/user" ? "~" : cwd.replace("/home/user", "~");
  return `user@geov:${short}$`;
}

async function onTermKey(e) {
  const input = e.target;
  if (e.key === "ArrowUp") {
    if (hist.length) { histIdx = Math.max(0, histIdx < 0 ? hist.length - 1 : histIdx - 1); input.value = hist[histIdx] || ""; }
    e.preventDefault(); return;
  }
  if (e.key === "ArrowDown") {
    if (histIdx >= 0) { histIdx = Math.min(hist.length - 1, histIdx + 1); input.value = hist[histIdx] || ""; }
    e.preventDefault(); return;
  }
  if (e.key !== "Enter") return;
  const cmd = input.value.trim();
  input.value = "";
  if (!cmd) return;
  hist.push(cmd); histIdx = -1;
  termPrint(promptText() + " " + cmd, "cmd-line");
  let out;
  try {
    out = DEMO ? demoShell(cmd) : await apiExec(cmd);
  } catch (err) {
    out = "error: " + err.message;
  }
  if (out.includes("\x1bCLEAR\x1b")) { termOut().innerHTML = ""; return; }
  if (out.includes("\x1bEXIT\x1b")) { showTab("desktop"); return; }
  if (out) termPrint(out, out.startsWith("error:") ? "err-line" : "");
  document.getElementById("term-prompt").textContent = promptText();
}

async function apiExec(cmd) {
  const r = await fetch("/api/exec", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: SESSION, cmd })
  });
  const j = await r.json();
  if (j.error) return "error: " + j.error;
  cwd = j.cwd || cwd;
  return j.output || "";
}

/* ============================ files ============================ */
let fsPath = "/";
let fsFile = null;

function fsUp() {
  if (fsPath === "/") return;
  fsPath = fsPath.replace(/\/[^/]+\/?$/, "") || "/";
  fsRefresh();
}

async function fsRefresh() {
  const list = document.getElementById("fs-list");
  document.getElementById("fs-path").textContent = fsPath;
  let entries;
  if (DEMO) {
    entries = demoLs(fsPath);
  } else {
    const r = await fetch("/api/fs?path=" + encodeURIComponent(fsPath));
    const j = await r.json();
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
    div.onclick = () => e.type === "dir"
      ? (fsPath = (fsPath === "/" ? "" : fsPath) + "/" + e.name, fsRefresh())
      : fsOpen((fsPath === "/" ? "" : fsPath) + "/" + e.name);
    list.appendChild(div);
  }
}

async function fsOpen(path) {
  let content;
  if (DEMO) { content = demoRead(path); if (content === null) return; }
  else {
    const r = await fetch("/api/file?path=" + encodeURIComponent(path));
    const j = await r.json();
    if (j.error) return;
    content = j.content;
  }
  fsFile = path;
  document.getElementById("fs-file-name").textContent = path;
  const ed = document.getElementById("fs-editor");
  ed.disabled = false; ed.value = content;
  document.getElementById("fs-save").disabled = DEMO;
}

async function fsSave() {
  if (!fsFile || DEMO) return;
  await fetch("/api/file", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: fsFile, content: document.getElementById("fs-editor").value })
  });
  document.getElementById("fs-file-name").textContent = fsFile + "  (saved)";
}

function fsNew() {
  const name = prompt("new file name (inside " + fsPath + "):");
  if (!name) return;
  fsFile = (fsPath === "/" ? "" : fsPath) + "/" + name;
  const ed = document.getElementById("fs-editor");
  ed.disabled = false; ed.value = "";
  document.getElementById("fs-file-name").textContent = fsFile + "  (unsaved)";
  document.getElementById("fs-save").disabled = DEMO;
}

/* ============================ studio ============================ */
const EXAMPLES = {
  hello: `let name = "GeoOS user"\nprint("hello " + name + "!")\nlet lucky = 7\nprint("lucky number:", lucky)\n`,
  fizzbuzz: `for i in 1..20 {\n    if i % 15 == 0 { print("FizzBuzz") }\n    elif i % 3 == 0 { print("Fizz") }\n    elif i % 5 == 0 { print("Buzz") }\n    else { print(i) }\n}\n`,
  fib: `fn fib(n) {\n    if n < 2 { return n }\n    return fib(n - 1) + fib(n - 2)\n}\nfor i in 0..12 { print(fib(i)) }\n`,
  loops: `let total = 0\nfor i in 1..100 {\n    if i % 2 == 0 { continue }\n    if i > 9 { break }\n    set total = total + i\n}\nprint("sum of odd 1..9:", total)\n\nlet n = 10\nwhile n > 0 { set n = n - 3 }\nprint("countdown ended at", n)\n`,
};

let gvBinaryHex = null;

function loadExample(e) {
  const k = e.target.value;
  if (k && EXAMPLES[k]) document.getElementById("gv-src").value = EXAMPLES[k];
  e.target.value = "";
}

function gvStatus(t) { document.getElementById("gv-status").textContent = t; }

async function gvCompile() {
  const src = document.getElementById("gv-src").value;
  if (DEMO) {
    const hex = demoFakeCompile(src);
    gvBinaryHex = hex;
    document.getElementById("gv-bin").textContent = hexDump(hex) +
      "\n\n[demo preview — the real compiler runs under `geov deploy`]";
    gvStatus("demo-compiled " + Math.floor(hex.length / 2) + " bytes");
    return;
  }
  gvStatus("compiling...");
  const r = await fetch("/api/compile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: src })
  });
  const j = await r.json();
  if (j.error) {
    document.getElementById("gv-bin").textContent = "compile error: " + j.error;
    gvStatus("failed");
    return;
  }
  gvBinaryHex = j.hex;
  document.getElementById("gv-bin").textContent = hexDump(j.hex);
  gvStatus(`${j.size} bytes · ${j.constants} consts · ${j.functions} fns · sandboxed`);
}

async function gvRun() {
  const src = document.getElementById("gv-src").value;
  if (DEMO) {
    try {
      const out = demoRunGeo(src);
      document.getElementById("gv-out").textContent =
        out + "\n[demo interpreter — `geov deploy` runs the real bytecode VM]";
    } catch (e) {
      document.getElementById("gv-out").textContent = "error: " + e.message;
    }
    return;
  }
  gvStatus("running in sandbox...");
  const r = await fetch("/api/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: src })
  });
  const j = await r.json();
  if (j.error) {
    document.getElementById("gv-out").textContent = "error: " + j.error;
    gvStatus("failed");
    return;
  }
  document.getElementById("gv-out").textContent =
    (j.output || "(no output)") + `\n\n[gevm] ${j.steps} instructions · sandboxed`;
  gvStatus("done");
}

function gvHex() {
  if (gvBinaryHex) {
    document.getElementById("gv-bin").textContent = hexDump(gvBinaryHex);
  } else {
    gvCompile();
  }
}

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
    lines.push(
      (off / 2).toString(16).padStart(8, "0") + "  " +
      hexs.padEnd(48) + "  |" + text + "|");
  }
  if (hex.length > 1024) lines.push(`... (${hex.length / 2 - 512} more bytes)`);
  return lines.join("\n");
}

/* ============================ monitor ============================ */
const cpuData = Array(60).fill(8), memData = Array(60).fill(30);

function startMonitor() {
  setInterval(() => {
    cpuData.push(Math.max(2, Math.min(97, cpuData[cpuData.length - 1] + (Math.random() - 0.5) * 14)));
    cpuData.shift();
    memData.push(Math.max(10, Math.min(92, memData[memData.length - 1] + (Math.random() - 0.5) * 4)));
    memData.shift();
    drawGraph("cpu-graph", cpuData, "#22d3ee");
    drawGraph("mem-graph", memData, "#a78bfa");
    document.getElementById("cpu-stat").textContent =
      `gevm ${cpuData[59].toFixed(1)}% · geosh ${(cpuData[59] / 3).toFixed(1)}%`;
    document.getElementById("mem-stat").textContent =
      `${(memData[59] * 0.64).toFixed(0)} MB / 4096 MB virtual`;
    renderProcs();
  }, 800);
}

function drawGraph(id, data, color) {
  const c = document.getElementById(id);
  if (!c || !c.getContext) return;
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

function renderProcs() {
  const procs = [
    [1, "geovd", (Math.random() * 0.4).toFixed(1), "12.0"],
    [42, "gevm", (cpuData[59] / 4).toFixed(1), "48.5"],
    [43, "geosh", (Math.random() * 1.2).toFixed(1), "9.2"],
    [77, "webd", (Math.random() * 2).toFixed(1), "33.7"],
    [90, "pkgd", "0.0", "4.1"],
  ];
  document.getElementById("proc-list").innerHTML = procs
    .map(p => `<tr><td>${p[0]}</td><td>${p[1]}</td><td>${p[2]}</td><td>${p[3]}</td></tr>`)
    .join("");
}

/* ============================ host os tab ============================ */
async function loadHostInfo() {
  const tbl = document.getElementById("host-table");
  let info;
  if (DEMO) {
    const ua = navigator.userAgent;
    const os = ua.includes("Win") ? "Windows" : ua.includes("Mac") ? "macOS"
      : ua.includes("Linux") ? "Linux" : "unknown";
    info = {
      system: os + " (detected from browser)", machine: navigator.platform,
      node: "this device", python: "—", geov: "0.1.0 (demo)",
    };
    document.getElementById("sys-info").textContent =
      "GeoOS 0.1.0 Geode\nkernel: geokernel 0.1.0\nmode: demo (static preview)\n" +
      "host: " + info.system + "\n\nrun `geov deploy` for the live system";
  } else {
    const r = await fetch("/api/host");
    info = await r.json();
    document.getElementById("sys-info").textContent =
      `GeoOS ${info.geov} Geode\nkernel: geokernel 0.1.0\n` +
      `host: ${info.system} ${info.release}\nmachine: ${info.machine}\n` +
      `python: ${info.python}\nvfs: ~/.geovos/vfs (sandboxed)`;
  }
  tbl.innerHTML = Object.entries(info)
    .map(([k, v]) => `<tr><td>${k}</td><td>${v || "—"}</td></tr>`).join("");
}

/* ============================ DEMO MODE (static preview) ============================ */
const DEMO_FS = {
  "/": ["bin/", "docs/", "etc/", "examples/", "home/", "tmp/", "var/"],
  "/docs": ["welcome.txt"],
  "/etc": ["os-release"],
  "/examples": ["hello.gv", "fizzbuzz.gv", "fib.gv"],
  "/home": ["user/"],
  "/home/user": ["notes.txt"],
  "/bin": ["README"], "/tmp": [], "/var": ["pkg/"], "/var/pkg": ["installed.json"],
};
const DEMO_FILES = {
  "/etc/os-release": 'NAME=GeoOS\nVERSION=0.1.0 (Geode)\nKERNEL=geokernel 0.1.0\nSHELL=geosh 0.1\nSCRIPT=geoVariable 1 (binary, sandboxed)\nPRETTY_NAME="GeoOS 0.1.0 Geode"\n',
  "/docs/welcome.txt": "Welcome to GeoOS!\n\nThis static preview runs in demo mode.\nFor the real thing:  pip install geov-os  &&  geov deploy\n\nTry in the Terminal: help, ls /, geofetch, run /examples/fizzbuzz.gv, pkg list",
  "/examples/hello.gv": EXAMPLES.hello,
  "/examples/fizzbuzz.gv": EXAMPLES.fizzbuzz,
  "/examples/fib.gv": EXAMPLES.fib,
  "/home/user/notes.txt": "My GeoOS notes\n==============\n\n- everything here is sandboxed\n",
  "/bin/README": "GeoOS built-in commands are provided by geosh.\n",
  "/var/pkg/installed.json": "{}",
};

function demoLs(path) {
  return (DEMO_FS[path] || []).map(n => ({
    name: n.replace(/\/$/, ""),
    type: n.endsWith("/") ? "dir" : "file",
    size: DEMO_FILES[path === "/" ? "/" + n : path + "/" + n]?.length || 0,
  }));
}

function demoRead(path) { return DEMO_FILES[path] ?? null; }

function demoResolve(p) {
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

function demoShell(cmdline) {
  const out = [];
  for (const chain of cmdline.split(";")) {
    for (const stage of chain.split("|")) {
      const toks = stage.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      out.push(demoCommand(toks));
    }
  }
  return out.filter(Boolean).join("\n");
}

function demoCommand(toks) {
  const alias = { dir: "ls", "Get-ChildItem": "ls", gci: "ls", type: "cat", gc: "cat",
    "Get-Content": "cat", cls: "clear", "Clear-Host": "clear", uname: "sysinfo",
    systeminfo: "sysinfo", tasklist: "ps", "Get-Process": "ps", man: "help" };
  let [cmd, ...args] = toks;
  cmd = alias[cmd] || cmd;
  switch (cmd) {
    case "help":
      return "FILES       ls, cd, pwd, cat, find, grep, echo, clear\n" +
        "SYSTEM      sysinfo, ps, date, whoami, geofetch, about\n" +
        "GEOVARIABLE run <x.gv>   (demo runs the in-browser interpreter)\n" +
        "PACKAGES    pkg list\n" +
        "NOTE        demo mode — full shell (pipes, redirects, pkg install,\n" +
        "            compile to .gvb binary) needs `geov deploy`";
    case "pwd": return cwd;
    case "cd": {
      const t = demoResolve(args[0] || "/home/user");
      if (DEMO_FS[t] || t === "/") { cwd = t; return ""; }
      return "error: cd: " + args[0] + ": no such directory";
    }
    case "ls": {
      const t = demoResolve(args.find(a => !a.startsWith("-")) || cwd);
      const items = DEMO_FS[t];
      return items ? (items.join("  ") || "(empty)") : "error: ls: no such directory";
    }
    case "cat": {
      const t = demoResolve(args[0]);
      return DEMO_FILES[t] ?? ("error: cat: " + args[0] + ": no such file");
    }
    case "echo": return args.join(" ");
    case "clear": return "\x1bCLEAR\x1b";
    case "date": return new Date().toString();
    case "whoami": return "user";
    case "sysinfo":
      return "GeoOS 0.1.0 Geode\nkernel:   geokernel 0.1.0\nshell:    geosh 0.1 (demo)\n" +
        "script:   geoVariable 1 (binary, sandboxed)\nhost os:  detected from browser";
    case "geofetch":
      return "      .-~~~~~~~~-.\n    .'  .-~~~-.   '.\n" +
        "   /   / ,--. \\     \\\n  |   | (Geo)  |     |\n" +
        "   \\   \\ `--' /     /\n    '.  `-~~~-'   .'\n" +
        "      '-~~~~~~~~-'\n\nuser@geov-box\nOS: GeoOS 0.1.0 Geode (demo)\n" +
        "Shell: geosh 0.1\nScript: geoVariable 1 (.gvb binary, sandboxed)";
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
      const t = demoResolve(args[0]);
      const src = DEMO_FILES[t];
      if (!src) return "error: run: " + (args[0] || "") + ": no such script";
      try { return demoRunGeo(src) + "\n[gevm-demo] interpreted (deploy for bytecode VM)"; }
      catch (e) { return "error: " + e.message; }
    }
    case "grep": {
      const t = demoResolve(args[1]);
      const text = DEMO_FILES[t] || "";
      return (text.split("\n").filter(l =>
        l.toLowerCase().includes((args[0] || "").toLowerCase())).join("\n")) || "(no matches)";
    }
    case "find": return "(demo: find needs `geov deploy`)";
    case "exit": return "\x1bEXIT\x1b";
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
