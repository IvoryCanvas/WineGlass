# Command Reference

Build the TypeScript source before invoking a compiled entry point directly:

```sh
npm run build
node dist/bin/wineglass.js <url> [options]
node dist/bin/wineglass.js --demo [options]
```

`npm run typecheck` checks the source without emitting files. `npm run check`
builds with strict types, then checks Python syntax, documentation links and
the example output contract. `npm run demo` and `npm run setup:wine` build
automatically. Build output is ignored by Git.

| Option | Default | Behavior |
| --- | --- | --- |
| `--demo` | Off | Serve the bundled local example instead of a positional URL. |
| `--out <directory>` | `captures` | Output path relative to the current working directory. |
| `--width <pixels>` | `1280` | Integer CSS viewport width, 320–4096. |
| `--height <pixels>` | `900` | Integer CSS viewport height, 320–4096. |
| `--selector <css>` | Unset | Wait for the first matching element to be visible. |
| `--delay <ms>` | `500` | Additional wait after load and fonts, 0–30000 ms. |
| `--live` | Off | Keep both windows open until Enter. |
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

`npm run setup:wine` downloads the pinned runtime. It reuses existing files and
builds the shim when its manifest is absent. It is not an updater or a full
integrity audit of reused files.

| Variable | Meaning |
| --- | --- |
| `WINE_BIN` | Wine executable override. |
| `WINDOWS_CHROMIUM` | Windows browser executable override. |
| `WINEGLASS_WINE_DEBUG` | Wine log settings; default `-all,err+all`. |

Overrides can break the matched-version assumption. Actual versions are saved
in metadata; alternative distributions are outside the tested support matrix.

## Failures

Successful capture exits 0. Input, startup or capture failures exit 1. Parser
errors may occur before the normal diagnostic handler. A nonzero pixel
difference alone does not fail the command.

Wine startup waits up to 90 seconds for DevTools. Page and selector waits use
30-second defaults. Wine diagnostics go to the runtime's `wine.log`. Failed
runs may leave partial output; use the exit status to distinguish a successful
new result from an old report.

Only one command should use a runtime at a time. Its prefix belongs to this
tool: cleanup stops Wine processes in that prefix. See [security](../SECURITY.md).
