"""GeoOS local server — serves the web desktop and the OS API.

The server is what makes GeoOS a real OS layer instead of a mockup:
  * real virtual filesystem on disk (~/.geovos/vfs)
  * real process + CPU/memory telemetry from the host kernel
  * real code execution for multiple languages (Python, Node, Bash,
    geoVariable) with timeouts and output caps
  * persistent settings
  * GeoBrowse backend: real web search and a sandboxed page proxy so the
    in-OS browser can render the web without X-Frame-Options blocks
"""
import base64
import html as html_mod
import ipaddress
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from . import __version__
from .vfs import VFS
from .shell import ShellSession
from . import geovariable as gv
from .geovariable import format as gvfmt

WEB = Path(__file__).parent / "web"

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css",
        ".js": "application/javascript", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".json": "application/json",
        ".txt": "text/plain; charset=utf-8"}

MAX_CODE = 200_000          # chars of source accepted by /api/runcode
MAX_OUTPUT = 200_000        # chars of stdout/stderr returned
RUN_TIMEOUT = 15            # seconds, hard cap for guest code

BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 GeoOS-GeoBrowse/0.3")
BROWSE_TIMEOUT = 12         # seconds for search / page fetches
MAX_PAGE = 2_500_000        # bytes of a web page we will proxy


# ---------------------------------------------------------------- GeoBrowse backend
def _ip_blocked(host):
    """SSRF guard: refuse to browse loopback / private / link-local hosts."""
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except Exception:
            return True
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return True
    return False


def _clean(s):
    return html_mod.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def _anchors(page, cls):
    """All (href, inner-html) anchors carrying a CSS class, any attr order."""
    out = []
    for m in re.finditer(r"<a\b([^>]*)>(.*?)</a>", page, re.S):
        attrs, text = m.group(1), m.group(2)
        if cls in attrs:
            hm = re.search(r"href=['\"]([^'\"]+)['\"]", attrs)
            if hm:
                out.append((hm.group(1), text))
    return out


def _unwrap_ddg(href):
    m = re.search(r"uddg=([^&]+)", href)
    return urllib.parse.unquote(m.group(1)) if m else href


def _ddg_results(page, limit):
    links = _anchors(page, "result__a")
    snippets = [t for _, t in _anchors(page, "result__snippet")]
    return [{"title": _clean(title), "url": _unwrap_ddg(href),
             "snippet": _clean(snippets[i]) if i < len(snippets) else ""}
            for i, (href, title) in enumerate(links[:limit])]


def _ddg_lite_results(page, limit):
    links = _anchors(page, "result-link")
    snippets = re.findall(
        r"<td[^>]*class=['\"]result-snippet['\"][^>]*>(.*?)</td>", page, re.S)
    return [{"title": _clean(title), "url": _unwrap_ddg(href),
             "snippet": _clean(snippets[i]) if i < len(snippets) else ""}
            for i, (href, title) in enumerate(links[:limit])]


def _bing_results(page, limit):
    out = []
    for chunk in page.split('<li class="b_algo"')[1:]:
        m = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
                      chunk, re.S)
        if not m:
            continue
        cap = (re.search(r'class="b_lineclamp[^"]*"[^>]*>(.*?)</p>', chunk, re.S)
               or re.search(r"<p[^>]*>(.*?)</p>", chunk, re.S))
        out.append({"title": _clean(m.group(2)), "url": m.group(1),
                    "snippet": _clean(cap.group(1)) if cap else ""})
        if len(out) >= limit:
            break
    return out


def web_search(query, limit=8):
    """Real web search, no API key: DuckDuckGo HTML -> DDG Lite -> Bing."""
    q = urllib.parse.quote_plus(query)
    attempts = [
        ("https://html.duckduckgo.com/html/?q=" + q, _ddg_results),
        ("https://lite.duckduckgo.com/lite/?q=" + q, _ddg_lite_results),
        ("https://www.bing.com/search?q=" + q + "&mkt=en-US", _bing_results),
    ]
    errors = []
    for url, parser in attempts:
        host = urllib.parse.urlparse(url).hostname
        try:
            req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
            with urllib.request.urlopen(req, timeout=BROWSE_TIMEOUT) as r:
                page = r.read(MAX_PAGE).decode("utf-8", "replace")
            results = parser(page, limit)
            if results:
                return results
            errors.append(host + ": no parseable results")
        except Exception as e:
            errors.append(f"{host}: {e}")
    raise RuntimeError("all search backends failed — " + "; ".join(errors))


def _rewrite_links(text, final_url):
    """Point in-page links/forms back through /browse so clicking around
    stays inside GeoBrowse's window (real live browsing, same-origin)."""
    def repl(m):
        attr, q, href = m.group(1), m.group(2), m.group(3)
        low = href.strip().lower()
        if not href or low.startswith(("#", "javascript:", "mailto:",
                                       "tel:", "data:", "blob:")):
            return m.group(0)
        absu = urllib.parse.urljoin(final_url, href)
        if not absu.startswith(("http://", "https://")):
            return m.group(0)
        prox = "/browse?url=" + urllib.parse.quote(absu, safe="")
        return f"{attr}={q}{prox}{q}"
    return re.sub(r'''(href|action)\s*=\s*(["'])(.*?)\2''', repl, text,
                  flags=re.I | re.S)


def fetch_page(url):
    """Fetch a web page server-side so the GeoBrowse iframe can render it
    same-origin (no X-Frame-Options blocks). Returns (html, final_url)."""
    if "://" not in url:
        url = "https://" + url
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("only http/https URLs are browsable")
    if _ip_blocked(p.hostname):
        raise ValueError("blocked: local/private addresses are not browsable")
    req = urllib.request.Request(urllib.parse.urlunparse(p),
                                 headers={"User-Agent": BROWSER_UA})
    with urllib.request.urlopen(req, timeout=BROWSE_TIMEOUT) as r:
        raw = r.read(MAX_PAGE)
        ctype = r.headers.get("Content-Type", "")
        final_url = r.geturl()
    enc = "utf-8"
    m = re.search(r"charset=([\w.-]+)", ctype)
    if m:
        enc = m.group(1)
    text = raw.decode(enc, "replace")
    # keep navigation inside the window: links route back through /browse.
    # (runs BEFORE the base tag is injected, so our <base href> is untouched)
    text = _rewrite_links(text, final_url)
    # make relative links/resources resolve against the real origin
    base = f'<base href="{html_mod.escape(final_url, quote=True)}">'
    if re.search(r"<head[^>]*>", text, re.I):
        text = re.sub(r"(<head[^>]*>)", r"\1" + base, text, count=1, flags=re.I)
    else:
        text = base + text
    return text, final_url


# ---------------------------------------------------------------- runtimes
def detect_runtimes():
    """Which language runtimes this host can execute for GeoOS apps."""
    rt = {"geovariable": {"cmd": None, "version": gvfmt.VERSION}}
    py = sys.executable
    rt["python"] = {"cmd": py, "version": platform.python_version()}
    node = shutil.which("node")
    if node:
        try:
            v = subprocess.run([node, "--version"], capture_output=True,
                               text=True, timeout=5).stdout.strip()
        except Exception:
            v = "unknown"
        rt["javascript"] = {"cmd": node, "version": v}
    for sh in ("bash", "sh"):
        p = shutil.which(sh)
        if p:
            rt[sh] = {"cmd": p, "version": ""}
    return rt


def run_guest_code(language, code, stdin_text, vfs_root, runtimes):
    """Execute guest code with the cwd jailed to the VFS scratch dir.

    Every language runs with a wall-clock timeout, capped output and a
    minimal environment whose HOME points inside the VFS.
    """
    language = (language or "").lower()
    if language in ("gv", "geovariable"):
        out, steps, _ = gv.run_source(code)
        return {"ok": True, "exit": 0, "stdout": out, "stderr": "",
                "note": f"gevm: {steps} instructions (sandboxed bytecode)"}
    if language in ("python", "py", "python3"):
        cmd = [runtimes["python"]["cmd"], "-u", "-c", code]
    elif language in ("javascript", "js", "node"):
        if "javascript" not in runtimes:
            return {"ok": False, "error":
                    "javascript runtime not installed on host (needs node)"}
        cmd = [runtimes["javascript"]["cmd"], "-e", code]
    elif language in ("bash", "sh"):
        if language not in runtimes:
            return {"ok": False, "error": f"{language} not available on host"}
        cmd = [runtimes[language]["cmd"], "-c", code]
    else:
        return {"ok": False, "error": f"unsupported language '{language}'. "
                f"available: {', '.join(sorted(runtimes))}"}

    scratch = vfs_root / ".run"
    scratch.mkdir(parents=True, exist_ok=True)
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
           "HOME": str(vfs_root), "LANG": "C.UTF-8",
           "PYTHONDONTWRITEBYTECODE": "1", "TERM": "dumb"}
    try:
        proc = subprocess.run(
            cmd, input=stdin_text or "", capture_output=True, text=True,
            timeout=RUN_TIMEOUT, cwd=str(scratch), env=env, errors="replace")
        return {"ok": proc.returncode == 0, "exit": proc.returncode,
                "stdout": proc.stdout[-MAX_OUTPUT:],
                "stderr": proc.stderr[-MAX_OUTPUT:]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "timeout": True, "exit": -9, "stdout": "",
                "stderr": f"killed: exceeded {RUN_TIMEOUT}s sandbox limit"}


# ---------------------------------------------------------------- host telemetry
def _read_proc_stat():
    try:
        with open("/proc/stat") as f:
            parts = f.readline().split()
        vals = list(map(int, parts[1:]))
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
        return sum(vals), idle
    except Exception:
        return None, None


def _mem_info():
    info = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, rest = line.partition(":")
                info[k] = int(rest.strip().split()[0])  # kB
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", 0)
        return {"total_mb": total / 1024, "used_mb": (total - avail) / 1024,
                "avail_mb": avail / 1024}
    except Exception:
        return None


def _list_processes(limit=40):
    procs = []
    proc = Path("/proc")
    if proc.is_dir():
        for p in proc.iterdir():
            if not p.name.isdigit():
                continue
            try:
                name = (p / "comm").read_text().strip()
                rss_kb = 0
                for line in (p / "status").read_text().splitlines():
                    if line.startswith("VmRSS:"):
                        rss_kb = int(line.split()[1])
                        break
                procs.append({"pid": int(p.name), "name": name,
                              "mem_mb": round(rss_kb / 1024, 1)})
            except Exception:
                continue
    else:  # macOS / fallback: use ps
        try:
            out = subprocess.run(["ps", "-Ao", "pid,comm,rss"],
                                 capture_output=True, text=True,
                                 timeout=5).stdout
            for line in out.splitlines()[1:]:
                parts = line.split(None, 2)
                if len(parts) == 3:
                    procs.append({"pid": int(parts[0]),
                                  "name": Path(parts[1]).name,
                                  "mem_mb": round(int(parts[2]) / 1024, 1)})
        except Exception:
            pass
    procs.sort(key=lambda x: -x["mem_mb"])
    return procs[:limit]


def host_info():
    return {
        "system": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
        "machine": platform.machine(),
        "processor": platform.processor() or platform.machine(),
        "node": platform.node(),
        "python": platform.python_version(),
        "geov": __version__,
    }


class State:
    def __init__(self, home=None):
        home = home or (Path.home() / ".geovos")
        self.home = home
        self.vfs = VFS(home / "vfs")
        self.vfs.seed()
        self.sessions = {}
        self.lock = threading.Lock()
        self.runtimes = detect_runtimes()
        self._cpu_prev = _read_proc_stat()
        self.settings_path = home / "settings.json"
        self.settings = self._load_settings()

    def session(self, sid):
        with self.lock:
            if sid not in self.sessions:
                self.sessions[sid] = ShellSession(self.vfs)
            return self.sessions[sid]

    def _load_settings(self):
        try:
            return json.loads(self.settings_path.read_text())
        except Exception:
            return {}

    def save_settings(self):
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps(self.settings, indent=2))

    def sysinfo(self):
        cpu_pct = None
        cur = _read_proc_stat()
        if cur[0] is not None and self._cpu_prev[0] is not None:
            dt = cur[0] - self._cpu_prev[0]
            di = cur[1] - self._cpu_prev[1]
            if dt > 0:
                cpu_pct = round(100 * (1 - di / dt), 1)
        self._cpu_prev = cur
        if cpu_pct is None:  # first call: take a quick live sample
            a = _read_proc_stat()
            time.sleep(0.12)
            b = _read_proc_stat()
            self._cpu_prev = b
            if a[0] is not None and b[0] and b[0] > a[0]:
                cpu_pct = round(100 * (1 - (b[1] - a[1]) / (b[0] - a[0])), 1)
        info = {"cpu_percent": cpu_pct, "mem": _mem_info(),
                "uptime_s": None, "loadavg": None, "procs": _list_processes()}
        try:
            with open("/proc/uptime") as f:
                info["uptime_s"] = float(f.read().split()[0])
        except Exception:
            pass
        try:
            info["loadavg"] = list(os.getloadavg())
        except Exception:
            pass
        return info


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"GeoOS/{__version__}"

        # ---------------- helpers ----------------
        def _json(self, obj, code=200):
            data = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            n = int(self.headers.get("Content-Length", 0))
            if n > 16 * 1024 * 1024:
                raise ValueError("request too large")
            return json.loads(self.rfile.read(n) or b"{}")

        def log_message(self, *a):
            pass  # quiet

        # ---------------- GET ----------------
        def do_GET(self):
            url = urlparse(self.path)
            path = url.path
            q = parse_qs(url.query)
            try:
                if path == "/api/host":
                    return self._json(host_info())
                if path == "/api/ping":
                    return self._json({"ok": True, "geov": __version__})
                if path == "/api/sysinfo":
                    return self._json(state.sysinfo())
                if path == "/api/processes":
                    return self._json({"procs": _list_processes(60)})
                if path == "/api/runtimes":
                    return self._json({k: {"version": v["version"]}
                                       for k, v in state.runtimes.items()})
                if path == "/api/settings":
                    return self._json(state.settings)
                if path == "/api/search":
                    query = q.get("q", [""])[0].strip()
                    if not query:
                        return self._json({"error": "missing q"}, 400)
                    return self._json({"query": query,
                                       "results": web_search(query)})
                if path == "/browse":
                    target = q.get("url", [""])[0].strip()
                    if not target:
                        return self._json({"error": "missing url"}, 400)
                    try:
                        page, final_url = fetch_page(target)
                    except Exception as e:
                        msg = html_mod.escape(str(e))
                        page = (f"<!doctype html><body style='background:#0b1120;"
                                f"color:#e2e8f0;font-family:system-ui;padding:40px'>"
                                f"<h2>GeoBrowse couldn't load that page</h2>"
                                f"<p>{msg}</p></body>")
                    data = page.encode("utf-8", "replace")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()   # same-origin proxy: no X-Frame-Options
                    self.wfile.write(data)
                    return
                if path == "/api/fs":
                    vpath = q.get("path", ["/"])[0]
                    entries = [{"name": n, "type": t, "size": s}
                               for n, t, s in state.vfs.ls(vpath)]
                    return self._json({"path": vpath, "entries": entries})
                if path == "/api/file":
                    vpath = q.get("path", [""])[0]
                    if q.get("raw", ["0"])[0] == "1":
                        data = state.vfs.read_bytes(vpath)
                        return self._json({"path": vpath, "encoding": "base64",
                                           "content": base64.b64encode(data).decode()})
                    return self._json({"path": vpath,
                                       "content": state.vfs.read(vpath)})
                return self._static(path)
            except Exception as e:
                return self._json({"error": str(e)}, 400)

        def _static(self, path):
            if path in ("/", ""):
                path = "/index.html"
            rel = path.lstrip("/")
            target = (WEB / rel).resolve()
            if WEB.resolve() not in target.parents and target != WEB.resolve():
                return self._json({"error": "forbidden"}, 403)
            if not target.is_file():
                return self._json({"error": "not found"}, 404)
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type",
                             MIME.get(target.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        # ---------------- POST ----------------
        def do_POST(self):
            try:
                body = self._body()
            except Exception as e:
                return self._json({"error": str(e)}, 400)
            try:
                if self.path == "/api/exec":
                    sess = state.session(str(body.get("session", "default")))
                    out = sess.exec(str(body.get("cmd", "")))
                    return self._json({"output": out, "cwd": sess.cwd})
                if self.path == "/api/compile":
                    src = str(body.get("source", ""))
                    binary = gv.compile_source(src)
                    consts, fns, code = gvfmt.unpack(binary)
                    return self._json({
                        "ok": True, "size": len(binary), "hex": binary.hex(),
                        "constants": len(consts), "functions": len(fns),
                        "code_bytes": len(code)})
                if self.path == "/api/run":
                    if "hex" in body:
                        data = bytes.fromhex(body["hex"])
                        out, steps = gv.run_binary(data)
                    else:
                        src = str(body.get("source", ""))
                        out, steps, _ = gv.run_source(src)
                    return self._json({"ok": True, "output": out,
                                       "steps": steps})
                if self.path == "/api/runcode":
                    code = str(body.get("code", ""))
                    if len(code) > MAX_CODE:
                        return self._json({"error": "code too large "
                                           f"(>{MAX_CODE} chars)"}, 400)
                    result = run_guest_code(str(body.get("language", "")),
                                            code, str(body.get("stdin", "")),
                                            state.vfs.root, state.runtimes)
                    return self._json(result)
                if self.path == "/api/file":
                    vpath = str(body["path"])
                    if body.get("encoding") == "base64":
                        data = base64.b64decode(body.get("content", ""))
                        state.vfs.write(vpath, data)
                    else:
                        state.vfs.write(vpath, str(body.get("content", "")))
                    return self._json({"ok": True})
                if self.path == "/api/fsop":
                    op = body.get("op")
                    vpath = str(body.get("path", ""))
                    if op == "mkdir":
                        state.vfs.mkdir(vpath)
                    elif op == "rm":
                        state.vfs.rm(vpath)
                    elif op == "rename":
                        state.vfs.mv(vpath, str(body.get("to", "")))
                    else:
                        return self._json({"error": f"unknown op '{op}'"}, 400)
                    return self._json({"ok": True})
                if self.path == "/api/settings":
                    patch = body.get("settings", {})
                    if not isinstance(patch, dict):
                        return self._json({"error": "settings must be an object"}, 400)
                    state.settings.update(patch)
                    state.save_settings()
                    return self._json({"ok": True, "settings": state.settings})
                return self._json({"error": "unknown endpoint"}, 404)
            except Exception as e:
                return self._json({"error": str(e)}, 400)

    return Handler


def find_port(preferred):
    for port in [preferred] + list(range(preferred + 1, preferred + 20)):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("no free port found")


def serve(port=8000):
    state = State()
    port = find_port(port)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(state))
    return server, port
