# First Run

Use an Apple Silicon Mac with Node.js 22+, Python 3/pip and Rosetta. The source
setup also needs command-line build tools for the compatibility shim.

```sh
npm ci
npm run setup:wine
npm run demo -- --height 1100 --open
```

Setup pins Wine 11.21 and Chromium snapshot 1735907. Wine and Zig archives are
checked against pinned SHA-256 digests. Browser files come from Google's
Chromium storage. pefile is installed under `.runtime/` to inspect PE files.
The setup does not install Rosetta or write apps into `/Applications`.

The demo command starts a temporary loopback server, opens it in both browsers,
stores the report, and stops the server. Review the default controls, text
wrapping and inner scrollbars. Read the font observations before interpreting
any difference as Windows behavior.

## Your Development Server

Start your application in a separate terminal. Then run:

```sh
node bin/wineglass.mjs http://localhost:3000/settings --live
```

Press Enter to close both windows. Existing browser cookies are not imported.
Clicks, form values and later screenshots are not synchronized.

To capture after an application-specific readiness signal:

```sh
node bin/wineglass.mjs http://localhost:3000/settings \
  --selector '[data-ready="true"]' --delay 1000 \
  --out captures/settings --open
```

Choose a selector your page actually renders, or omit it. `--delay` adds a
bounded settling period after page load and font readiness. See
[commands](commands.md) for defaults and failure behavior.
