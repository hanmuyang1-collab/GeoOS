"""geoVariable binary format (.gvb) definition.

Layout (little-endian):

    offset  size  field
    0       4     magic "GEVB"
    4       1     version (1)
    5       1     flags (bit0 = sandboxed, always set)
    6       2     const_count (u16)
    8       ..    constants:
                    str : 0x00 u16 len + utf8 bytes
                    num : 0x01 f64
                    bool: 0x02 u8
                    null: 0x03
    ..      2     fn_count (u16)
    ..      ..    functions: u16 name_const_idx, u8 param_count, u32 addr
    ..      4     code_len (u32)
    ..      ..    bytecode

Opcodes
-------
0x01 PUSH_CONST u16      0x02 LOAD u16         0x03 STORE u16
0x04 POP                 0x05 GLOAD u16        0x06 GSTORE u16
0x10 ADD  0x11 SUB  0x12 MUL  0x13 DIV  0x14 MOD  0x15 NEG
0x20 EQ   0x21 NEQ  0x22 LT   0x23 LTE  0x24 GT   0x25 GTE
0x26 NOT  0x27 AND  0x28 OR
0x30 JMP u32  0x31 JMP_IF_FALSE u32
0x40 CALL u16 fnidx u8 argc
0x41 RET
0x42 CALL_BUILTIN u16 name_const_idx u8 argc
0xFF HALT
"""
import struct

MAGIC = b"GEVB"
VERSION = 1
FLAG_SANDBOXED = 0x01

# value type tags
T_STR, T_NUM, T_BOOL, T_NULL = 0, 1, 2, 3

OP = dict(
    PUSH_CONST=0x01, LOAD=0x02, STORE=0x03, POP=0x04, GLOAD=0x05, GSTORE=0x06,
    ADD=0x10, SUB=0x11, MUL=0x12, DIV=0x13, MOD=0x14, NEG=0x15,
    EQ=0x20, NEQ=0x21, LT=0x22, LTE=0x23, GT=0x24, GTE=0x25,
    NOT=0x26, AND=0x27, OR=0x28,
    JMP=0x30, JMP_IF_FALSE=0x31,
    CALL=0x40, RET=0x41, CALL_BUILTIN=0x42,
    HALT=0xFF,
)
OPNAME = {v: k for k, v in OP.items()}


class FormatError(Exception):
    """Raised when a .gvb blob is corrupt or not a geoVariable binary."""


def pack(consts, fns, code):
    """consts: list of (tag, payload); fns: list of (name_idx, param_count, addr)."""
    out = bytearray()
    out += MAGIC
    out += bytes([VERSION, FLAG_SANDBOXED])
    out += struct.pack("<H", len(consts))
    for tag, payload in consts:
        out.append(tag)
        if tag == T_STR:
            data = payload.encode("utf-8")
            if len(data) > 0xFFFF:
                raise FormatError("string constant too long")
            out += struct.pack("<H", len(data)) + data
        elif tag == T_NUM:
            out += struct.pack("<d", float(payload))
        elif tag == T_BOOL:
            out.append(1 if payload else 0)
        elif tag == T_NULL:
            pass
        else:
            raise FormatError(f"unknown const tag {tag}")
    out += struct.pack("<H", len(fns))
    for name_idx, param_count, addr in fns:
        out += struct.pack("<HBI", name_idx, param_count, addr)
    out += struct.pack("<I", len(code))
    out += bytes(code)
    return bytes(out)


def unpack(data):
    """Validate and decode a .gvb blob.

    Returns (consts, fns, code) where consts are plain Python values and
    fns are dicts {name, params, addr}.  Raises FormatError on anything
    unexpected so untrusted binaries can be loaded safely in the sandbox.
    """
    if len(data) < 8 or data[:4] != MAGIC:
        raise FormatError("not a geoVariable binary (bad magic)")
    version = data[4]
    if version != VERSION:
        raise FormatError(f"unsupported .gvb version {version}")

    pos = 6

    def need(n):
        if pos + n > len(data):
            raise FormatError("truncated binary")

    def u8():
        nonlocal pos
        need(1)
        v = data[pos]; pos += 1
        return v

    def u16():
        nonlocal pos
        need(2)
        v = struct.unpack_from("<H", data, pos)[0]; pos += 2
        return v

    def u32():
        nonlocal pos
        need(4)
        v = struct.unpack_from("<I", data, pos)[0]; pos += 4
        return v

    nconst = u16()
    consts = []
    for _ in range(nconst):
        tag = u8()
        if tag == T_STR:
            ln = u16()
            need(ln)
            consts.append(data[pos:pos + ln].decode("utf-8", "replace")); pos += ln
        elif tag == T_NUM:
            need(8)
            consts.append(struct.unpack_from("<d", data, pos)[0]); pos += 8
        elif tag == T_BOOL:
            consts.append(bool(u8()))
        elif tag == T_NULL:
            consts.append(None)
        else:
            raise FormatError(f"unknown const tag {tag}")

    nfn = u16()
    fns = []
    for _ in range(nfn):
        name_idx, param_count, addr = u16(), u8(), u32()
        if name_idx >= len(consts) or not isinstance(consts[name_idx], str):
            raise FormatError("function name index out of range")
        fns.append({"name": consts[name_idx], "params": param_count, "addr": addr})

    code_len = u32()
    need(code_len)
    code = bytes(data[pos:pos + code_len]); pos += code_len
    if pos != len(data):
        raise FormatError("trailing bytes after code section")
    for fn in fns:
        if fn["addr"] >= max(1, len(code)):
            raise FormatError(f"function {fn['name']} address out of range")
    return consts, fns, code
