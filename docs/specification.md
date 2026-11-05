# Product Specification

Status: implemented prototype, version 0.1.0. This document defines supported
behavior and acceptance criteria. Actual verification is recorded separately.

## Purpose

A Mac developer needs to view a local web UI through a Windows browser during
development. The primary workflow opens Windows Chromium through Wine. Native
macOS capture is a comparison aid for platform-sensitive controls, text
wrapping, font fallback and scrollbars.

## Current Contract

Given a trusted loopback URL and a prepared runtime, the command:

1. Starts Windows Chromium under Wine and native macOS Chromium.
2. Creates separate contexts with the same viewport and capture settings.
3. Loads the URL, waits for fonts, an optional visible selector and a delay.
4. Captures each visible page viewport.
5. Writes both images, a difference image, HTML and environment metadata.
6. Closes owned processes; `--live` keeps contexts open until Enter.

Rendering runs on the Mac. Setup downloads dependencies and page resources can
use the network. There is no hosted rendering service.

## Scope

| Included | Boundary |
| --- | --- |
| Matching Chromium source revisions | Development snapshots, not a promise about stable Chrome or Edge. |
| Windows browser execution on Wine | Windows itself is absent; OS behavior is not reproduced exactly. |
| Viewport capture and visual comparison | No automatic Windows-compatibility verdict. |
| Observed font information | A bounded DOM sample, not every glyph in the page. |
| Interactive windows | Subsequent inputs and captures are not synchronized. |
| Local JSON output | No hosted API or published npm package is claimed. |

Real Windows execution, Windows font distribution, DPI calibration, OS dialogs,
IME, screen readers, pen input, session import and parallel commands sharing a
runtime are outside this prototype's verified scope.

## Acceptance Criteria

| Trigger | Required result |
| --- | --- |
| Valid page and prepared runtime | Both PNGs and the report are produced; exit is 0. |
| Common dimensions | Screenshots have matching dimensions at DPR 1. |
| Report opened | Images load, the overlay responds, and the Wine label is visible. |
| Metadata inspected | Actual versions, platforms, viewport, fonts and page errors are present. |
| Non-loopback initial hostname | Reject before starting browsers. |
| Unsuccessful main HTTP response | Fail with a diagnostic. |
| Readiness selector remains absent | Fail after the browser wait expires. |
| Windows browser startup fails | Fail and identify the Wine log. |
| Pixels differ | Report differences without treating the count as a defect score. |
| `--live` finishes capture | Keep both contexts open until Enter without replacing saved evidence silently. |

These are requirements, not a claim that every failure path was exercised.
Record tested cases and gaps in [verification](verification.md). Changes to
flags, output fields, runtime requirements or capture settings must update
their public contract alongside implementation.
