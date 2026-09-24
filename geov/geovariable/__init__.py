"""geoVariable — a tiny binary scripting language for GeoOS.

Usage:
    from geov.geovariable import compile_source, run_binary, run_source
"""
from .compiler import compile_source, GeoError
from .vm import VM, VMError, run_binary, run_source, fmt
from .format import pack, unpack, FormatError, MAGIC, VERSION, OP, OPNAME

__all__ = ["compile_source", "run_binary", "run_source", "VM",
           "GeoError", "VMError", "FormatError", "pack", "unpack",
           "MAGIC", "VERSION", "OP", "OPNAME", "fmt"]
