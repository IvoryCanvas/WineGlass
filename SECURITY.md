# Security Policy

Report suspected vulnerabilities privately to IvoryCanvas maintainers. Use
GitHub private vulnerability reporting if available; otherwise contact a
maintainer before publishing sensitive details.

Wine Chromium runs with `--no-sandbox`. Use trusted local development pages.
The initial loopback-URL check is not a network firewall: redirects, scripts
and resources can make external requests. The loopback DevTools endpoint
permits browser control and should never be exposed publicly.

Security-sensitive areas include runtime downloads and overrides, PE import
changes, DevTools connections, process cleanup, HTML escaping and report paths.
Reports and logs can contain credentials or private application content.

Setup and viewer commands acquire an exclusive runtime lock. Its prefix
belongs to WineGlass and cleanup can stop all Wine processes in it. Do not
share the prefix with unrelated apps. Diagnostics verify selected managed
files; they do not attest every runtime file or make custom binaries trusted.
This prototype is not a secure browsing environment.
