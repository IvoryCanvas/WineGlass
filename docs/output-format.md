# Output Contract

Every successful capture creates a new subfolder under `--out` (`captures/`
by default). The terminal prints the exact `index.html` path. Each report folder
contains `macos.png`, `wine-windows.png`, `difference.png`, `metadata.json` and
`index.html`. Keep these files together when sharing the viewer. PNGs contain
viewport pixels at DPR 1.

Report creation uses a temporary staging folder. Only a complete capture pair
and report are published. A failed attempt does not replace an earlier result.
Live recapture creates another independent report folder; previous reports
remain unchanged. A report is a saved snapshot and does not refresh itself
after later browser interactions.

The [JSON Schema](../schema/metadata.schema.json) describes version 0.1's output.
The [example receipt](../examples/metadata.json) comes from the bundled demo.
The schema is checked in repository validation, not at capture runtime.
The runtime TypeScript data structures are defined in
[src/types.ts](../src/types.ts).

| Field | Meaning |
| --- | --- |
| `capturedAt` | UTC ISO timestamp assigned when writing the report. |
| `target` | First captured page's URL, potentially including query strings. |
| `renderer` | Human-readable comparison environment. |
| `fidelity` | Statement that Wine output is not a real Windows verdict. |
| `changedPixels` | Pixelmatch's differing-pixel count. |
| `changedPercent` | Percentage of all pixels, rounded to two decimals. |
| `captures` | Native macOS first, Windows Chromium on Wine second. |

Each capture records `label`, `version`, `url`, `platform`, `userAgent`,
`viewport`, `scrollbarWidth`, `bodyFont`, `documentSize`, `platformFonts`,
`fontSampleLimit` and `pageErrors`.

`bodyFont` is a CSS declaration. `platformFonts` reports actual fonts observed
through CDP for at most 200 selected DOM nodes. Glyph counts can overlap across
queried nodes. This is a sample, not a whole-page census. Frames, shadow trees
and offscreen content are not covered comprehensively.

`scrollbarWidth` measures space reserved by the root page scrollbar, not every
inner scroller. `pageErrors` contains uncaught JavaScript errors. An empty list
does not establish that network, console or usability errors are absent.

Pixelmatch uses threshold 0.1 and requires equally sized images. Different
content, timing, fonts, rasterization or layout can all contribute. Do not turn
a low percentage into a Windows accuracy claim. Update the schema, example
and release notes together when changing fields before 1.0.


The HTML viewer lists each captured URL and adds observations when URLs or
browser versions differ. It also notes when Segoe UI or Malgun Gothic was not
observed in the Windows font sample. Absence from this bounded sample does not
prove that a font is uninstalled. These notes are comparison context, not a
Windows compatibility verdict, and do not add fields to the metadata schema.
