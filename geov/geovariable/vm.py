"""geoVariable sandbox VM — executes .gvb bytecode.

Sandbox guarantees:
  * instruction budget (default 1,000,000 steps)
  * value-stack cap (4096) and call-depth cap (256)
  * string growth cap (1 MiB per value)
  * no host filesystem / network / process access whatsoever
  * output is captured into a buffer; input comes only from the caller
"""
import struct
from . import format as F


class VMError(Exception):
    pass


DEFAULT_MAX_STEPS = 1_000_000
MAX_STACK = 4096
MAX_FRAMES = 256
MAX_STR = 1 << 20


def fmt(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return str(int(v))
        return repr(v)
    return str(v)


def truthy(v):
    if v is None or v is False:
        return False
    if v == 0 or v == "":
        return False
    return True


class VM:
    def __init__(self, consts, fns, code, max_steps=DEFAULT_MAX_STEPS,
                 input_fn=None):
        self.consts = consts
        self.fns = fns
        self.code = code
        self.max_steps = max_steps
        self.input_fn = input_fn or (lambda prompt="": "")
        self.output = []
        self.steps = 0

    # ------------------------------------------------------------------
    def run(self):
        code = self.code
        stack = []
        globals_ = [None] * 1024
        frames = []  # (ret_ip, base)
        ip = 0

        def push(v):
            if len(stack) >= MAX_STACK:
                raise VMError("stack overflow (sandbox limit)")
            stack.append(v)

        def pop():
            if not stack:
                raise VMError("stack underflow (corrupt bytecode)")
            return stack.pop()

        def const(idx):
            if idx >= len(self.consts):
                raise VMError("constant index out of range")
            return self.consts[idx]

        def base():
            if not frames:
                raise VMError("local access outside of a function")
            return frames[-1][1]

        def num2(opname):
            b, a = pop(), pop()
            if not isinstance(a, (int, float)) or isinstance(a, bool) \
               or not isinstance(b, (int, float)) or isinstance(b, bool):
                raise VMError(f"{opname} needs two numbers, got "
                              f"{fmt(a)} and {fmt(b)}")
            return a, b

        while ip < len(code):
            self.steps += 1
            if self.steps > self.max_steps:
                raise VMError(f"instruction budget exceeded "
                              f"({self.max_steps} steps, sandbox halted)")
            op = code[ip]; ip += 1

            if op == F.OP["PUSH_CONST"]:
                idx = struct.unpack_from("<H", code, ip)[0]; ip += 2
                push(const(idx))
            elif op == F.OP["LOAD"]:
                slot = struct.unpack_from("<H", code, ip)[0]; ip += 2
                i = base() + slot
                if i >= len(stack):
                    push(None)
                else:
                    push(stack[i])
            elif op == F.OP["STORE"]:
                slot = struct.unpack_from("<H", code, ip)[0]; ip += 2
                i = base() + slot
                while len(stack) <= i:
                    stack.append(None)
                stack[i] = pop()
            elif op == F.OP["GLOAD"]:
                slot = struct.unpack_from("<H", code, ip)[0]; ip += 2
                if slot >= len(globals_):
                    raise VMError("global slot out of range")
                push(globals_[slot])
            elif op == F.OP["GSTORE"]:
                slot = struct.unpack_from("<H", code, ip)[0]; ip += 2
                if slot >= len(globals_):
                    raise VMError("global slot out of range")
                globals_[slot] = pop()
            elif op == F.OP["POP"]:
                pop()
            elif op == F.OP["ADD"]:
                b, a = pop(), pop()
                if isinstance(a, str) or isinstance(b, str):
                    s = fmt(a) + fmt(b)
                    if len(s) > MAX_STR:
                        raise VMError("string too large (sandbox limit)")
                    push(s)
                elif isinstance(a, (int, float)) and isinstance(b, (int, float)) \
                        and not isinstance(a, bool) and not isinstance(b, bool):
                    push(a + b)
                else:
                    raise VMError(f"cannot add {fmt(a)} and {fmt(b)}")
            elif op == F.OP["SUB"]:
                a, b = num2("subtraction"); push(a - b)
            elif op == F.OP["MUL"]:
                b, a = pop(), pop()
                if isinstance(a, str) and isinstance(b, (int, float)):
                    s = a * int(b)
                    if len(s) > MAX_STR:
                        raise VMError("string too large (sandbox limit)")
                    push(s)
                elif isinstance(a, (int, float)) and isinstance(b, (int, float)) \
                        and not isinstance(a, bool) and not isinstance(b, bool):
                    push(a * b)
                else:
                    raise VMError(f"cannot multiply {fmt(a)} and {fmt(b)}")
            elif op == F.OP["DIV"]:
                a, b = num2("division")
                if b == 0:
                    raise VMError("division by zero")
                push(a / b)
            elif op == F.OP["MOD"]:
                a, b = num2("modulo")
                if b == 0:
                    raise VMError("modulo by zero")
                push(a % b)
            elif op == F.OP["NEG"]:
                v = pop()
                if not isinstance(v, (int, float)) or isinstance(v, bool):
                    raise VMError("cannot negate non-number")
                push(-v)
            elif op == F.OP["EQ"]:
                b, a = pop(), pop(); push(a == b)
            elif op == F.OP["NEQ"]:
                b, a = pop(), pop(); push(a != b)
            elif op in (F.OP["LT"], F.OP["LTE"], F.OP["GT"], F.OP["GTE"]):
                b, a = pop(), pop()
                if not ((isinstance(a, (int, float)) and not isinstance(a, bool)
                         and isinstance(b, (int, float)) and not isinstance(b, bool))
                        or (isinstance(a, str) and isinstance(b, str))):
                    raise VMError(f"cannot compare {fmt(a)} and {fmt(b)}")
                if op == F.OP["LT"]:
                    push(a < b)
                elif op == F.OP["LTE"]:
                    push(a <= b)
                elif op == F.OP["GT"]:
                    push(a > b)
                else:
                    push(a >= b)
            elif op == F.OP["NOT"]:
                push(not truthy(pop()))
            elif op == F.OP["AND"]:
                b, a = pop(), pop(); push(truthy(a) and truthy(b))
            elif op == F.OP["OR"]:
                b, a = pop(), pop(); push(truthy(a) or truthy(b))
            elif op == F.OP["JMP"]:
                ip = struct.unpack_from("<I", code, ip)[0]
            elif op == F.OP["JMP_IF_FALSE"]:
                target = struct.unpack_from("<I", code, ip)[0]; ip += 4
                if not truthy(pop()):
                    ip = target
            elif op == F.OP["CALL"]:
                fnidx = struct.unpack_from("<H", code, ip)[0]; ip += 2
                argc = code[ip]; ip += 1
                if fnidx >= len(self.fns):
                    raise VMError("function index out of range")
                fn = self.fns[fnidx]
                if argc != fn["params"]:
                    raise VMError(f"{fn['name']}() takes {fn['params']} "
                                  f"argument(s), got {argc}")
                if len(frames) >= MAX_FRAMES:
                    raise VMError("call depth exceeded (sandbox limit)")
                frames.append((ip, len(stack) - argc))
                ip = fn["addr"]
            elif op == F.OP["RET"]:
                ret = pop() if len(stack) > (frames[-1][1] if frames else 0) else None
                if not frames:
                    raise VMError("RET with no call frame")
                ip, b = frames.pop()
                del stack[b:]
                push(ret)
            elif op == F.OP["CALL_BUILTIN"]:
                name_idx = struct.unpack_from("<H", code, ip)[0]; ip += 2
                argc = code[ip]; ip += 1
                name = const(name_idx)
                args = [pop() for _ in range(argc)][::-1]
                push(self.call_builtin(name, args))
            elif op == F.OP["HALT"]:
                break
            else:
                raise VMError(f"unknown opcode 0x{op:02X} at {ip - 1}")
        return "\n".join(self.output)

    # ------------------------------------------------------------------
    def call_builtin(self, name, args):
        def arity(n):
            if len(args) != n:
                raise VMError(f"{name}() takes {n} argument(s), got {len(args)}")

        if name == "print":
            self.output.append(" ".join(fmt(a) for a in args))
            return None
        if name == "input":
            prompt = fmt(args[0]) if args else ""
            return str(self.input_fn(prompt))
        if name == "str":
            arity(1); return fmt(args[0])
        if name == "num":
            arity(1)
            try:
                return float(args[0])
            except (TypeError, ValueError):
                raise VMError(f"num() cannot convert {fmt(args[0])!r}")
        if name == "len":
            arity(1)
            if not isinstance(args[0], str):
                raise VMError("len() works on strings")
            return float(len(args[0]))
        if name == "upper":
            arity(1); return fmt(args[0]).upper()
        if name == "lower":
            arity(1); return fmt(args[0]).lower()
        if name == "abs":
            arity(1); return abs(float(args[0]))
        if name == "min":
            if not args:
                raise VMError("min() needs arguments")
            return min(float(a) for a in args)
        if name == "max":
            if not args:
                raise VMError("max() needs arguments")
            return max(float(a) for a in args)
        if name == "type":
            arity(1)
            v = args[0]
            t = ("null" if v is None else "bool" if isinstance(v, bool)
                 else "number" if isinstance(v, (int, float)) else "string")
            return t
        raise VMError(f"unknown builtin {name!r}")


def run_binary(data, max_steps=DEFAULT_MAX_STEPS, input_fn=None):
    """Validate + execute a .gvb blob in the sandbox. Returns output text."""
    consts, fns, code = F.unpack(data)
    vm = VM(consts, fns, code, max_steps=max_steps, input_fn=input_fn)
    out = vm.run()
    return out, vm.steps


def run_source(source, max_steps=DEFAULT_MAX_STEPS, input_fn=None):
    """Compile source in memory and run it. Returns (output, steps, binary)."""
    from .compiler import compile_source
    binary = compile_source(source)
    out, steps = run_binary(binary, max_steps=max_steps, input_fn=input_fn)
    return out, steps, binary
