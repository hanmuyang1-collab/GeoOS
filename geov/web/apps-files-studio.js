/* GeoOS desktop — Files and Code Studio apps.
   Part of the split web UI; index.html loads app.js first, then the
   apps-*.js files, then demo.js. All files share one global scope. */

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
    `<textarea class="fs-editor" placeholder="select a file, or create a new one" disabled ` +
    `autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>` +
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

/* ---------------- syntax highlighting ---------------- */
const HL_KEYWORDS = {
  geovariable: "let set if elif else while for in fn return true false and or not break continue null",
  python: "def return if elif else while for in import from as pass break continue class try except finally with lambda yield global nonlocal True False None and or not is raise del assert async await print",
  javascript: "const let var function return if else while for in of do switch case default break continue class extends new try catch finally throw typeof instanceof delete void yield async await true false null undefined this super static import export from",
  bash: "if then elif else fi for while until do done case esac function in echo exit return local export readonly shift break continue eval exec set unset source alias",
  json: "true false null",
};
const HL_BUILTINS = {
  geovariable: "print str num len upper lower abs min max type input",
  python: "len range str int float list dict set tuple enumerate zip map filter sum min max abs type input open isinstance repr sorted reversed round",
  javascript: "console Math JSON Object Array String Number Boolean Promise Date Error RegExp Map Set parseInt parseFloat isNaN require module exports window document fetch setTimeout setInterval",
  bash: "cd ls cat grep sed awk pwd chmod chown mkdir rm cp mv touch head tail",
};
function hlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function highlightCode(src, lang) {
  const kw = new Set((HL_KEYWORDS[lang] || "").split(" ").filter(Boolean));
  const bi = new Set((HL_BUILTINS[lang] || "").split(" ").filter(Boolean));
  if (!kw.size && !bi.size) return hlEscape(src);
  const comment = (lang === "javascript") ? "\\/\\/[^\\n]*"
    : (lang === "json") ? null : "#[^\\n]*";
  const re = new RegExp(
    (comment ? "(" + comment + ")|" : "") +
    '("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)|' +
    "(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_]\\w*)", "g");
  let out = "", last = 0, m;
  while ((m = re.exec(src))) {
    out += hlEscape(src.slice(last, m.index));
    if (m[1] !== undefined) out += `<span class="tok-com">${hlEscape(m[1])}</span>`;
    else if (m[2] !== undefined) out += `<span class="tok-str">${hlEscape(m[2])}</span>`;
    else if (m[3] !== undefined) out += `<span class="tok-num">${hlEscape(m[3])}</span>`;
    else {
      const w = m[4];
      if (kw.has(w)) out += `<span class="tok-kw">${w}</span>`;
      else if (bi.has(w)) out += `<span class="tok-bi">${w}</span>`;
      else out += hlEscape(w);
    }
    last = m.index + m[0].length;
  }
  return out + hlEscape(src.slice(last));
}

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
    `<div class="studio-editor-wrap"><pre class="studio-hl" aria-hidden="true"><code></code></pre>` +
    `<textarea class="studio-editor" spellcheck="false" autocapitalize="none" ` +
    `autocomplete="off" autocorrect="off" data-gramm="false"></textarea></div>` +
    `<div class="studio-out-wrap"><div class="studio-out-head">output` +
    `<span class="studio-status"></span></div>` +
    `<div class="studio-out">press Run to execute — .gv compiles to real .gvb bytecode, .py runs on the host python, .js on node</div>` +
    `</div></div></div>`;

  const editor = body.querySelector(".studio-editor");
  const hlPre = body.querySelector(".studio-hl");
  const hlCode = body.querySelector(".studio-hl code");
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
  const curLang = () => (curFile ? langOf(curFile) : "geovariable");
  const updateHL = () => {
    hlCode.innerHTML = highlightCode(editor.value, curLang()) + "\n";
    hlPre.scrollTop = editor.scrollTop;
    hlPre.scrollLeft = editor.scrollLeft;
  };
  const setLang = () => {
    const l = curLang();
    langEl.textContent = l;
    const rt = RUNTIMES[l] || (l === "bash" ? RUNTIMES.bash || RUNTIMES.sh : null);
    langEl.title = rt ? ("runtime: " + (rt.version || "available")) : "not runnable (edit only)";
    updateHL();
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

  editor.addEventListener("input", updateHL);
  editor.addEventListener("scroll", () => {
    hlPre.scrollTop = editor.scrollTop;
    hlPre.scrollLeft = editor.scrollLeft;
  });
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = editor.selectionStart;
      editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(editor.selectionEnd);
      editor.selectionStart = editor.selectionEnd = s + 4;
      updateHL();
    }
  });

  refreshSide();
  if (opts && opts.file) openFile(opts.file);
  else { editor.value = STUDIO_EXAMPLES.hello; curFile = null; setLang(); }
}
