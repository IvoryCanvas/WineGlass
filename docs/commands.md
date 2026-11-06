# Command Reference

Build the TypeScript source before invoking a compiled entry point directly:

```sh
npm run build
node dist/bin/wineglass.js <url> [options]
node dist/bin/wineglass.js --demo [options]
node dist/bin/wineglass.js doctor [--runtime <directory>]
```

`npm run typecheck` checks the source without emitting files. `npm run check`
builds with strict types, then checks Python syntax, documentation links, the
example output contract and automated regression tests. `npm test` builds and
runs the tests alone. `npm run demo` and `npm run setup:wine` build
automatically. Build output is ignored by Git.

| Option | Default | Behavior |
| --- | --- | --- |
| `--demo` | Off | Serve the bundled local example instead of a positional URL. |
| `--out <directory>` | `captures` | Parent output path relative to the current directory; each successful capture gets a new subfolder. |
| `--width <pixels>` | `1280` | Integer CSS viewport width, 320–4096. |
| `--height <pixels>` | `900` | Integer CSS viewport height, 320–4096. |
| `--selector <css>` | Unset | Wait for the first matching element to be visible. |
| `--delay <ms>` | `500` | Additional wait after load and fonts, 0–30000 ms. |
| `--live` | Off | Keep both windows open; `c` + Enter captures current pages, Enter or `q` + Enter closes. |
| `--headed` | Off | Show windows during capture, then close automatically. |
| `--open` | Off | Open the local HTML report with macOS `open`. |
| `--runtime <directory>` | Project `.runtime` | Use a prepared runtime folder. |
| `--mac-browser <file>` | Runtime Chromium | Override the macOS executable. |
| `--help` | Off | Print usage and exit. |

The initial URL must use HTTP or HTTPS and a hostname of `localhost`,
`127.0.0.1` or `[::1]`. This is an input check, not a firewall. Redirects and
subresources follow browser behavior.

Both contexts use DPR 1, `ko-KR`, `Asia/Seoul`, light scheme and reduced motion.
These settings are fixed in this version. Captures use the visible viewport.

## Setup And Overrides

`npm run setup:wine` installs the pinned runtime. Archives are checked against
pinned SHA-256 digests, including reused downloads. Components are prepared in
staging directories before replacing their installed paths. Setup checks
critical installed files, installs missing components, and requests `--repair`
before replacing damaged existing components. Setup and the viewer share a
runtime lock.

| Variable | Meaning |
| --- | --- |
| `WINE_BIN` | Wine executable override. |
| `WINDOWS_CHROMIUM` | Windows browser executable override. |
| `WINEGLASS_WINE_DEBUG` | Wine log settings; default `-all,err+all`. |

Overrides can break the matched-version assumption. Actual versions are saved
in metadata; alternative distributions are outside the tested support matrix.

## Failures

Successful capture exits 0. Input, startup or capture failures exit 1. Handled
SIGINT exits 130 and SIGTERM exits 143 after cleanup. A nonzero pixel difference
alone does not fail the command. In live mode, a failed recapture reports its
error and lets you retry without replacing previous reports.

Wine startup waits up to 90 seconds for DevTools. Page and selector waits use
30-second defaults. Wine diagnostics go to a per-run file under the runtime's
`logs/` folder; startup errors identify its path. A report folder is published
only after both captures and the report are complete. Failed attempts do not
replace earlier reports.

Ctrl+C and SIGTERM request cancellation and owned-process cleanup, including
during startup. Forced process termination cannot run cleanup. A later command
can recover a lock whose owner has exited.

Overlapping setup or viewer commands using the same runtime are rejected. Its
prefix belongs to this tool: cleanup stops Wine processes in that prefix. See
[security](../SECURITY.md).


## Live Recapture

`--live` saves an initial report and keeps both pages open. After login,
navigation or other interaction, type `c` and press Enter to save their current
viewports into a new report folder. The original two tabs are used; opening or
focusing another tab does not change which page is captured. Pages are not
reloaded; cookies and in-page
state remain available for this run. Each browser is controlled independently.
A recapture does not repeat initial navigation or synchronize the pages.

Press Enter or type `q` and Enter to close. Reports remain static: open the
newly printed path to inspect a later capture. Session import and export are
not provided.

## Diagnostics And Recovery

```sh
node dist/bin/wineglass.js doctor
node dist/bin/wineglass.js doctor --runtime /path/to/runtime
npm run setup:wine -- --repair
npm run setup:wine -- --runtime /path/to/runtime --repair
```

`doctor` reports platform, Node and Rosetta prerequisites, Wine and native
Chromium versions, and the pinned runtime's inspected files. It checks the
expected revision, critical binary hashes, required executable paths and
compatibility-shim metadata. Errors exit 1; warnings do not fail the command.
It does not launch Windows Chromium. A successful diagnostic does not
establish that every runtime file is intact or that Windows rendering is
accurate; it also does not replace a browser capture smoke test.

`--repair` repairs failed managed components using verified archives. Healthy
components and the Wine prefix are preserved. Setup uses the project
`.runtime/` unless `--runtime` supplies another directory.
It does not install Rosetta or update the dependency pins to newer versions.
Chromium digests are project-pinned hashes of archives fetched from the official
storage, not vendor-published signatures.
The diagnostic targets the managed runtime; custom executable overrides still
need independent verification.
