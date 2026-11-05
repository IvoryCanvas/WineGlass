#!/usr/bin/env python3
"""Optional, reversible workaround for Wine 11.21's missing GetPointerDevice.

Requires pefile and an explicitly supplied Zig compiler. Only chrome.dll's
USER32 delay-import module name changes; all original functions are forwarded.
The untouched original is retained. No Wine or system DLL is replaced.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import pefile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('browser_dir', type=Path)
    parser.add_argument('--zig', required=True, type=Path)
    args = parser.parse_args()
    browser = args.browser_dir.resolve()
    target = browser / 'chrome.dll'
    original = browser / 'chrome.dll.wineglass-original'
    original_bytes = original.read_bytes() if original.exists() else target.read_bytes()
    pe = pefile.PE(data=original_bytes, fast_load=True)
    if pe.FILE_HEADER.Machine != 0x8664:
        raise RuntimeError('This workaround supports only x86-64 Chromium binaries.')
    pe.parse_data_directories(directories=[13])
    modules = [m for m in getattr(pe, 'DIRECTORY_ENTRY_DELAY_IMPORT', []) if m.dll.lower() == b'user32.dll']
    if len(modules) != 1:
        raise RuntimeError('Expected exactly one USER32 delay-import table; refusing to patch.')
    module = modules[0]
    if any(not item.name for item in module.imports):
        raise RuntimeError('Ordinal USER32 imports are not supported by this workaround.')
    functions = sorted({item.name.decode('ascii') for item in module.imports})
    if 'GetPointerDevice' not in functions:
        raise RuntimeError('This Chromium binary does not need the GetPointerDevice workaround.')
    if any(not name.replace('_', '').isalnum() for name in functions):
        raise RuntimeError('Unexpected export name; refusing to generate a definition file.')
    build = browser / 'wineglass-compat'
    build.mkdir(exist_ok=True)
    definition = build / 'WGUI32.def'
    definition.write_text('LIBRARY WGUI32\nEXPORTS\n' + '\n'.join(
        '  GetPointerDevice' if name == 'GetPointerDevice' else f'  {name}=USER32.{name}'
        for name in functions
    ) + '\n')
    source = Path(__file__).resolve().parent.parent / 'src' / 'pointer-compat.c'
    dll = browser / 'WGUI32.dll'
    subprocess.run([
        str(args.zig.resolve()), 'cc', '-target', 'x86_64-windows-gnu', '-shared',
        '-nostdlib', '-O2', '-Wl,--entry,DllMain', str(source), str(definition),
        '-lkernel32', '-o', str(dll)
    ], check=True)
    # Verify the compiled shim before changing the browser's import table.
    shim = pefile.PE(str(dll))
    exported = {item.name.decode('ascii'): item for item in shim.DIRECTORY_ENTRY_EXPORT.symbols if item.name}
    if set(functions) - set(exported):
        raise RuntimeError('The compiled shim is missing required exports.')
    for name in functions:
        expected = None if name == 'GetPointerDevice' else f'USER32.{name}'.encode('ascii')
        if exported[name].forwarder != expected:
            raise RuntimeError(f'Unexpected export forwarding for {name}.')
    offset = pe.get_offset_from_rva(module.struct.szName)
    patched = bytearray(original_bytes)
    if patched[offset:offset + 11].lower() != b'user32.dll\0':
        raise RuntimeError('Unexpected delay-import bytes; refusing to patch.')
    patched[offset:offset + 11] = b'WGUI32.dll\0'
    if not original.exists():
        original.write_bytes(original_bytes)
    target.write_bytes(patched)
    manifest = {
        'reason': 'Wine 11.21 does not export GetPointerDevice',
        'effect': 'GetPointerDevice returns FALSE with ERROR_CALL_NOT_IMPLEMENTED; pointer/pen validation is unsupported',
        'forwardedFunctions': len(functions) - 1,
        'originalSHA256': hashlib.sha256(original_bytes).hexdigest(),
        'patchedSHA256': hashlib.sha256(patched).hexdigest(),
        'changedByteCount': sum(a != b for a, b in zip(original_bytes, patched)),
        'restore': 'Replace chrome.dll with chrome.dll.wineglass-original; remove WGUI32.dll'
    }
    (browser / 'wineglass-compat.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
