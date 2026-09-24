# GeoOS

A hobby operating system built from scratch in pure Python (zero dependencies),
with its own **binary scripting language — geoVariable** — and a **unified shell**
that merges the best of Linux, PowerShell and macOS into one command set.

GeoOS runs sandboxed on top of your current OS (Windows / macOS / Linux).
Its virtual filesystem, processes and packages can never touch your real files
outside `~/.geovos`.

```
pip install geov-os        # installs everything (no other deps)
geov install               # set up GeoOS on this computer
geov deploy                # launch the full desktop as an app (browser tab)
```

`geov deploy` opens the GeoOS desktop in a new browser tab — your current OS
stays one tab away, and the desktop even has a dedicated **Host OS** tab so you
can check what's underneath and switch back.

## What's inside

| piece | what it is |
|---|---|
| **geosh** | unified shell: one command set with Linux + PowerShell + macOS aliases, pipes `\|`, chains `;`, redirects `> >>` |
| **geoVariable** | brand-new scripting language that compiles to real **binary bytecode** (`.gvb`) and runs in a sandboxed VM |
| **VFS** | virtual filesystem rooted at `~/.geovos/vfs` — escape-proof |
| **geopkg** | tiny package manager (`pkg list`, `pkg install cowsay`) |
| **desktop** | web desktop: Terminal, Files, GeoVariable Studio, Monitor, Host OS tabs |
| **gevm** | the sandbox VM: instruction budget, stack cap, call-depth cap, zero host I/O |

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
geov install                 install GeoOS onto this computer
geov deploy [--port 8000]    launch the desktop app (+ Host OS tab)
geov shell                   interactive geosh terminal
geov run <file> [--max-steps N]   run .gv source or .gvb binary
geov compile <x.gv> [-o x.gvb]    compile to binary bytecode
geov hexdump <file>          inspect binary files
geov reset                   wipe and reinstall the virtual filesystem
geov info                    versions and paths
```

## Repo layout

```
geov/
  cli.py             command line entry point
  shell.py           geosh — the unified command set + aliases
  vfs.py             virtual filesystem (sandboxed)
  server.py          local desktop server + API
  geovariable/
    compiler.py      .gv source -> .gvb binary (lexer, parser, codegen)
    vm.py            the sandbox VM
    format.py        the .gvb binary format
  web/               the desktop app (vanilla JS, no build step)
docs/GEOVARIABLE.md  language + binary format spec
examples/            hello.gv, fizzbuzz.gv, fib.gv
```

## Honesty corner

GeoOS is a hobby/toy OS: it does not boot on bare metal. It's a real shell,
a real compiler, a real bytecode VM and a real sandbox — layered on top of
your current OS, which is exactly what makes it safe to hack on.

MIT licensed.
