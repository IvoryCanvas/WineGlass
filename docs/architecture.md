# Architecture

The CLI coordinates two local browser processes and writes a static report.

```text
loopback URL or bundled demo
  -> Windows Chromium + Wine -> screenshot + environment
  -> macOS Chromium         -> screenshot + environment
  -> pixel comparison
  -> PNG files + metadata.json + index.html
```

| File | Responsibility |
| --- | --- |
| `bin/wineglass.ts` | Input validation, capture orchestration and cleanup. |
| `bin/setup-wine.ts` | Pinned runtime setup and repair orchestration. |
| `src/runtime.ts` | Runtime pins and managed-file integrity inspection. |
| `src/install.ts` | Verified downloads and staged component installation. |
| `src/doctor.ts` | Prerequisite, version and runtime diagnostics. |
| `src/lifecycle.ts` | Exclusive runtime ownership and signal-driven cancellation. |
| `bin/pointer-compat.py` | PE inspection, shim verification and reversible import change. |
| `src/capture.ts` | Browser startup, CDP connection, screenshots and font observations. |
| `src/report.ts` | Pixel comparison, escaped HTML and metadata output. |
| `src/output.ts` | Stage and publish each complete capture as a new report folder. |
| `src/live.ts` | Terminal commands for recapture and closing live inspection. |
| `src/cleanup.ts` | Bound cleanup waits for browser resources. |
| `src/demo.ts` | Temporary loopback server with an invented example page. |
| `src/types.ts` | Browser-session, capture-option and output-data contracts. |
| `src/paths.ts` | Resolve the project root from the compiled module location. |
| `scripts/check.ts` | Python syntax, documentation and output-schema validation. |
| `tests/` | Automated failure and regression cases, with optional browser integration checks. |

## TypeScript Build

`tsconfig.json` uses NodeNext ESM resolution, strict checking, unchecked-index
checking and exact optional properties. `npm run build` compiles Node entry
points, runtime modules, tests and repository checks into `dist/`. Only TypeScript
source is committed; compiled JavaScript and source maps are ignored.

The compiled entry points resolve `.runtime/` from the project root. The
Python helper and its C source remain under `bin/` and `src/` respectively.
Browser-side demo and viewer functions are also written and checked as
TypeScript; their compiled function bodies are embedded into generated HTML.

Playwright launches macOS Chromium directly and attaches to Windows Chromium
through its loopback DevTools endpoint. Separate contexts keep page state
independent. Capture is sequential. Default settings are DPR 1, `ko-KR`,
`Asia/Seoul`, light scheme and reduced motion.

## Runtime Ownership

Wine's prefix and browser binaries live under `.runtime/`. An exclusive lock
is held throughout setup or browser use; an overlapping command is rejected.
The lock records its owner and can be recovered after that process exits.
Cleanup stops the launched browsers and Wine processes belonging to this
prefix before releasing ownership. SIGINT and SIGTERM request cancellation
through the same cleanup path. Wine logs use a separate file per run under
`logs/`. Each browser run has its own Windows profile at
`C:\wineglass-sessions\<run-id>` inside the Wine prefix. Cleanup removes that
profile while retaining the prefix and logs. Forced termination can leave
files behind. Custom executable overrides are outside the tested support
matrix.

## Installation And Reports

Setup verifies pinned SHA-256 digests for Wine, both Chromium archives and Zig,
including reused downloads. Components are extracted into staging directories
and inspected before replacing their installed locations. Interrupted
replacement can be recovered on the next setup. The diagnostic inspects
critical managed files and versions; it does not hash the entire runtime or
launch Windows Chromium.

The initial capture navigates fresh contexts to the target page. In live mode,
recapture reads the same original tabs without navigation, so login and in-page
state survive during that run. Each browser remains independent. Reports are
written into staging and published to a new folder only when complete, keeping
previous captures intact.

## Pointer Device Compatibility

Wine 11.21 lacks `USER32.GetPointerDevice`, which the pinned Chromium requests
through a delay import. Unmodified startup fails resolving that export.

`WGUI32.dll` forwards the other 229 imported USER32 functions to Wine's USER32.
Its `GetPointerDevice` returns `FALSE` and sets `ERROR_CALL_NOT_IMPLEMENTED`.
It supplies no pointer data and implements no pen or touch support.

The setup changes the delay-import DLL name in the downloaded `chrome.dll`.
The untouched binary is preserved as `chrome.dll.wineglass-original`.
`wineglass-compat.json` records hashes, changed bytes and restoration steps.
The helper checks the exported functions before changing the browser. System
and Wine DLLs are not replaced.

## Rendering Boundary

Matching Chromium versions removes one source of variation. Wine still uses
its own Windows API implementations and available fonts. GPU acceleration is
disabled for its browser. There is no measured mapping from local pixel
differences to real Windows fidelity. Native dialogs, input methods and
accessibility services remain separate platform behaviors.
