# Roadmap

Version 0.1.0 is a source prototype. No npm publication or broad support
guarantee is claimed.

## Implemented

- Matching Chromium builds with a project-local Wine runtime.
- Interactive windows, viewport capture and environment metadata.
- A static comparison viewer and a narrow pointer-device compatibility shim.
- Current-page recapture in live mode with a separate folder for each report.
- Runtime ownership locks, cancellation cleanup and per-run Wine logs.
- Managed-runtime diagnostics, verified downloads and staged setup recovery.
- Automated regression tests for installation and failure handling.

## Next

1. Rehearse setup on a clean Apple Silicon Mac.
2. Collect Wine and real Windows reference captures using licensed fonts.
3. Expand failure coverage and verify recovery after forced process termination.
4. Exercise login and recapture on more public application fixtures.

After reference evidence exists, consider font configuration, extra capture
settings, session setup and other browser families. Measure improved Windows
fidelity before claiming it. No delivery dates are set.
