"""geoVariable compiler: .gv source text -> .gvb binary bytecode.

The language is deliberately tiny and friendly:

    # comment
    let name = "world"           # declare
    set x = 5                    # assign (creates if missing)
    x = x + 1                    # same as set
    print("hello " + name)       # builtin
    if x > 3 { ... } elif x == 3 { ... } else { ... }
    while x < 10 { ... }
    for i in 1..10 { ... }       # inclusive range, optional ..step
    fn add(a, b) { return a + b }
    break / continue / true / false / null / and / or / not
"""
import struct
from . import format as F


class GeoError(Exception):
    pass


KEYWORDS = {"let", "set", "if", "elif", "else", "while", "for", "in", "fn",
            "return", "true", "false", "and", "or", "not", "break", "continue",
            "null"}


# ---------------------------------------------------------------- lexer
def lex(src):
    toks = []
    i, n, line = 0, len(src), 1
    while i < n:
        c = src[i]
        if c == "\n":
            line += 1; i += 1; continue
        if c in " \t\r":
            i += 1; continue
        if c == "#":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c in "\"'":
            q = c; j = i + 1; buf = []
            while j < n and src[j] != q:
                if src[j] == "\\" and j + 1 < n:
                    esc = src[j + 1]
                    buf.append({"n": "\n", "t": "\t", "r": "\r", "\\": "\\",
                                '"': '"', "'": "'"}.get(esc, esc))
                    j += 2
                else:
                    buf.append(src[j]); j += 1
            if j >= n:
                raise GeoError(f"line {line}: unterminated string")
            toks.append(("STR", "".join(buf), line)); i = j + 1; continue
        if c.isdigit():
            j = i
            while j < n and (src[j].isdigit() or
                             (src[j] == "." and j + 1 < n and src[j + 1].isdigit())):
                j += 1
            try:
                v = float(src[i:j])
            except ValueError:
                raise GeoError(f"line {line}: bad number {src[i:j]!r}")
            toks.append(("NUM", v, line)); i = j; continue
        if c.isalpha() or c == "_":
            j = i
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            w = src[i:j]
            toks.append(("KW", w, line) if w in KEYWORDS else ("IDENT", w, line))
            i = j; continue
        two = src[i:i + 2]
        if two in ("==", "!=", "<=", ">=", ".."):
            toks.append(("OP", two, line)); i += 2; continue
        if c in "+-*/%(){}<>,=":
            toks.append(("OP", c, line)); i += 1; continue
        raise GeoError(f"line {line}: unexpected character {c!r}")
    toks.append(("EOF", None, line))
    return toks


# ---------------------------------------------------------------- parser
class Parser:
    def __init__(self, toks):
        self.t = toks; self.i = 0

    def peek(self, k=0):
        return self.t[min(self.i + k, len(self.t) - 1)]

    def next(self):
        tok = self.t[self.i]; self.i += 1; return tok

    def expect(self, val):
        tok = self.next()
        if tok[1] != val:
            raise GeoError(f"line {tok[2]}: expected {val!r}, got {tok[1]!r}")

    def program(self):
        stmts = []
        while self.peek()[0] != "EOF":
            stmts.append(self.stmt())
        return ("block", stmts)

    def block(self):
        self.expect("{")
        stmts = []
        while self.peek()[1] != "}":
            if self.peek()[0] == "EOF":
                raise GeoError(f"line {self.peek()[2]}: missing '}}'")
            stmts.append(self.stmt())
        self.expect("}")
        return ("block", stmts)

    def stmt(self):
        tok = self.peek()
        if tok[0] == "KW":
            w = tok[1]
            if w == "let":
                self.next(); name = self.next()
                if name[0] != "IDENT":
                    raise GeoError(f"line {name[2]}: expected a name after let")
                self.expect("=")
                return ("let", name[1], self.expr())
            if w == "set":
                self.next(); name = self.next()
                if name[0] != "IDENT":
                    raise GeoError(f"line {name[2]}: expected a name after set")
                self.expect("=")
                return ("set", name[1], self.expr())
            if w == "if":
                return self.if_stmt()
            if w == "while":
                self.next(); cond = self.expr()
                return ("while", cond, self.block())
            if w == "for":
                return self.for_stmt()
            if w == "fn":
                return self.fn_stmt()
            if w == "return":
                self.next()
                if self.peek()[1] == "}":
                    return ("return", ("null",))
                return ("return", self.expr())
            if w == "break":
                self.next(); return ("break",)
            if w == "continue":
                self.next(); return ("continue",)
        if tok[0] == "IDENT" and self.peek(1)[1] == "=":
            self.next(); self.next()
            return ("set", tok[1], self.expr())
        return ("expr", self.expr())

    def if_stmt(self):
        self.expect("if")
        branches = [(self.expr(), self.block())]
        else_body = None
        while self.peek()[1] in ("elif", "else"):
            kw = self.next()[1]
            if kw == "elif":
                branches.append((self.expr(), self.block()))
            else:
                else_body = self.block()
        return ("if", branches, else_body)

    def for_stmt(self):
        self.expect("for")
        name = self.next()
        if name[0] != "IDENT":
            raise GeoError(f"line {name[2]}: expected a name after for")
        tok = self.next()
        if tok != ("KW", "in", tok[2]):
            raise GeoError(f"line {tok[2]}: expected 'in'")
        start = self.expr()
        self.expect("..")
        end = self.expr()
        step = ("num", 1.0)
        if self.peek()[1] == "..":
            self.next()
            step = self.expr()
        return ("for", name[1], start, end, step, self.block())

    def fn_stmt(self):
        self.expect("fn")
        name = self.next()
        if name[0] != "IDENT":
            raise GeoError(f"line {name[2]}: expected a name after fn")
        self.expect("(")
        params = []
        if self.peek()[1] != ")":
            while True:
                p = self.next()
                if p[0] != "IDENT":
                    raise GeoError(f"line {p[2]}: bad parameter name")
                params.append(p[1])
                if self.peek()[1] == ",":
                    self.next(); continue
                break
        self.expect(")")
        return ("fn", name[1], params, self.block())

    # ---------------- expressions (precedence climbing) ----------------
    def expr(self):
        return self.or_expr()

    def or_expr(self):
        left = self.and_expr()
        while self.peek()[1] == "or":
            self.next()
            left = ("bin", "or", left, self.and_expr())
        return left

    def and_expr(self):
        left = self.not_expr()
        while self.peek()[1] == "and":
            self.next()
            left = ("bin", "and", left, self.not_expr())
        return left

    def not_expr(self):
        if self.peek()[1] == "not":
            self.next()
            return ("un", "not", self.not_expr())
        return self.cmp_expr()

    def cmp_expr(self):
        left = self.add_expr()
        if self.peek()[1] in ("==", "!=", "<", "<=", ">", ">="):
            op = self.next()[1]
            left = ("bin", op, left, self.add_expr())
        return left

    def add_expr(self):
        left = self.mul_expr()
        while self.peek()[1] in ("+", "-"):
            op = self.next()[1]
            left = ("bin", op, left, self.mul_expr())
        return left

    def mul_expr(self):
        left = self.unary()
        while self.peek()[1] in ("*", "/", "%"):
            op = self.next()[1]
            left = ("bin", op, left, self.unary())
        return left

    def unary(self):
        if self.peek()[1] == "-":
            self.next()
            return ("un", "-", self.unary())
        return self.primary()

    def primary(self):
        tok = self.next()
        kind, val = tok[0], tok[1]
        if kind == "NUM":
            return ("num", val)
        if kind == "STR":
            return ("str", val)
        if tok == ("KW", "true", tok[2]):
            return ("bool", True)
        if tok == ("KW", "false", tok[2]):
            return ("bool", False)
        if tok == ("KW", "null", tok[2]):
            return ("null",)
        if val == "(":
            e = self.expr()
            self.expect(")")
            return e
        if kind == "IDENT":
            if self.peek()[1] == "(":
                self.next()
                args = []
                if self.peek()[1] != ")":
                    while True:
                        args.append(self.expr())
                        if self.peek()[1] == ",":
                            self.next(); continue
                        break
                self.expect(")")
                return ("call", val, args)
            return ("var", val)
        raise GeoError(f"line {tok[2]}: unexpected {val!r}")


# ---------------------------------------------------------------- codegen
BINOP = {"+": F.OP["ADD"], "-": F.OP["SUB"], "*": F.OP["MUL"], "/": F.OP["DIV"],
         "%": F.OP["MOD"], "==": F.OP["EQ"], "!=": F.OP["NEQ"], "<": F.OP["LT"],
         "<=": F.OP["LTE"], ">": F.OP["GT"], ">=": F.OP["GTE"],
         "and": F.OP["AND"], "or": F.OP["OR"]}

MAX_SLOTS = 4096


class Compiler:
    def __init__(self):
        self.consts = []          # list of (tag, payload)
        self.cmap = {}
        self.fns = []             # list of dicts name/params/addr
        self.fnmap = {}
        self.code = bytearray()
        self.globals = {}
        self.locals = None        # dict when compiling a function body
        self.loops = []           # {"breaks": [...], "continues": [...], "start": addr}
        self.hidden = 0

    # ---------- emit helpers ----------
    def const(self, value):
        if value is None:
            key = ("null", 0); tag = F.T_NULL; payload = None
        elif isinstance(value, bool):
            key = ("bool", value); tag = F.T_BOOL; payload = value
        elif isinstance(value, (int, float)):
            key = ("num", float(value)); tag = F.T_NUM; payload = float(value)
        else:
            key = ("str", value); tag = F.T_STR; payload = str(value)
        if key in self.cmap:
            return self.cmap[key]
        if len(self.consts) >= 0xFFFF:
            raise GeoError("too many constants")
        idx = len(self.consts)
        self.consts.append((tag, payload)); self.cmap[key] = idx
        return idx

    def op(self, opcode):
        self.code.append(opcode)

    def u16(self, v):
        self.code += struct.pack("<H", v)

    def u32(self, v):
        self.code += struct.pack("<I", v)

    def patch32(self, pos, target):
        self.code[pos:pos + 4] = struct.pack("<I", target)

    # ---------- scope ----------
    def declare(self, name):
        scope = self.locals if self.locals is not None else self.globals
        if name in scope:
            return scope[name]
        if len(scope) >= MAX_SLOTS:
            raise GeoError("too many variables")
        scope[name] = len(scope)
        return scope[name]

    def store(self, name):
        if self.locals is not None and name in self.locals:
            self.op(F.OP["STORE"]); self.u16(self.locals[name])
        elif name in self.globals:
            self.op(F.OP["GSTORE"]); self.u16(self.globals[name])
        else:
            self.store_new(name)

    def store_new(self, name):
        slot = self.declare(name)
        if self.locals is not None:
            self.op(F.OP["STORE"]); self.u16(slot)
        else:
            self.op(F.OP["GSTORE"]); self.u16(slot)

    def load(self, name, line=0):
        if self.locals is not None and name in self.locals:
            self.op(F.OP["LOAD"]); self.u16(self.locals[name]); return
        if name in self.globals:
            self.op(F.OP["GLOAD"]); self.u16(self.globals[name]); return
        raise GeoError(f"undefined variable {name!r}")

    # ---------- program ----------
    def compile(self, ast):
        # pass 1: register function signatures
        for st in ast[1]:
            if st[0] == "fn":
                _, name, params, _ = st
                if name in self.fnmap:
                    raise GeoError(f"duplicate function {name!r}")
                self.fnmap[name] = len(self.fns)
                self.fns.append({"name": name, "params": len(params), "ast": st})
        # pass 2: top-level code
        for st in ast[1]:
            if st[0] != "fn":
                self.gen(st)
        self.op(F.OP["HALT"])
        # pass 3: function bodies
        for fn in self.fns:
            fn["addr"] = len(self.code)
            _, name, params, body = fn["ast"]
            self.locals = {p: i for i, p in enumerate(params)}
            self.gen(body)
            self.op(F.OP["PUSH_CONST"]); self.u16(self.const(None))
            self.op(F.OP["RET"])
            self.locals = None
        fn_table = [(self.const(fn["name"]), fn["params"], fn["addr"])
                    for fn in self.fns]
        return F.pack(self.consts, fn_table, bytes(self.code))

    # ---------- statements ----------
    def gen(self, st):
        kind = st[0]
        if kind == "block":
            for s in st[1]:
                self.gen(s)
        elif kind in ("let", "set"):
            _, name, e = st
            self.gen_expr(e)
            if kind == "let":
                self.declare(name)
            self.store(name)
        elif kind == "expr":
            self.gen_expr(st[1])
            self.op(F.OP["POP"])
        elif kind == "if":
            _, branches, else_body = st
            end_jumps = []
            for cond, body in branches:
                self.gen_expr(cond)
                self.op(F.OP["JMP_IF_FALSE"])
                jf = len(self.code); self.u32(0)
                self.gen(body)
                self.op(F.OP["JMP"])
                end_jumps.append(len(self.code)); self.u32(0)
                self.patch32(jf, len(self.code))
            if else_body is not None:
                self.gen(else_body)
            for pos in end_jumps:
                self.patch32(pos, len(self.code))
        elif kind == "while":
            _, cond, body = st
            start = len(self.code)
            self.gen_expr(cond)
            self.op(F.OP["JMP_IF_FALSE"])
            jf = len(self.code); self.u32(0)
            self.loops.append({"breaks": [], "continues": [], "start": start})
            self.gen(body)
            self.op(F.OP["JMP"]); self.u32(start)
            end = len(self.code)
            self.patch32(jf, end)
            loop = self.loops.pop()
            for b in loop["breaks"]:
                self.patch32(b, end)
            for c in loop["continues"]:
                self.patch32(c, start)
        elif kind == "for":
            _, name, start_e, end_e, step_e, body = st
            self.hidden += 1
            end_v, step_v = f"~end{self.hidden}", f"~step{self.hidden}"
            self.gen_expr(start_e)
            self.declare(name); self.store(name)
            self.gen_expr(end_e)
            self.declare(end_v); self.store(end_v)
            self.gen_expr(step_e)
            self.declare(step_v); self.store(step_v)
            # condition: (step > 0 and var <= end) or (step < 0 and var >= end)
            cond_ast = ("bin", "or",
                        ("bin", "and", ("bin", ">", ("var", step_v), ("num", 0.0)),
                         ("bin", "<=", ("var", name), ("var", end_v))),
                        ("bin", "and", ("bin", "<", ("var", step_v), ("num", 0.0)),
                         ("bin", ">=", ("var", name), ("var", end_v))))
            start = len(self.code)
            self.gen_expr(cond_ast)
            self.op(F.OP["JMP_IF_FALSE"])
            jf = len(self.code); self.u32(0)
            loop = {"breaks": [], "continues": [], "start": start}
            self.loops.append(loop)
            self.gen(body)
            inc = len(self.code)
            # var = var + step
            self.gen_expr(("bin", "+", ("var", name), ("var", step_v)))
            self.store(name)
            self.op(F.OP["JMP"]); self.u32(start)
            end = len(self.code)
            self.patch32(jf, end)
            loop = self.loops.pop()
            for b in loop["breaks"]:
                self.patch32(b, end)
            for c in loop["continues"]:
                self.patch32(c, inc)
        elif kind == "fn":
            raise GeoError("fn declarations are only allowed at the top level")
        elif kind == "return":
            if self.locals is None:
                raise GeoError("return outside of a function")
            self.gen_expr(st[1])
            self.op(F.OP["RET"])
        elif kind == "break":
            if not self.loops:
                raise GeoError("break outside of a loop")
            self.op(F.OP["JMP"])
            self.loops[-1]["breaks"].append(len(self.code)); self.u32(0)
        elif kind == "continue":
            if not self.loops:
                raise GeoError("continue outside of a loop")
            self.op(F.OP["JMP"])
            self.loops[-1]["continues"].append(len(self.code)); self.u32(0)
        else:
            raise GeoError(f"unknown statement {kind}")

    # ---------- expressions ----------
    def gen_expr(self, e):
        kind = e[0]
        if kind == "num":
            self.op(F.OP["PUSH_CONST"]); self.u16(self.const(e[1]))
        elif kind == "str":
            self.op(F.OP["PUSH_CONST"]); self.u16(self.const(e[1]))
        elif kind == "bool":
            self.op(F.OP["PUSH_CONST"]); self.u16(self.const(e[1]))
        elif kind == "null":
            self.op(F.OP["PUSH_CONST"]); self.u16(self.const(None))
        elif kind == "var":
            self.load(e[1])
        elif kind == "bin":
            _, op, l, r = e
            self.gen_expr(l); self.gen_expr(r)
            self.op(BINOP[op])
        elif kind == "un":
            _, op, x = e
            self.gen_expr(x)
            self.op(F.OP["NEG"] if op == "-" else F.OP["NOT"])
        elif kind == "call":
            _, name, args = e
            if len(args) > 255:
                raise GeoError("too many call arguments")
            for a in args:
                self.gen_expr(a)
            if name in self.fnmap:
                self.op(F.OP["CALL"]); self.u16(self.fnmap[name]); self.op(len(args))
            else:
                self.op(F.OP["CALL_BUILTIN"])
                self.u16(self.const(name)); self.op(len(args))
        else:
            raise GeoError(f"unknown expression {kind}")


def compile_source(source):
    """Compile .gv source text into .gvb binary bytes."""
    ast = Parser(lex(source)).program()
    return Compiler().compile(ast)
