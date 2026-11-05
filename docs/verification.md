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
- Concurrent use of one runtime and abrupt interruption during startup.

Evidence uses the public demo, not a private application. Further verification
should record exact browser versions, fonts, runtime and capture settings.
