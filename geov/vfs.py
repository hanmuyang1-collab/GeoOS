"""GeoOS virtual filesystem.

Everything lives under ~/.geovos/vfs on the host, but shell sessions only
ever see virtual paths ("/home/user", "/etc/...").  All resolution goes
through VFS.real() which refuses to escape the sandbox root.
"""
import json
import shutil
from pathlib import Path

OS_RELEASE = """\
NAME=GeoOS
VERSION=0.3.0 (Geode)
ID=geov
KERNEL=geokernel 0.3.0
SHELL=geosh 0.3
SCRIPT=geoVariable 1 (binary, sandboxed)
PRETTY_NAME="GeoOS 0.3.0 Geode"
"""

WELCOME = """\
Welcome to GeoOS!
=================

GeoOS is a hobby operating system that runs on top of your current OS.
Everything is virtual and sandboxed - nothing here can hurt your machine.

Try these:
  help                  list every command
  ls /                  look around the virtual filesystem
  cat /docs/welcome.txt read this file again
  run /examples/hello.gv        run a geoVariable script
  gvc /examples/fib.gv -o fib.gvb   compile source to BINARY bytecode
  hexdump fib.gvb               see the binary format
  run fib.gvb                   execute the binary in the sandbox VM
  geofetch                      show system info
  pkg list                      browse installable packages

Desktop apps: Terminal, GeoSearch (web browser + search), Code Studio,
Files, Monitor, Paint, Calculator, Settings, Help, Host OS.
"""

EXAMPLES = {
    "hello.gv": '''# hello.gv - your first geoVariable script
let name = "GeoOS user"
print("hello " + name + "!")
let lucky = 7
print("lucky number:", lucky)
''',
    "fizzbuzz.gv": '''# fizzbuzz.gv - the classic
for i in 1..20 {
    if i % 15 == 0 { print("FizzBuzz") }
    elif i % 3 == 0 { print("Fizz") }
    elif i % 5 == 0 { print("Buzz") }
    else { print(i) }
}
''',
    "fib.gv": '''# fib.gv - recursion test
fn fib(n) {
    if n < 2 { return n }
    return fib(n - 1) + fib(n - 2)
}
for i in 0..12 { print(fib(i)) }
''',
}


class VFSError(Exception):
    pass


class VFS:
    def __init__(self, root):
        self.root = Path(root).resolve()

    # ------------------------------------------------------------ setup
    def seed(self):
        """Create the default tree if it doesn't exist yet."""
        r = self.root
        if (r / "etc" / "os-release").exists():
            return False
        for d in ("home/user", "etc", "docs", "examples", "bin", "var/pkg", "tmp"):
            (r / d).mkdir(parents=True, exist_ok=True)
        (r / "etc" / "os-release").write_text(OS_RELEASE)
        (r / "docs" / "welcome.txt").write_text(WELCOME)
        (r / "bin" / "README").write_text(
            "GeoOS built-in commands live here conceptually.\n"
            "They are provided by geosh, not by files on disk.\n")
        (r / "var" / "pkg" / "installed.json").write_text("{}")
        for name, src in EXAMPLES.items():
            (r / "examples" / name).write_text(src)
        (r / "home" / "user" / "notes.txt").write_text(
            "My GeoOS notes\n==============\n\n- everything here is sandboxed\n")
        return True

    # ------------------------------------------------------------ paths
    def real(self, vpath, cwd="/"):
        """Resolve a virtual path to a real path, refusing escapes."""
        if not vpath:
            vpath = cwd
        if vpath.startswith("~"):
            vpath = "/home/user" + vpath[1:]
        if not vpath.startswith("/"):
            vpath = cwd.rstrip("/") + "/" + vpath
        parts = []
        for p in vpath.split("/"):
            if p in ("", "."):
                continue
            if p == "..":
                if parts:
                    parts.pop()
            else:
                parts.append(p)
        virt = "/" + "/".join(parts)
        real = (self.root / "/".join(parts)).resolve()
        if real != self.root and self.root not in real.parents:
            raise VFSError("path escapes the GeoOS sandbox")
        return virt, real

    # ------------------------------------------------------------ ops
    def exists(self, vpath, cwd="/"):
        return self.real(vpath, cwd)[1].exists()

    def isdir(self, vpath, cwd="/"):
        return self.real(vpath, cwd)[1].is_dir()

    def ls(self, vpath, cwd="/"):
        virt, real = self.real(vpath, cwd)
        if not real.exists():
            raise VFSError(f"ls: {vpath}: no such file or directory")
        if real.is_file():
            return [(virt.rsplit("/", 1)[-1], "file", real.stat().st_size)]
        out = []
        for p in sorted(real.iterdir(), key=lambda x: (x.is_file(), x.name)):
            out.append((p.name, "dir" if p.is_dir() else "file",
                        0 if p.is_dir() else p.stat().st_size))
        return out

    def read(self, vpath, cwd="/"):
        virt, real = self.real(vpath, cwd)
        if not real.exists():
            raise VFSError(f"cat: {vpath}: no such file or directory")
        if real.is_dir():
            raise VFSError(f"cat: {vpath}: is a directory")
        try:
            return real.read_text(errors="replace")
        except Exception:
            data = real.read_bytes()
            return data.hex(" ")

    def read_bytes(self, vpath, cwd="/"):
        virt, real = self.real(vpath, cwd)
        if not real.is_file():
            raise VFSError(f"{vpath}: no such file")
        return real.read_bytes()

    def write(self, vpath, content, cwd="/"):
        virt, real = self.real(vpath, cwd)
        real.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            real.write_bytes(content)
        else:
            real.write_text(content)
        return virt

    def append(self, vpath, content, cwd="/"):
        virt, real = self.real(vpath, cwd)
        real.parent.mkdir(parents=True, exist_ok=True)
        with open(real, "a") as fh:
            fh.write(content)
        return virt

    def mkdir(self, vpath, cwd="/"):
        virt, real = self.real(vpath, cwd)
        real.mkdir(parents=True, exist_ok=True)
        return virt

    def rm(self, vpath, cwd="/"):
        virt, real = self.real(vpath, cwd)
        if not real.exists():
            raise VFSError(f"rm: {vpath}: no such file or directory")
        if real == self.root:
            raise VFSError("rm: refusing to delete the filesystem root")
        if real.is_dir():
            shutil.rmtree(real)
        else:
            real.unlink()
        return virt

    def cp(self, src, dst, cwd="/"):
        _, s = self.real(src, cwd)
        _, d = self.real(dst, cwd)
        if not s.exists():
            raise VFSError(f"cp: {src}: no such file or directory")
        if d.is_dir():
            d = d / s.name
        if s.is_dir():
            shutil.copytree(s, d, dirs_exist_ok=True)
        else:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)

    def mv(self, src, dst, cwd="/"):
        _, s = self.real(src, cwd)
        _, d = self.real(dst, cwd)
        if not s.exists():
            raise VFSError(f"mv: {src}: no such file or directory")
        if d.is_dir():
            d = d / s.name
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))

    def find(self, base, name_pat, cwd="/"):
        _, b = self.real(base, cwd)
        hits = []
        if not b.exists():
            raise VFSError(f"find: {base}: no such directory")
        for p in b.rglob("*"):
            if name_pat.lower() in p.name.lower():
                hits.append("/" + str(p.relative_to(self.root)))
        return hits

    # ------------------------------------------------------------ state
    def installed_pkgs(self):
        _, real = self.real("/var/pkg/installed.json")
        try:
            return json.loads(real.read_text())
        except Exception:
            return {}

    def save_pkgs(self, pkgs):
        self.write("/var/pkg/installed.json", json.dumps(pkgs, indent=2))
