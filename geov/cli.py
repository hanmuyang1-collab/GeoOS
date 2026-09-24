"""geov — the GeoOS command line.

    geov install            install GeoOS onto this computer (~/.geovos)
    geov deploy             launch the full GeoOS desktop as an app
    geov shell              open the geosh terminal
    geov run <file>         run a .gv source or .gvb binary (sandboxed)
    geov compile <x.gv>     compile geoVariable source to binary bytecode
    geov hexdump <file>     inspect a .gvb binary
    geov info               version info
    geov reset              wipe and reinstall the virtual filesystem
"""
import argparse
import os
import platform
import shutil
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .vfs import VFS
from . import geovariable as gv

HOME = Path.home() / ".geovos"

C_CYAN, C_DIM, C_BOLD, C_RESET = "\033[36m", "\033[2m", "\033[1m", "\033[0m"


def banner():
    return (f"{C_CYAN}{C_BOLD}  ____            ___  ____ \n"
            f" / ___| ___  ___ / _ \\/ ___|\n"
            f"| |  _ / _ \\/ _ \\ | | \\___ \\\n"
            f"| |_| |  __/ (_) | |_| |___) |\n"
            f" \\____|\\___|\\___/ \\___/____/ {C_RESET}"
            f"{C_DIM}v{__version__}{C_RESET}")


def cmd_install(args):
    print(banner())
    print(f"Installing GeoOS {__version__} ...")
    HOME.mkdir(parents=True, exist_ok=True)
    vfs = VFS(HOME / "vfs")
    fresh = vfs.seed()
    print(f"  [{'created' if fresh else 'verified'}] virtual filesystem  {HOME / 'vfs'}")
    print(f"  [ok] geosh shell, geopkg repo, geoVariable toolchain")
    print(f"  [ok] no external dependencies — pure Python stdlib")
    print()
    print("GeoOS is installed. Next steps:")
    print(f"  {C_BOLD}geov deploy{C_RESET}   launch the desktop app (opens a browser tab)")
    print(f"  {C_BOLD}geov shell{C_RESET}    use the unified terminal")
    print(f"  {C_BOLD}geov run /examples/hello.gv{C_RESET}")


def cmd_shell(args):
    from .shell import ShellSession
    vfs = VFS(HOME / "vfs"); vfs.seed()
    sess = ShellSession(vfs)
    print(banner())
    print("geosh — type 'help' for commands, 'exit' to leave.\n")
    while True:
        try:
            line = input(f"{C_CYAN}{sess.username}{C_RESET}@geov:"
                         f"{C_DIM}{sess.cwd}{C_RESET}$ ")
        except (EOFError, KeyboardInterrupt):
            print("\nbye")
            break
        out = sess.exec(line)
        if "\x1bEXIT\x1b" in out:
            print("bye")
            break
        if "\x1bCLEAR\x1b" in out:
            os.system("cls" if platform.system() == "Windows" else "clear")
            continue
        if out:
            print(out)


def _run_path(path, max_steps):
    p = Path(path)
    if not p.is_file():
        raise SystemExit(f"geov: no such file: {path}")
    if p.suffix == ".gvb":
        out, steps = gv.run_binary(p.read_bytes(), max_steps=max_steps)
    else:
        out, steps, _ = gv.run_source(p.read_text(), max_steps=max_steps)
    if out:
        print(out)
    print(f"{C_DIM}[gevm] {steps} instructions, sandboxed{C_RESET}")


def cmd_run(args):
    _run_path(args.file, args.max_steps)


def cmd_compile(args):
    src = Path(args.file).read_text()
    binary = gv.compile_source(src)
    out = Path(args.output or (str(args.file).rsplit(".", 1)[0] + ".gvb"))
    out.write_bytes(binary)
    print(f"compiled {args.file} -> {out} ({len(binary)} bytes, sandboxed)")


def cmd_hexdump(args):
    data = Path(args.file).read_bytes()
    for off in range(0, min(len(data), 1024), 16):
        chunk = data[off:off + 16]
        hexs = " ".join(f"{b:02x}" for b in chunk)
        text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        print(f"{off:08x}  {hexs:<48}  |{text}|")
    if len(data) > 1024:
        print(f"... ({len(data) - 1024} more bytes)")


def cmd_deploy(args):
    from .server import serve
    print(banner())
    server, port = serve(args.port)
    url = f"http://127.0.0.1:{port}"
    print(f"GeoOS desktop is running.")
    print(f"  local:   {url}")
    print(f"  vfs:     {HOME / 'vfs'}")
    print(f"  a tab with GeoOS is opening; your current OS stays one tab away.")
    print(f"  press Ctrl+C to shut down.\n")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down GeoOS. bye.")
        server.shutdown()


def cmd_info(args):
    print(banner())
    print(f"GeoOS {__version__}  |  python {platform.python_version()}  |  "
          f"host {platform.system()} {platform.machine()}")
    print(f"install dir: {HOME} ({'present' if HOME.exists() else 'not installed'})")


def cmd_reset(args):
    if HOME.exists():
        shutil.rmtree(HOME)
    cmd_install(args)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="geov",
                                     description="GeoOS — a hobby OS in Python")
    parser.add_argument("--version", action="version",
                        version=f"geov {__version__}")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("install", help="install GeoOS onto this computer")

    p = sub.add_parser("shell", help="open the geosh terminal")

    p = sub.add_parser("run", help="run a .gv/.gvb program in the sandbox")
    p.add_argument("file")
    p.add_argument("--max-steps", type=int, default=1_000_000)

    p = sub.add_parser("compile", help="compile .gv source to .gvb binary")
    p.add_argument("file")
    p.add_argument("-o", "--output")

    p = sub.add_parser("hexdump", help="inspect a binary file")
    p.add_argument("file")

    p = sub.add_parser("deploy", help="launch the GeoOS desktop app")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-browser", action="store_true")

    sub.add_parser("info", help="show version info")
    sub.add_parser("reset", help="wipe and reinstall the virtual filesystem")

    args = parser.parse_args(argv)
    fn = {"install": cmd_install, "shell": cmd_shell, "run": cmd_run,
          "compile": cmd_compile, "hexdump": cmd_hexdump, "deploy": cmd_deploy,
          "info": cmd_info, "reset": cmd_reset}.get(args.cmd)
    if fn is None:
        parser.print_help()
        return 1
    fn(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
