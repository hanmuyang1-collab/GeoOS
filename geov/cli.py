"""geov — the GeoOS command line.

    geov install            install GeoOS onto this computer (~/.geovos)
                            (registers GeoOS as a real app with launcher icon)
    geov deploy             launch the full GeoOS desktop as an app window
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
import subprocess
import sys
import threading
import time
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


def _install_app_entry():
    """Register GeoOS as a real application: icon + launcher entry, so it
    shows up in the applications menu like any other installed app."""
    try:
        icon_src = Path(__file__).parent / "web" / "assets" / "logo.png"
        if icon_src.is_file():
            shutil.copy(icon_src, HOME / "icon.png")
    except Exception:
        pass
    if platform.system() == "Linux":
        apps = Path.home() / ".local" / "share" / "applications"
        try:
            apps.mkdir(parents=True, exist_ok=True)
            (apps / "GeoOS.desktop").write_text(
                "[Desktop Entry]\n"
                "Name=GeoOS\n"
                "Comment=A hobby OS layer — geosh, geoVariable, windowed desktop\n"
                f"Exec={sys.executable} -m geov.cli deploy\n"
                f"Icon={HOME / 'icon.png'}\n"
                "Terminal=false\n"
                "Type=Application\n"
                "Categories=System;Utility;\n")
            print(f"  [ok] app launcher entry  {apps / 'GeoOS.desktop'}")
        except Exception as e:
            print(f"  [skip] launcher entry: {e}")


def cmd_install(args):
    print(banner())
    print(f"Installing GeoOS {__version__} ...")
    HOME.mkdir(parents=True, exist_ok=True)
    vfs = VFS(HOME / "vfs")
    fresh = vfs.seed()
    print(f"  [{'created' if fresh else 'verified'}] virtual filesystem  {HOME / 'vfs'}")
    print(f"  [ok] geosh shell, geopkg repo, geoVariable toolchain")
    print(f"  [ok] no external dependencies — pure Python stdlib")
    _install_app_entry()
    print()
    print("GeoOS is installed as an app. Next steps:")
    print(f"  {C_BOLD}geov deploy{C_RESET}   launch the GeoOS app (its own window, not a tab)")
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


def _find_chrome():
    """A chromium-family browser we can launch in chromeless --app mode."""
    for name in ("chromium", "chromium-browser", "google-chrome",
                 "google-chrome-stable", "brave-browser", "microsoft-edge",
                 "chrome"):
        p = shutil.which(name)
        if p:
            return p
    mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if Path(mac).exists():
        return mac
    return None


def _try_webview(url, server):
    """Native app window via pywebview (pip install geov-os[app]).
    Runs the OS server on a background thread; blocks until the window
    closes. Returns False if pywebview isn't installed."""
    try:
        import webview
    except ImportError:
        return False
    threading.Thread(target=server.serve_forever, daemon=True).start()
    webview.create_window("GeoOS", url, width=1320, height=840,
                          min_size=(900, 600))
    webview.start()
    server.shutdown()
    return True


def _try_chrome_app(url):
    """Chromeless app window via any chromium-family browser (--app mode),
    with its own profile so GeoOS feels like its own application."""
    exe = _find_chrome()
    if not exe:
        return None
    profile = HOME / "app-profile"
    profile.mkdir(parents=True, exist_ok=True)
    return subprocess.Popen(
        [exe, f"--app={url}", "--window-size=1320,840", "--class=GeoOS",
         f"--user-data-dir={profile}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _serve_loop(server, proc=None):
    """Run the OS server until the app window closes or Ctrl+C."""
    if proc is not None:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            while proc.poll() is None:
                time.sleep(0.4)
        except KeyboardInterrupt:
            proc.terminate()
        server.shutdown()
        print("GeoOS closed. bye.")
        return
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down GeoOS. bye.")
        server.shutdown()


def cmd_deploy(args):
    from .server import serve
    print(banner())
    server, port = serve(args.port)
    url = f"http://127.0.0.1:{port}"
    print(f"GeoOS {__version__} is launching as a full app.")
    print(f"  local:   {url}")
    print(f"  vfs:     {HOME / 'vfs'}")
    print(f"  close the GeoOS window (or Ctrl+C) to shut down.\n")
    if args.no_browser:
        _serve_loop(server)
        return
    if _try_webview(url, server):          # native window, blocks till closed
        return
    proc = _try_chrome_app(url)            # chromeless --app window
    if proc is None:
        print("  (no app-window runtime found — falling back to a browser tab)")
        webbrowser.open(url)
    _serve_loop(server, proc)


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
