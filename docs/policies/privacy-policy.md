# Sleepy Tabs Guardian Privacy Policy

Last updated: December 10, 2025

Sleepy Tabs Guardian is a Chrome extension that helps you monitor and control memory-heavy tabs. This policy explains what data the extension touches, how that data is handled, and how you can control it.

## What Data We Process

- **Tab metadata:** Titles, URLs, process IDs, and Chrome-reported memory statistics are read so the extension can identify heavy tabs and render dashboards.
- **User preferences:** Reminder timing, automation toggles, and consent decisions are stored with `chrome.storage.local` to persist your settings across browser sessions.
- **Native companion telemetry (optional):** If you install the companion app, aggregated OS-level metrics (process RSS, swap usage) stay on your device and are never transmitted back to us.

We do **not** collect account information, browsing history beyond the current tab set, or any personally identifying information.

## Where Data Lives

- All extension state stays inside Chrome's local storage on your device.
- Optional companion telemetry remains on your device; communication with the extension uses Chrome Native Messaging and does not send information to external servers.
- No data leaves your machine unless you explicitly export it via the dashboard.

## Permissions Rationale

- `tabs`, `processes`, and `debugger` are required to inspect tab health metrics.
- `storage` retains your settings.
- `alarms` schedules periodic health checks.
- `windows`/`sidePanel` let the extension surface UI entry points.
- `nativeMessaging` is only exercised when the companion host is installed.

We continually audit permissions and remove any that the codebase no longer uses.

## Data Sharing and Third Parties

Sleepy Tabs Guardian does not transmit or sell data to third parties. There are no analytics, crash reporters, or advertising SDKs embedded in the extension.

## Your Choices

- Disable specific features (auto-sleep, process fallbacks, debugger probes) from the Options page.
- Remove stored data by uninstalling the extension; Chrome will delete its local storage.
- Decline optional capabilities such as the companion host to keep the extension in a browser-only mode.

## Updates to This Policy

We update this document whenever data handling changes. Significant updates are noted in the repository changelog and release notes.

## Contact

Have privacy questions? Email the maintainers at [support@sleepytabs.app](mailto:support@sleepytabs.app).
