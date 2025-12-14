# Usage Guide

This guide covers daily operations, configuration adjustments, and troubleshooting for Sleepy Tabs Guardian once it is installed.

## Extension Surfaces

- **Popup (`chrome.action`)**: Quickly sleep or reload the current tab, view estimated memory, toggle ignore state, and navigate to settings.
- **Options Page**: Adjust inactivity timeout, calibrated memory thresholds, high-memory actions per tab state, reminder countdown, and automation toggles.
- **Dashboard (Side Panel)**: Review recent actions, highlight critical tabs, and inspect telemetry history from IndexedDB.
- **Reminder Modal**: Appears in-page before automatic actions, offering a manual override with a countdown.

### Reminder Limitations

- Browser security policies prevent content script injection on some pages (browser settings, extension galleries, Web Store, internal `chrome://` / `edge://` pages, etc.). Sleepy Tabs automatically suppresses reminders on these surfaces, treating them as ignored until you navigate elsewhere.
- Suppressed tabs still show up in the dashboard for status visibility, but reminders, snoozes, and auto-actions won’t trigger until the tab navigates to a standard URL where scripting is permitted.
- If you need reminder coverage on a domain protected by enterprise policies, request admin approval to allow content scripts or rely on manual actions from the popup/dashboard instead.

## Adjusting Settings

1. Open the popup and click **Open settings**, or visit `chrome-extension://<id>/src/pages/options/index.html` directly.
2. Modify timeouts or thresholds. Changes persist immediately to `chrome.storage.local` and sync across sessions.
3. Use the **High-memory tab actions** panel to pick separate behaviors for active (reminder + action) and inactive (auto sleep or reload) tabs, and toggle whether a reminder should appear first. The defaults keep a 100 MB total heap threshold tuned for in-tab probes, sleeping inactive tabs automatically and prompting before touching the active one.

## Understanding Tab States

- Tabs marked **ignored** remain untouched by auto sleep/reload but still appear in the dashboard.
- Memory usage now updates via a hybrid chain: the native companion (when online) sends CDP metrics, the debugger fallback samples `Performance.getMetrics` while the companion is offline, and content scripts query `performance.memory` for quick estimates. Only when all sources are unavailable will the UI display "collecting...".
- The popup shows which sampler produced the current estimate (Native companion, Chrome debugger, or in-tab probe) plus the capture time so you can reason about fidelity before acting.
- Existing telemetry history is automatically backfilled as "Native companion" on upgrade so older records remain consistent; clearing the dashboard database is no longer required.
- When a tab is slept (`chrome.tabs.discard`), Chrome may purge its content until refocused.
- High-memory automation defaults to auto-sleeping inactive tabs while prompting before acting on active tabs. Dashboard and telemetry entries now log which threshold fired, whether a reminder was shown, and which tab state was targeted.

## Telemetry Dashboard Tips

- Critical entries (memory-triggered actions) surface at the top. Click the URL to reopen the tab, and review the memory source/capture timestamp for fidelity context.
- Use Chrome's side panel toggle (toolbar button) to pin the dashboard for quick access.
- Data retention is limited to the most recent 200 records by default; plan for export or archival if longer history is required.

## Companion Service Controls

- Environment Variables:
  - `CDP_ENDPOINT`: Remote debugging URL (default `http://127.0.0.1:9222`).
  - `LOG_LEVEL` (planned): Surface additional diagnostics when implemented.
- Restart the companion after browser restarts to reattach to new CDP sessions.
- If the companion is offline, the extension still reports approximate memory via the debugger + `performance.memory` probes, but lifecycle commands (e.g., remote freeze) remain companion-dependent.

## Troubleshooting

- **Reminder modal does not appear**: Ensure content scripts are allowed on the site (Chrome toolbar → Extensions → Sleepy Tabs → toggle "Allow this extension to read and change site data").
- **Native messaging errors**: Check the companion terminal for stack traces. Re-run `npm run build -w companion` after code changes and confirm the wrapper script path.
- **Service worker suspension**: Chrome terminates the background service worker when idle. The extension reinitializes on events, but you can force reload via `chrome://extensions` → **Reload**.
- **Memory metrics missing**: Confirm the browser was launched with `--remote-debugging-port` and that no firewall blocks the CDP WebSocket.

## Housekeeping

- Clear telemetry history using the console: `await indexedDB.deleteDatabase('sleepyTabsTelemetry');` (run in dashboard devtools) or implement retention controls as part of roadmap.
- Review `npm audit` reports before distributing builds.

For development workflows and contribution instructions, continue with `docs/contributing.md`.
