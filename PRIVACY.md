# Data Handling

WineGlass has no hosted capture service or product analytics endpoint.

It opens the supplied URL in two browser contexts and reads rendered pixels,
browser and platform details, font observations and uncaught page errors.
The output contains screenshots, HTML, differences and metadata. Final URLs
can retain query strings. Screenshots contain visible page content. Live
recapture uses the current open pages, including login state and form values
entered during the run. It does not reload the pages or export their sessions
for later runs.

Wine logs use per-run files under `.runtime/logs/`, and the Wine prefix remains
under `.runtime/`. Each run uses a separate Windows browser profile under
`prefix/drive_c/wineglass-sessions/`; normal exit and handled cancellation remove
that run's profile. Forced termination can leave files behind, and profiles
from earlier versions are not automatically purged. Reports, logs and the
remaining runtime files stay under user control. Every successful capture
keeps its own report subfolder; taking another capture does not delete earlier
screenshots. `.runtime/` and `captures/` are ignored by Git, but an explicit
output directory elsewhere is not automatically protected by that rule.

Installation contacts package registries and runtime download providers. The
page can fetch remote assets, redirect and call external services. Browser
binaries can have network behavior despite flags reducing background requests.
Comparison artifacts are not uploaded to a WineGlass service.

`--open` hands the local report to the system's selected application. Sharing,
committing or attaching a report is a separate action. Remove private content,
credentials and identifying paths before publishing reproductions.
