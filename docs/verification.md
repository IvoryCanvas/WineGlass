# Verification Record

Recorded on 2026-11-05 on an Apple Silicon Mac, macOS 27.0.1.

| Check | Observation |
| --- | --- |
| Rosetta and Wine | Intel Wine started after Rosetta installation. |
| Wine archive | Version 11.21 matched the pinned SHA-256 digest. |
| Matched builds | Snapshot 1735907 reported Chromium 159.0.8144.0 on both platforms. |
| Headless demo | Two 1280 × 1100 PNGs at DPR 1, difference, HTML and JSON were saved. |
| Environment | Platform strings were `MacIntel` and `Win32`; both page-error lists were empty. |
| Viewer | Images loaded and the opacity slider changed the overlay. |
| Interactive mode | Both browser contexts stayed open; Enter closed the run. |
| Cleanup | No owned browser or Wine process remained after completed checks. |
| Repeated setup | An already prepared runtime was recognized successfully. |

Original demo captures differed by about 2.8% of pixels. That is an observation
about those captures, not Windows fidelity or a bug rate. Changes to the demo's
branding can also change its pixel count.

Wine used Tahoma for `system-ui` and Arial Unicode MS for Korean text. The shim
reports pointer-device lookup as unsupported.

## Open Gaps

- Complete installation on a clean second Mac.
- Paired real Windows captures with known fonts and DPI.
- Native dialogs, IME, screen readers, pen input and GPU rendering fidelity.
- Every failure branch described in the specification.
- Failure coverage beyond the automated cases and local smoke checks recorded
  for each change below.

Evidence uses the public demo, not a private application. Further verification
should record exact browser versions, fonts, runtime and capture settings.

## TypeScript Migration

On the same Mac, TypeScript 7.0.2 compiled the CLI, runtime modules and check
script with strict types, unchecked-index checking and exact optional
properties. `npm run check` passed compilation, Python syntax, documentation
links and example-metadata validation.

The compiled setup entry point reused the runtime at the project root. Both
headless and interactive compiled CLI runs produced the demo report. Enter
closed the interactive run. Actual metadata matched the output schema, both
browsers reported the same version, and the TypeScript-authored viewer slider
ran without page errors. Help, missing-URL and non-loopback-URL exits were also
checked. This adds no evidence about real Windows fidelity or fresh setup.


## Reliability And Live Recapture

Recorded on 2026-11-06 on the same Apple Silicon Mac. Node.js was 24.22.1,
Wine was 11.21, and both browser builds reported Chromium 159.0.8144.0.

| Check | Observation |
| --- | --- |
| Full local check | With both browser-test environment variables set, `npm run check` passed all 24 tests with no skips in about 45.4 seconds. |
| Default test scope | Without browser-test environment variables, 21 tests run and three browser integration tests are skipped. |
| Native capture failures | HTTP 503 and missing-readiness-selector timeout were rejected. |
| Native state and cancellation | Current DOM and local-storage changes survived recapture; aborted context and native startup were cleaned up. |
| Wine live recapture | After direct DOM, background-color and local-storage changes, `c` produced a new report with a different PNG and retained page state. |
| Runtime ownership | A second viewer command using the same runtime was rejected. |
| SIGINT | Live inspection exited 130, removed its lock, and `wineserver -w` confirmed Wine had stopped. |
| Startup SIGTERM | The command exited 143 without publishing partial output. |
| Runtime diagnostic | `doctor` passed with no issues, checking 11 selected files and reporting Node, Wine and native Chromium versions. |
| Setup reuse | Normal setup and `--repair` reused the healthy runtime without downloads. |
| Headless capture | A new 1280 × 1100 capture pair and complete report were published successfully. |

The headless pair differed by 2.83% of pixels. This remains an informational
observation, not an accuracy or defect score. One observed Wine startup took
about 40 seconds and completed within the 90-second startup deadline; that is
not a performance guarantee.

The optional native tests and Wine CLI test require a prepared local runtime;
see [contributing](../CONTRIBUTING.md) for the environment variables. The default
checks exercise installation, lock, report-publication and command failures
without starting a browser. These results do not establish real Windows
fidelity, a complete fresh installation on a second Mac, or every possible
failure path.
