# Contributing

Start with a small public page showing a setup failure, incorrect capture,
missing environment evidence or an unusable report.

1. Search existing issues and pull requests.
2. Describe expected and actual behavior with a minimal reproduction.
3. Create a focused branch from `main`.
4. Gather evidence appropriate to the changed surface.
5. Open a pull request using the template.

Use invented data. Do not share private pages, credentials, personal paths or
customer screenshots. Security reports follow [SECURITY.md](SECURITY.md).

```sh
npm ci
npm run check
```

| Change | Relevant verification |
| --- | --- |
| Documentation | Links, actual commands and source terminology. |
| CLI or metadata | A focused success or failure case and output-contract validation. |
| Startup or capture | Affected demo modes, actual versions and cleanup observation. |
| Wine or shim | Import/export checks, preserved original and browser launch. |
| Runtime pins | Digests and a complete fresh setup rehearsal. |

`npm run check` checks strict TypeScript compilation, Python syntax, local documentation
links, example metadata and automated regression tests. `npm test` runs the
automated tests separately. By default, the three browser integration tests are
skipped, so no browser or Wine process is started. These checks do not measure
Windows fidelity. Keep failure cases for lock ownership, cancellation, staged install
recovery and report publication deterministic and independent of the local
runtime.

To include the optional browser checks on a prepared Apple Silicon Mac:

```sh
WINEGLASS_TEST_BROWSER="$PWD/.runtime/chromium-mac/chrome-mac/Chromium.app/Contents/MacOS/Chromium" \
WINEGLASS_TEST_RUNTIME="$PWD/.runtime" \
npm test
```

`WINEGLASS_TEST_BROWSER` enables native Chromium tests for HTTP errors,
readiness timeouts, retained page state and cancellation, including cancellation
during native startup. `WINEGLASS_TEST_RUNTIME`
enables the Wine CLI test for live recapture, overlapping-command rejection,
SIGINT and startup SIGTERM cleanup. It starts visible browser windows and
needs a working local graphical session. You can set either variable alone.
Run against a runtime not currently used by another command.

Use `npm run typecheck` for a check without build output, and `npm run build`
before running a compiled entry point directly. Keep runtime and repository
scripts in TypeScript. Python and C are reserved for the native compatibility
helper. Build output under `dist/` is not committed.

Use product-focused branches such as `fix/font-receipt`. Commit subjects use
lowercase Conventional Commits:

```text
fix: retain font observations in capture metadata
docs: explain the shared runtime boundary
```

Explain resulting behavior, evidence and untested cases. Update public flags,
output fields and documentation together. Screenshots alone do not establish
an OS compatibility contract.
