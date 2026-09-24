"""GeoOS local server — serves the web desktop and the OS API."""
import json
import platform
import socket
import threading
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
        ".ico": "image/x-icon", ".json": "application/json"}


class State:
    def __init__(self, home=None):
        home = home or (Path.home() / ".geovos")
        self.vfs = VFS(home / "vfs")
        self.vfs.seed()
        self.sessions = {}
        self.lock = threading.Lock()

    def session(self, sid):
        with self.lock:
            if sid not in self.sessions:
                self.sessions[sid] = ShellSession(self.vfs)
            return self.sessions[sid]


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
            if n > 8 * 1024 * 1024:
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
                if path == "/api/fs":
                    vpath = q.get("path", ["/"])[0]
                    entries = [{"name": n, "type": t, "size": s}
                               for n, t, s in state.vfs.ls(vpath)]
                    return self._json({"path": vpath, "entries": entries})
                if path == "/api/file":
                    vpath = q.get("path", [""])[0]
                    return self._json({"path": vpath,
                                       "content": state.vfs.read(vpath)})
                if path == "/api/ping":
                    return self._json({"ok": True, "geov": __version__})
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
                if self.path == "/api/file":
                    state.vfs.write(str(body["path"]),
                                    str(body.get("content", "")))
                    return self._json({"ok": True})
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
