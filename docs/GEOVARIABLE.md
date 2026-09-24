# geoVariable — language + binary format specification

geoVariable is GeoOS's native scripting language. Source files (`.gv`) compile
into a real binary bytecode format (`.gvb`) which executes inside a sandboxed
virtual machine (gevm). The format is original — it is not based on JVM,
CPython, WASM or any other bytecode.

## 1. Language reference

```javascript
# comments start with a hash

let x = 10                # declare a variable
set x = x + 1             # assign (creates the variable if missing)
x = x + 1                 # shorthand for set

let name = "geo"          # strings: "double" or 'single' quotes
print("hi " + name)       # print(...) joins args with spaces

# numbers, booleans, null
let pi = 3.14159
let ok = true             # true / false
let nothing = null        # only via fn return or default

# operators
#   + - * / %        arithmetic ("ab" + "cd" concatenates, "ab" * 3 repeats)
#   == != < <= > >=  comparison (numbers or strings)
#   and or not       logic
#   -x               negation

if x > 10 {
    print("big")
} elif x == 10 {
    print("ten")
} else {
    print("small")
}

while x < 20 {
    set x = x + 1
}

for i in 1..10 {          # inclusive range
    print(i)
}
for j in 10..0..-2 {      # optional step, may be negative
    print(j)
}

fn add(a, b) {            # functions are top-level only
    return a + b
}
print(add(2, 3))

break                     # exit a loop
continue                  # next iteration
```

### Builtins

| builtin | meaning |
|---|---|
| `print(a, b, ...)` | write a line to the console |
| `input(prompt?)` | read a line (empty inside the sandbox unless the host provides it) |
| `str(v)` | convert to string |
| `num(v)` | convert to number |
| `len(s)` | string length |
| `upper(s)` / `lower(s)` | case |
| `abs(x)` `min(...)` `max(...)` | math |
| `type(v)` | `"number"` `"string"` `"bool"` `"null"` |

### Semantics notes

* falsy values: `false`, `0`, `""`, `null`
* top-level variables are globals; functions may read and `set` them
* assignment inside a function to an unknown name creates a **local**
* recursion works (call depth capped at 256 frames)

## 2. Binary format (.gvb)

All integers little-endian.

```
offset  size    field
0       4       magic: "GEVB"
4       1       format version (1)
5       1       flags (bit0 = sandboxed; always set)
6       u16     constant count
..      ...     constants
..      u16     function count
..      ...     function table entries
..      u32     bytecode length
..      ...     bytecode
```

### Constant pool

| tag | type | payload |
|---|---|---|
| `0x00` | string | u16 length + UTF-8 bytes |
| `0x01` | number | f64 |
| `0x02` | bool | u8 (0/1) |
| `0x03` | null | — |

### Function table

Per entry: `u16 name_const_index`, `u8 param_count`, `u32 code_address`.

### Opcodes

```
0x01 PUSH_CONST u16        push constant
0x02 LOAD      u16         push local slot (relative to frame base)
0x03 STORE     u16         pop into local slot
0x04 POP                   discard top
0x05 GLOAD     u16         push global slot
0x06 GSTORE    u16         pop into global slot

0x10 ADD   0x11 SUB   0x12 MUL   0x13 DIV   0x14 MOD   0x15 NEG
0x20 EQ    0x21 NEQ   0x22 LT    0x23 LTE   0x24 GT    0x25 GTE
0x26 NOT   0x27 AND   0x28 OR

0x30 JMP          u32      unconditional jump (absolute byte offset)
0x31 JMP_IF_FALSE u32      pop; jump if falsy

0x40 CALL         u16 u8   call function[idx] with argc args
0x41 RET                   return top of stack to caller
0x42 CALL_BUILTIN u16 u8   call builtin named by const[idx] with argc args

0xFF HALT
```

### Execution model

* value stack (max 4096), call frames (max 256) with `base` pointing at the
  first argument; locals live at `stack[base + slot]`
* globals live in a separate table (1024 slots)
* `and` / `or` evaluate **both** sides (no short-circuit, by design)

## 3. Sandbox guarantees

Every `.gvb` executed by `geov run` or the desktop Studio is:

* **validated** — magic, version, section sizes and indexes are checked before
  a single instruction runs; corrupt binaries are rejected
* **budgeted** — default 1,000,000 instructions, then the VM halts
  (`--max-steps` to change it)
* **confined** — no host filesystem, network or process access; output is
  captured, `input()` returns empty unless the host wires a provider
* **bounded** — stack cap, call-depth cap, and a 1 MiB per-string growth cap
