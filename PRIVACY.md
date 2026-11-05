# Data Handling

WineGlass has no hosted capture service or product analytics endpoint.

It opens the supplied URL in two browser contexts and reads rendered pixels,
browser and platform details, font observations and uncaught page errors.
The output contains screenshots, HTML, differences and metadata. Final URLs
can retain query strings. Screenshots contain visible page content.

Wine logs, its prefix and browser profiles remain under `.runtime/`. Reports
and runtime files stay under user control; there is no automatic retention
cleanup. `.runtime/` and `captures/` are ignored by Git, but an explicit output
directory elsewhere is not automatically protected by that rule.

Installation contacts package registries and runtime download providers. The
page can fetch remote assets, redirect and call external services. Browser
binaries can have network behavior despite flags reducing background requests.
Comparison artifacts are not uploaded to a WineGlass service.

`--open` hands the local report to the system's selected application. Sharing,
committing or attaching a report is a separate action. Remove private content,
credentials and identifying paths before publishing reproductions.
