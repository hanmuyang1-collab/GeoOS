"""geosh — the GeoOS unified shell.

One command set, aliases from every world:
  ls        = dir, gci, Get-ChildItem
  cat       = type, gc, Get-Content
  cd        = Set-Location, sl
  pwd       = Get-Location, gl
  cp        = copy, Copy-Item, ci
  mv        = move, Move-Item, mi
  rm        = del, erase, Remove-Item, ri
  grep      = findstr, Select-String, sls
  ps        = Get-Process, gps, tasklist
  echo      = write, Write-Output
  clear     = cls, Clear-Host
  env       = printenv, Get-ChildItem-Env, set
  sysinfo   = uname, systeminfo, Get-ComputerInfo, sw_vers
  ...

Extras: pipes (|), chains (;), redirects (> >>), geofetch, pkg manager,
geoVariable tooling (run / gvc / hexdump).
"""
import platform
import shlex
import time
from datetime import datetime

from .vfs import VFS, VFSError
from .geovariable import (compile_source, run_binary, GeoError, VMError,
                          FormatError)
from .geovariable import format as gvfmt


class ShellError(Exception):
    pass


GEOFETCH_ART = r"""
        .-~~~~~~~~-.
      .'  .-~~~-.   '.
     /   / ,--. \     \
    |   | (Geo)  |     |
     \   \ `--' /     /
      '.  `-~~~-'   .'
        '-~~~~~~~~-'
""".strip("\n")

PACKAGES = {
    "cowsay": {
        "desc": "A talking cow. Essential system component.",
        "version": "1.0",
    },
    "geoquote": {
        "desc": "Prints inspirational quotes about geography and code.",
        "version": "1.2",
    },
    "hello-gv": {
        "desc": "Installs /examples/hello.gv demo script.",
        "version": "0.3",
    },
}

QUOTES = [
    "The map is not the territory, but the bytecode is the program.",
    "Every coordinate system is a choice. Choose geoVariable.",
    "Latitude is attitude.",
    "Compiling is just translating dreams into opcodes.",
    "There is no place like /home/user.",
]


class ShellSession:
    def __init__(self, vfs: VFS, username="user"):
        self.vfs = vfs
        self.cwd = "/home/user"
        self.username = username
        self.env = {
            "USER": username, "HOME": "/home/user", "SHELL": "/bin/geosh",
            "PATH": "/bin:/usr/bin", "TERM": "geov-term", "LANG": "en_US.UTF-8",
        }
        self.history = []
        self.procs = self._boot_procs()

    def _boot_procs(self):
        return [
            {"pid": 1, "name": "geovd", "cpu": 0.2, "mem": 12.0},
            {"pid": 42, "name": "gevm", "cpu": 1.1, "mem": 48.5},
            {"pid": 43, "name": "geosh", "cpu": 0.4, "mem": 9.2},
            {"pid": 77, "name": "webd", "cpu": 0.8, "mem": 33.7},
            {"pid": 90, "name": "pkgd", "cpu": 0.0, "mem": 4.1},
        ]

    # =================================================================
    def exec(self, line):
        line = line.strip()
        if not line:
            return ""
        self.history.append(line)
        outputs = []
        for chain in self._split_top(line, ";"):
            try:
                out = self._pipeline(chain)
            except (ShellError, VFSError, GeoError, VMError, FormatError) as e:
                out = f"error: {e}"
            if out:
                outputs.append(out)
        return "\n".join(outputs)

    def _split_top(self, s, sep):
        parts, buf, q = [], [], None
        i = 0
        while i < len(s):
            c = s[i]
            if q:
                buf.append(c)
                if c == q:
                    q = None
            elif c in "\"'":
                q = c; buf.append(c)
            elif c == sep:
                parts.append("".join(buf)); buf = []
            else:
                buf.append(c)
            i += 1
        parts.append("".join(buf))
        return [p.strip() for p in parts if p.strip()]

    def _pipeline(self, chain):
        # redirect?
        target, mode = None, None
        for marker in (">>", ">"):
            if marker in chain:
                chain, _, target = chain.partition(marker)
                mode = marker
                target = target.strip().split()[0] if target.strip() else None
                break
        stages = self._split_top(chain, "|")
        stdin = None
        out = ""
        for st in stages:
            toks = shlex.split(st)
            if not toks:
                continue
            out = self._command(toks, stdin)
            stdin = out
        if target:
            if mode == ">>":
                self.vfs.append(target, out + ("\n" if out else ""), self.cwd)
            else:
                self.vfs.write(target, out + ("\n" if out else ""), self.cwd)
            return ""
        return out

    # =================================================================
    def _command(self, toks, stdin):
        name = ALIASES.get(toks[0], toks[0])
        args = toks[1:]
        fn = COMMANDS.get(name)
        if fn is None:
            # package-provided commands
            pkgs = self.vfs.installed_pkgs()
            if name == "cowsay" and "cowsay" in pkgs:
                return self._cowsay(" ".join(args) or "moo")
            if name == "geoquote" and "geoquote" in pkgs:
                seed = int(time.time()) % len(QUOTES)
                return QUOTES[seed]
            raise ShellError(f"{toks[0]}: command not found "
                             f"(try 'help' or 'pkg list')")
        return fn(self, args, stdin)

    # ---------------------------------------------------------------- utils
    def _one_path(self, args, default=None):
        return args[0] if args else (default or self.cwd)

    # =================================================================
    # commands
    def cmd_ls(self, args, stdin):
        flags = [a for a in args if a.startswith("-")]
        paths = [a for a in args if not a.startswith("-")]
        long = "-l" in flags
        show_all = "-a" in flags or "-la" in flags or "-al" in flags
        target = paths[0] if paths else self.cwd
        entries = self.vfs.ls(target, self.cwd)
        if not show_all:
            entries = [e for e in entries if not e[0].startswith(".")]
        if not entries:
            return "(empty)"
        if long:
            lines = []
            for name, kind, size in entries:
                t = "d" if kind == "dir" else "-"
                lines.append(f"{t}rw-r--r--  {size:>10}  {name}{'/' if kind == 'dir' else ''}")
            return "\n".join(lines)
        return "\n".join(f"{n}{'/' if k == 'dir' else ''}" for n, k, s in entries)

    def cmd_cd(self, args, stdin):
        virt, real = self.vfs.real(self._one_path(args, "/home/user"), self.cwd)
        if not real.exists():
            raise ShellError(f"cd: {args[0] if args else ''}: no such directory")
        if not real.is_dir():
            raise ShellError("cd: not a directory")
        self.cwd = virt
        return ""

    def cmd_pwd(self, args, stdin):
        return self.cwd

    def cmd_cat(self, args, stdin):
        if not args:
            return stdin or ""
        return "\n".join(self.vfs.read(a, self.cwd) for a in args)

    def cmd_touch(self, args, stdin):
        if not args:
            raise ShellError("touch: missing file name")
        for a in args:
            if not self.vfs.exists(a, self.cwd):
                self.vfs.write(a, "", self.cwd)
        return ""

    def cmd_mkdir(self, args, stdin):
        if not args:
            raise ShellError("mkdir: missing directory name")
        for a in args:
            self.vfs.mkdir(a, self.cwd)
        return ""

    def cmd_rm(self, args, stdin):
        paths = [a for a in args if not a.startswith("-")]
        if not paths:
            raise ShellError("rm: missing operand")
        for a in paths:
            self.vfs.rm(a, self.cwd)
        return ""

    def cmd_cp(self, args, stdin):
        paths = [a for a in args if not a.startswith("-")]
        if len(paths) != 2:
            raise ShellError("cp: need source and destination")
        self.vfs.cp(paths[0], paths[1], self.cwd)
        return ""

    def cmd_mv(self, args, stdin):
        paths = [a for a in args if not a.startswith("-")]
        if len(paths) != 2:
            raise ShellError("mv: need source and destination")
        self.vfs.mv(paths[0], paths[1], self.cwd)
        return ""

    def cmd_write(self, args, stdin):
        """write <file> <text...>  OR  some-cmd > file"""
        if len(args) < 2:
            raise ShellError("write: usage: write <file> <text...>")
        self.vfs.write(args[0], " ".join(args[1:]) + "\n", self.cwd)
        return ""

    def cmd_append(self, args, stdin):
        if len(args) < 2:
            raise ShellError("append: usage: append <file> <text...>")
        self.vfs.append(args[0], " ".join(args[1:]) + "\n", self.cwd)
        return ""

    def cmd_head(self, args, stdin):
        n = 10
        if args and args[0] == "-n":
            n = int(args[1]); args = args[2:]
        text = self.vfs.read(args[0], self.cwd) if args else (stdin or "")
        return "\n".join(text.splitlines()[:n])

    def cmd_tail(self, args, stdin):
        n = 10
        if args and args[0] == "-n":
            n = int(args[1]); args = args[2:]
        text = self.vfs.read(args[0], self.cwd) if args else (stdin or "")
        return "\n".join(text.splitlines()[-n:])

    def cmd_wc(self, args, stdin):
        text = self.vfs.read(args[0], self.cwd) if args else (stdin or "")
        lines = text.splitlines()
        return f"{len(lines)} lines, {len(text.split())} words, {len(text)} bytes"

    def cmd_find(self, args, stdin):
        if not args:
            raise ShellError("find: usage: find <name-pattern> [path]")
        pat = args[0]
        base = args[1] if len(args) > 1 else self.cwd
        hits = self.vfs.find(base, pat, self.cwd)
        return "\n".join(hits) if hits else "(no matches)"

    def cmd_grep(self, args, stdin):
        if not args:
            raise ShellError("grep: usage: grep <pattern> [file]  (or via pipe)")
        pat = args[0]
        text = self.vfs.read(args[1], self.cwd) if len(args) > 1 else (stdin or "")
        hits = [l for l in text.splitlines() if pat.lower() in l.lower()]
        return "\n".join(hits) if hits else "(no matches)"

    def cmd_echo(self, args, stdin):
        out = " ".join(args)
        for k, v in self.env.items():
            out = out.replace(f"${k}", v)
        return out

    def cmd_clear(self, args, stdin):
        return "\x1bCLEAR\x1b"

    def cmd_date(self, args, stdin):
        return datetime.now().strftime("%a %b %d %H:%M:%S %Z %Y").strip()

    def cmd_whoami(self, args, stdin):
        return self.username

    def cmd_hostname(self, args, stdin):
        return "geov-box"

    def cmd_sysinfo(self, args, stdin):
        rel = self.vfs.read("/etc/os-release")
        kv = dict(l.split("=", 1) for l in rel.splitlines() if "=" in l)
        host = platform.system() or "unknown"
        return (f"{kv.get('PRETTY_NAME', 'GeoOS').strip(chr(34))}\n"
                f"kernel:   {kv.get('KERNEL', 'geokernel')}\n"
                f"shell:    {kv.get('SHELL', 'geosh')}\n"
                f"script:   {kv.get('SCRIPT', 'geoVariable')}\n"
                f"host os:  {host} {platform.release()} ({platform.machine()})\n"
                f"python:   {platform.python_version()}\n"
                f"uptime:   virtual, always fresh")

    def cmd_ps(self, args, stdin):
        lines = [f"{'PID':>5}  {'NAME':<12} {'CPU%':>5}  {'MEM(MB)':>8}"]
        for p in self.procs:
            lines.append(f"{p['pid']:>5}  {p['name']:<12} {p['cpu']:>5.1f}  {p['mem']:>8.1f}")
        return "\n".join(lines)

    def cmd_kill(self, args, stdin):
        if not args:
            raise ShellError("kill: usage: kill <pid>")
        try:
            pid = int(args[0])
        except ValueError:
            raise ShellError("kill: pid must be a number")
        if pid == 1:
            raise ShellError("kill: cannot kill geovd (pid 1) — nice try")
        for p in list(self.procs):
            if p["pid"] == pid:
                self.procs.remove(p)
                return f"terminated {p['name']} (pid {pid})"
        raise ShellError(f"kill: no process with pid {pid}")

    def cmd_env(self, args, stdin):
        return "\n".join(f"{k}={v}" for k, v in sorted(self.env.items()))

    def cmd_export(self, args, stdin):
        if not args or "=" not in args[0]:
            raise ShellError("export: usage: export NAME=value")
        k, _, v = args[0].partition("=")
        self.env[k] = v
        return ""

    def cmd_history(self, args, stdin):
        return "\n".join(f"{i + 1:>4}  {h}" for i, h in enumerate(self.history))

    def cmd_geofetch(self, args, stdin):
        host = platform.system() or "unknown"
        info = [
            f"user@geov-box",
            f"---------------",
            f"OS: GeoOS 0.3.1 Geode",
            f"Kernel: geokernel 0.3.1",
            f"Shell: geosh 0.3",
            f"Script: geoVariable 1 (.gvb binary, sandboxed)",
            f"Host: {host} {platform.machine()}",
            f"Packages: {len(self.vfs.installed_pkgs())} installed",
            f"Uptime: virtual",
        ]
        art = GEOFETCH_ART.split("\n")
        width = max(len(a) for a in art) + 4
        lines = []
        for i in range(max(len(art), len(info))):
            a = art[i] if i < len(art) else ""
            t = info[i] if i < len(info) else ""
            lines.append(f"{a:<{width}}{t}")
        return "\n".join(lines)

    def cmd_about(self, args, stdin):
        return ("GeoOS 0.3.1 (Geode) — a hobby OS layer written from scratch.\n"
                "Includes geosh (unified shell), the geoVariable binary\n"
                "scripting language, a sandbox VM, and a web desktop.\n"
                "Nothing here touches your real files outside ~/.geovos.")

    # ------------------------------------------------------- geoVariable
    def cmd_run(self, args, stdin):
        if not args:
            raise ShellError("run: usage: run <script.gv|program.gvb>")
        path = args[0]
        max_steps = 1_000_000
        if "--max-steps" in args:
            i = args.index("--max-steps")
            max_steps = int(args[i + 1])
        if path.endswith(".gvb"):
            data = self.vfs.read_bytes(path, self.cwd)
            out, steps = run_binary(data, max_steps=max_steps)
        else:
            src = self.vfs.read(path, self.cwd)
            binary = compile_source(src)
            from .geovariable import run_binary as _rb
            out, steps = _rb(binary, max_steps=max_steps)
        tail = f"\n[gevm] finished in {steps} instructions (sandboxed)"
        return (out + tail) if out else tail.strip()

    def cmd_gvc(self, args, stdin):
        """gvc <source.gv> [-o out.gvb] — compile to binary."""
        paths = [a for a in args if not a.startswith("-")]
        if not paths:
            raise ShellError("gvc: usage: gvc <source.gv> [-o out.gvb]")
        src_path = paths[0]
        if "-o" in args:
            out_path = args[args.index("-o") + 1]
        else:
            out_path = src_path.rsplit(".", 1)[0] + ".gvb"
        src = self.vfs.read(src_path, self.cwd)
        binary = compile_source(src)
        virt = self.vfs.write(out_path, binary, self.cwd)
        consts, fns, code = gvfmt.unpack(binary)
        return (f"compiled {src_path} -> {virt}\n"
                f"  size:      {len(binary)} bytes\n"
                f"  constants: {len(consts)}\n"
                f"  functions: {len(fns)}\n"
                f"  bytecode:  {len(code)} bytes\n"
                f"  flags:     sandboxed")

    def cmd_hexdump(self, args, stdin):
        if not args:
            raise ShellError("hexdump: usage: hexdump <file>")
        data = self.vfs.read_bytes(args[0], self.cwd)
        lines = []
        for off in range(0, min(len(data), 512), 16):
            chunk = data[off:off + 16]
            hexs = " ".join(f"{b:02x}" for b in chunk)
            text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
            lines.append(f"{off:08x}  {hexs:<48}  |{text}|")
        if len(data) > 512:
            lines.append(f"... ({len(data) - 512} more bytes)")
        return "\n".join(lines)

    # ------------------------------------------------------- packages
    def cmd_pkg(self, args, stdin):
        if not args:
            raise ShellError("pkg: usage: pkg list|install <name>|remove <name>|info")
        sub = args[0]
        installed = self.vfs.installed_pkgs()
        if sub == "list":
            lines = [f"{'NAME':<12} {'VER':<6} {'STATE':<11} DESCRIPTION"]
            for name, meta in PACKAGES.items():
                state = f"installed" if name in installed else "available"
                lines.append(f"{name:<12} {meta['version']:<6} {state:<11} {meta['desc']}")
            return "\n".join(lines)
        if sub == "install":
            if len(args) < 2:
                raise ShellError("pkg install: missing package name")
            name = args[1]
            if name not in PACKAGES:
                raise ShellError(f"pkg: no such package {name!r}")
            if name in installed:
                return f"{name} is already installed"
            installed[name] = PACKAGES[name]["version"]
            self.vfs.save_pkgs(installed)
            if name == "hello-gv":
                from .vfs import EXAMPLES
                self.vfs.write("/examples/hello.gv", EXAMPLES["hello.gv"])
            return (f"resolved {name} {PACKAGES[name]['version']}\n"
                    f"downloading... done (0.0s, it's virtual)\n"
                    f"installed {name}. run it with: {name}")
        if sub == "remove":
            if len(args) < 2:
                raise ShellError("pkg remove: missing package name")
            name = args[1]
            if name not in installed:
                raise ShellError(f"pkg: {name!r} is not installed")
            del installed[name]
            self.vfs.save_pkgs(installed)
            return f"removed {name}"
        if sub == "info":
            return f"geopkg 0.2 — {len(PACKAGES)} packages in repo, {len(installed)} installed"
        raise ShellError(f"pkg: unknown subcommand {sub!r}")

    def _cowsay(self, text):
        if len(text) > 40:
            text = text[:37] + "..."
        top = " " + "_" * (len(text) + 2)
        bot = " " + "-" * (len(text) + 2)
        return (f"{top}\n< {text} >\n{bot}\n"
                "        \\   ^__^\n"
                "         \\  (oo)\\_______\n"
                "            (__)\\       )\\/\\\n"
                "                ||----w |\n"
                "                ||     ||")

    def cmd_edit(self, args, stdin):
        return ("edit: use the Files or GeoVariable Studio tabs in the desktop, "
                "or: write <file> <text>  /  echo hi > file.txt")

    def cmd_open(self, args, stdin):
        if not args:
            raise ShellError("open: usage: open <file>")
        return self.vfs.read(args[0], self.cwd)

    def cmd_help(self, args, stdin):
        rows = [
            ("FILES", "ls (-l -a), cd, pwd, cat, touch, mkdir, rm, cp, mv, find, grep, head, tail, wc, write, append, open"),
            ("SYSTEM", "sysinfo, ps, kill, date, whoami, hostname, env, export, history, clear, geofetch, about, reset"),
            ("GEOVARIABLE", "run <x.gv|x.gvb>, gvc <x.gv> -o <x.gvb>, hexdump <file>"),
            ("PACKAGES", "pkg list, pkg install <name>, pkg remove <name>, pkg info"),
            ("OPERATORS", "pipes: ls | grep txt   chains: cd /; ls   redirects: echo hi > a.txt, >> appends"),
            ("ALIASES", "dir/gci/Get-ChildItem, type/gc/Get-Content, del/Remove-Item, copy/Copy-Item, move/Move-Item, findstr/Select-String, tasklist/Get-Process, cls/Clear-Host, printenv, uname/systeminfo/sw_vers, ..."),
        ]
        width = max(len(r[0]) for r in rows)
        return "\n".join(f"{k:<{width}}  {v}" for k, v in rows)

    def cmd_exit(self, args, stdin):
        return "\x1bEXIT\x1b"

    def cmd_reset(self, args, stdin):
        """reset --yes — wipe the VFS back to factory state."""
        if "--yes" not in args:
            return ("reset: this wipes the GeoOS filesystem back to factory state.\n"
                    "run: reset --yes")
        import shutil as _sh
        root = self.vfs.root
        for child in root.iterdir():
            if child.is_dir():
                _sh.rmtree(child, ignore_errors=True)
            else:
                try:
                    child.unlink()
                except OSError:
                    pass
        self.vfs.seed()
        self.cwd = "/home/user"
        return "GeoOS filesystem reset to factory state."


# ------------------------------------------------------------------ tables
COMMANDS = {
    "ls": ShellSession.cmd_ls, "cd": ShellSession.cmd_cd,
    "pwd": ShellSession.cmd_pwd, "cat": ShellSession.cmd_cat,
    "touch": ShellSession.cmd_touch, "mkdir": ShellSession.cmd_mkdir,
    "rm": ShellSession.cmd_rm, "cp": ShellSession.cmd_cp,
    "mv": ShellSession.cmd_mv, "write": ShellSession.cmd_write,
    "append": ShellSession.cmd_append, "head": ShellSession.cmd_head,
    "tail": ShellSession.cmd_tail, "wc": ShellSession.cmd_wc,
    "find": ShellSession.cmd_find, "grep": ShellSession.cmd_grep,
    "echo": ShellSession.cmd_echo, "clear": ShellSession.cmd_clear,
    "date": ShellSession.cmd_date, "whoami": ShellSession.cmd_whoami,
    "hostname": ShellSession.cmd_hostname, "sysinfo": ShellSession.cmd_sysinfo,
    "ps": ShellSession.cmd_ps, "kill": ShellSession.cmd_kill,
    "env": ShellSession.cmd_env, "export": ShellSession.cmd_export,
    "history": ShellSession.cmd_history, "geofetch": ShellSession.cmd_geofetch,
    "about": ShellSession.cmd_about, "run": ShellSession.cmd_run,
    "gvc": ShellSession.cmd_gvc, "hexdump": ShellSession.cmd_hexdump,
    "pkg": ShellSession.cmd_pkg, "edit": ShellSession.cmd_edit,
    "open": ShellSession.cmd_open, "help": ShellSession.cmd_help,
    "reset": ShellSession.cmd_reset,
    "exit": ShellSession.cmd_exit,
}

ALIASES = {
    # PowerShell
    "Get-ChildItem": "ls", "gci": "ls", "dir": "ls",
    "Get-Content": "cat", "gc": "cat", "type": "cat",
    "Set-Location": "cd", "sl": "cd", "chdir": "cd",
    "Get-Location": "pwd", "gl": "pwd",
    "New-Item": "touch", "ni": "touch",
    "Remove-Item": "rm", "ri": "rm", "del": "rm", "erase": "rm", "rd": "rm",
    "Copy-Item": "cp", "ci": "cp", "copy": "cp",
    "Move-Item": "mv", "mi": "mv", "move": "mv", "ren": "mv",
    "Select-String": "grep", "sls": "grep", "findstr": "grep",
    "Get-Process": "ps", "gps": "ps", "tasklist": "ps",
    "Stop-Process": "kill", "taskkill": "kill",
    "Write-Output": "echo", "Write-Host": "echo",
    "Clear-Host": "clear", "cls": "clear",
    "Get-ComputerInfo": "sysinfo", "systeminfo": "sysinfo",
    "Set-Content": "write", "Add-Content": "append",
    "Get-History": "history",
    # macOS / BSD flavored
    "uname": "sysinfo", "sw_vers": "sysinfo", "printenv": "env",
    "set": "env",
    # misc
    "man": "help", "?": "help", "quit": "exit", "logout": "exit",
    "whereami": "pwd", "list": "ls", "show": "cat", "remove": "rm",
}
