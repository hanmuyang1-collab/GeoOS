# GeoOS

A hobby operating system built from scratch in pure Python (zero dependencies),
with its own **binary scripting language — geoVariable** — and a **unified shell**
that merges the best of Linux, PowerShell and macOS into one command set.

GeoOS runs sandboxed on top of your current OS (Windows / macOS / Linux).
Its virtual filesystem, processes and packages can never touch your real files
outside `~/.geovos`.

```
pip install geov-os        # installs everything (no other deps)
geov install               # set up GeoOS on this computer (+ app launcher icon)
geov deploy                # launch GeoOS as a real app window — not a CLI, not a tab
```

`geov deploy` opens the GeoOS desktop as its own **application window**
(native window via `pip install geov-os[app]` / pywebview; otherwise a
chromeless chromium `--app` window with its own profile; a plain browser tab
only as last resort). On Linux, `geov install` also registers a launcher
entry so GeoOS shows up in your applications menu. Your current OS stays one
window away, and the desktop has a dedicated **Host OS** window so you can
check what's underneath and switch back.

## The desktop

A real windowed environment, not tabs: draggable, resizable, minimizable
windows with a dock and desktop icons.

| app | what it does |
|---|---|
| **Terminal** | geosh — unified Linux + PowerShell + macOS shell (open as many as you like) |
| **GeoBrowse** | web browser **and** search engine: real results via the server, pages render live in-window through a sandboxed, SSRF-guarded proxy — links keep working inside the window |
| **Code Studio** | editor that creates **real local files**; runs `.gv` (sandboxed bytecode VM), `.py` (host Python), `.js` (Node), `.sh` (Bash) via the server |
| **Files** | browse, edit, rename, delete the VFS |
| **Monitor** | **live host telemetry** — real CPU %, memory, and the host process table from the kernel |
| **Paint** | draw and save PNGs straight into the VFS |
| **Calculator** | safe arithmetic (no `eval`) |
| **Settings** | accent color + wallpaper, persisted on the host at `~/.geovos/settings.json` |
| **Help & Docs** | built-in manual |
| **Host OS** | your real machine — the layer GeoOS floats above |

## What's inside

| piece | what it is |
|---|---|
| **geosh** | unified shell: one command set with Linux + PowerShell + macOS aliases, pipes `\|`, chains `;`, redirects `> >>` |
| **geoVariable** | brand-new scripting language that compiles to real **binary bytecode** (`.gvb`) and runs in a sandboxed VM |
| **VFS** | virtual filesystem rooted at `~/.geovos/vfs` — escape-proof |
| **geopkg** | tiny package manager (`pkg list`, `pkg install cowsay`) |
| **window manager** | pure-JS windowing: drag, resize, minimize, maximize, focus stacking, dock |
| **gevm** | the sandbox VM: instruction budget, stack cap, call-depth cap, zero host I/O |
| **runtime bridge** | server-side execution of Python / JavaScript / Bash with timeouts, capped output and a jailed working directory |
| **GeoBrowse proxy** | server-side web search (no API key) + SSRF-guarded page fetch with link rewriting, so the in-OS browser renders pages without X-Frame-Options blocks and stays navigable |

## geoVariable in 30 seconds

```javascript
// hello.gv
let name = "world"
print("hello " + name + "!")

for i in 1..5 {
    print("line", i)
}

fn square(x) { return x * x }
print("9^2 =", square(9))
```

Compile it to **binary** and run it in the sandbox:

```bash
geov compile hello.gv -o hello.gvb   # source -> GEVB binary bytecode
geov hexdump hello.gvb               # peek at the real bytes
geov run hello.gvb                   # execute in the sandbox VM
```

```
00000000  47 45 56 42 01 01 ...   |GEVB............|
```

See [docs/GEOVARIABLE.md](docs/GEOVARIABLE.md) for the full language and the
binary format specification (opcodes, constant pool, function table).

## The unified shell

You never have to remember which OS dialect you're in — everything works:

```bash
ls /                        # or: dir, gci, Get-ChildItem
cat /etc/os-release         # or: type, gc, Get-Content
cat /etc/os-release | grep NAME
echo hello > /tmp/a.txt     # redirects work
mkdir ~/proj; cd ~/proj     # chains work
Get-Process                 # or: ps, tasklist — same table
sysinfo                     # or: uname, systeminfo, sw_vers
geofetch                    # the obligatory fetch screen
pkg install cowsay          # the package manager
run /examples/fib.gv        # geoVariable, straight from the shell
gvc /examples/fib.gv -o fib.gvb && run fib.gvb
```

## CLI reference

```
geov install                 install GeoOS onto this computer (+ launcher entry)
geov deploy [--port 8000]    launch GeoOS as a full app window
geov shell                   interactive geosh terminal
geov run <file> [--max-steps N]   run .gv source or .gvb binary
geov compile <x.gv> [-o x.gvb]    compile to binary bytecode
geov hexdump <file>          inspect binary files
geov reset                   wipe and reinstall the virtual filesystem
geov info                    versions and paths
```

## Server API (what makes it an OS)

`geov deploy` starts a local server (`127.0.0.1` only) that the desktop apps
talk to:

```
GET  /api/ping                 health + version
GET  /api/host                 host machine info
GET  /api/sysinfo              live host CPU %, memory, uptime, process table
GET  /api/processes            top host processes by memory
GET  /api/runtimes             which language runtimes the host provides
GET  /api/search?q=            real web search (title, url, snippet)
GET  /browse?url=              sandboxed page proxy for GeoBrowse
                               (SSRF-guarded, <base>-rebased, same-origin)
GET  /api/settings             persisted desktop settings
POST /api/settings             update settings (merged + saved)
GET  /api/fs?path=             list a VFS directory
GET  /api/file?path=[&raw=1]   read a VFS file (text or base64)
POST /api/file                 write a VFS file (text or base64)
POST /api/fsop                 mkdir / rm / rename inside the VFS
POST /api/exec                 run a geosh command (session-scoped)
POST /api/compile              .gv source -> .gvb hex + stats
POST /api/run                  run .gv source or .gvb hex in the sandbox VM
POST /api/runcode              run python/javascript/bash/geovariable with
                               timeout, output caps and a jailed cwd
```

## Repo layout

```
geov/
  cli.py             installer + app launcher (desktop entry, app window)
  shell.py           geosh — the unified command set + aliases
  vfs.py             virtual filesystem (sandboxed)
  server.py          local OS server: telemetry, settings, multi-language
                     code execution, GeoBrowse web search + page proxy
  geovariable/
    compiler.py      .gv source -> .gvb binary (lexer, parser, codegen)
    vm.py            the sandbox VM
    format.py        the .gvb binary format
  web/               the windowed desktop (vanilla JS, no build step)
    app.js             core: API layer, settings, window manager, dock, Terminal
    apps-files-studio.js  Files + Code Studio apps
    apps-geobrowse.js  GeoBrowse — the in-OS web browser + search
    apps-misc.js       Monitor/Settings/Calc/Paint/Help/Host + app registry
    demo.js            demo mode for the static preview (no server)
docs/GEOVARIABLE.md  language + binary format spec
examples/            hello.gv, fizzbuzz.gv, fib.gv
```

## Honesty corner

GeoOS is a hobby/toy OS: it does not boot on bare metal. It's a real shell,
a real compiler, a real bytecode VM and a real sandbox — layered on top of
your current OS, which is exactly what makes it safe to hack on.

MIT licensed.
