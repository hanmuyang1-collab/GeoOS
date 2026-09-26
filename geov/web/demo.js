/* GeoOS desktop — demo mode for the static preview (no server).
   Part of the split web UI; index.html loads app.js first, then the
   apps-*.js files, then demo.js. All files share one global scope. */

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
      "/etc/os-release": 'NAME=GeoOS\nVERSION=0.3.1 (Geode)\nKERNEL=geokernel 0.3.1\nSHELL=geosh 0.3\nSCRIPT=geoVariable 1 (binary, sandboxed)\nPRETTY_NAME="GeoOS 0.3.1 Geode"\n',
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
      return "GeoOS 0.3.1 Geode\nkernel:   geokernel 0.3.1\nshell:    geosh 0.3 (demo)\n" +
        "script:   geoVariable 1 (binary, sandboxed)\nhost os:  detected from browser";
    case "geofetch":
      return "      .-~~~~~~~~-.\n    .'  .-~~~-.   '.\n" +
        "   /   / ,--. \     \\\n  |   | (Geo)  |     |\n" +
        "   \   \ `--' /     /\n    '.  `-~~~-'   .'\n" +
        "      '-~~~~~~~~-'\n\nuser@geov-box\nOS: GeoOS 0.3.1 Geode (demo)\n" +
        "Shell: geosh 0.3\nScript: geoVariable 1 (.gvb binary, sandboxed)";
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
