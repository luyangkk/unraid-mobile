# Compact network telemetry layout

The user approved the proposed layout on 2026-10-26 and requested implementation.

## Intent and approach

Make network telemetry easier to scan within the existing System card on a
320px mobile viewport. Put the current interface in a title-row capsule button;
open the existing AppSheet for selection. Preserve the Unraid website palette,
shared secondary Button treatment and AppearanceSheet selection treatment.

A title-row native select would be smaller to implement but cannot provide the
same selection presentation or readable unavailable reasons. The approved
approach uses the existing bottom sheet and selects immediately on activation.

## Presentation and interaction

- Header: `Network` and `Auto · <resolved name>` or the manual interface name.
  The capsule remains at least 44px high; long names truncate only here.
- AppSheet: Auto first, with default-route interface or an unavailable reason;
  then sampled interfaces with full wrapping names and unavailable reasons.
  Preserve a disappeared manual selection as an unavailable row. No interface
  type, IP address or health claim may be inferred.
- Point selection immediately updates the Shell-owned selection, dismisses the
  sheet and restores focus to its trigger. Selecting the current row also closes
  it. Escape, the existing close button and AppSheet gestures remain supported.
- Receive/Transmit keep separate plots and share their existing zero-based
  scale. Align their labels, numeric values and graph areas; deemphasize units
  and add a light zero baseline to network plots only. Loading graph placeholders
  reserve the same height as plots.
- Footer: `Last 60s` and a compact sample date/time with explicit UTC, retaining
  the original RFC 3339 value in the time element. Keep existing stale sample
  messaging and chart gaps; changing selection must not reset CPU history.
- System collection becoming unavailable removes the selector and any open
  selection sheet. Snapshot updates and theme changes must not remount the
  dialog or disturb focus.

## Boundaries and validation

Frontend-only change. No new dependencies, palette changes, host requests,
business persistence, or stream ownership changes. Preserve old-server Auto,
session resets, manual unavailable selection, background behavior and theme
updates. Add interaction regression tests before implementation, run the full
frontend suite and production/PWA build, inspect dark/light mobile renders and
focus return. Browser emulation does not establish Android/iOS device acceptance.
