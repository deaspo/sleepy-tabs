# Usage Guide

This guide covers daily operations, configuration adjustments, and troubleshooting for Sleepy Tabs Guardian once it is installed.

## Extension Surfaces

- **Popup (`chrome.action`)**: Quickly sleep or reload the current tab, view estimated memory, toggle ignore state, and navigate to settings.
- **Options Page**: Adjust inactivity timeout, memory threshold, reminder countdown, and automation toggles.
- **Dashboard (Side Panel)**: Review recent actions, highlight critical tabs, and inspect telemetry history from IndexedDB.
- **Reminder Modal**: Appears in-page before automatic actions, offering a manual override with a countdown.

## Adjusting Settings

1. Open the popup and click **Open settings**, or visit `chrome-extension://<id>/src/pages/options/index.html` directly.
2. Modify timeouts or thresholds. Changes persist immediately to `chrome.storage.local` and sync across sessions.
3. Use the **Automatically sleep/reload** toggles to disable automation without uninstalling the extension.

## Understanding Tab States

- Tabs marked **ignored** remain untouched by auto sleep/reload but still appear in the dashboard.
- Memory usage is updated when the companion reports CDP metrics; if the companion is unavailable, values will display as "collecting...".
- When a tab is slept (`chrome.tabs.discard`), Chrome may purge its content until refocused.

## Telemetry Dashboard Tips

- Critical entries (memory-triggered actions) surface at the top. Click the URL to reopen the tab.
- Use Chrome's side panel toggle (toolbar button) to pin the dashboard for quick access.
- Data retention is limited to the most recent 200 records by default; plan for export or archival if longer history is required.

## Companion Service Controls

- Environment Variables:
  - `CDP_ENDPOINT`: Remote debugging URL (default `http://127.0.0.1:9222`).
  - `LOG_LEVEL` (planned): Surface additional diagnostics when implemented.
- Restart the companion after browser restarts to reattach to new CDP sessions.
- If the companion is offline, the extension falls back to inactivity-based sleeping only.

## Troubleshooting

- **Reminder modal does not appear**: Ensure content scripts are allowed on the site (Chrome toolbar → Extensions → Sleepy Tabs → toggle "Allow this extension to read and change site data").
- **Native messaging errors**: Check the companion terminal for stack traces. Re-run `npm run build -w companion` after code changes and confirm the wrapper script path.
- **Service worker suspension**: Chrome terminates the background service worker when idle. The extension reinitializes on events, but you can force reload via `chrome://extensions` → **Reload**.
- **Memory metrics missing**: Confirm the browser was launched with `--remote-debugging-port` and that no firewall blocks the CDP WebSocket.

## Housekeeping

- Clear telemetry history using the console: `await indexedDB.deleteDatabase('sleepyTabsTelemetry');` (run in dashboard devtools) or implement retention controls as part of roadmap.
- Review `npm audit` reports before distributing builds.

For development workflows and contribution instructions, continue with `docs/contributing.md`.
