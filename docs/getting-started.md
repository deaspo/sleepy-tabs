# Getting Started

This guide walks you through setting up Sleepy Tabs Guardian from scratch, including the Chrome extension, the companion native host, and verification steps.

## 1. Prerequisites

- Node.js 20 or newer and npm 9 or newer (`node -v`, `npm -v`).
- Chrome or Chromium with support for Manifest V3.
- Ability to launch Chrome/Chromium with remote debugging enabled.
- Permissions to install native messaging hosts (usually per-user) on your OS.
- Chrome will display an "extension is debugging this browser" infobar whenever the fallback `chrome.debugger` sampler attaches. This only occurs when the native companion is offline.

## 2. Clone and Install

```bash
cd /home/poly  # or your preferred workspace
# git clone <repo-url> sleepy-tabs-ext  # once hosted remotely
cd sleepy-tabs-ext
npm install
npm install -w extension
npm install -w companion
```

## 3. Companion Service Build

Transpile the Playwright companion:

```bash
npm run build -w companion
```

Optionally run linting and type checks to confirm toolchain health:

```bash
npm run lint
npm run typecheck
```

## 4. Launch Browser with Remote Debugging

Start Chrome/Chromium with CDP accessible (default 9222):

```bash
/opt/google/chrome/chrome --remote-debugging-port=9222 --user-data-dir=/tmp/sleepy-tabs-profile
```

Adjust the path for your platform or use `chromium` where appropriate. Using a dedicated profile avoids conflicts with personal browsing.

## 5. Register the Native Messaging Host

1. Create an executable wrapper script to run the compiled companion:

   ```bash
   cat <<'EOF' > /home/poly/sleepy-tabs-ext/native-messaging/run-companion.sh
   #!/usr/bin/env bash
   exec /usr/bin/env node /home/poly/sleepy-tabs-ext/companion/dist/index.js "$@"
   EOF
   chmod +x /home/poly/sleepy-tabs-ext/native-messaging/run-companion.sh
   ```

2. Edit `native-messaging/sleepy-tabs-companion.json`:
   - Replace `/ABSOLUTE/PATH/TO/sleepy-tabs-companion` with the path to `run-companion.sh`.
   - Update `REPLACE_WITH_EXTENSION_ID` after the extension is loaded (see step 7).
3. Copy the manifest to your platform-specific location:
   - **Linux:** `~/.config/google-chrome/NativeMessagingHosts/`
   - **Chromium on Linux:** `~/.config/chromium/NativeMessagingHosts/`
   - **macOS:** `/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
   - **Windows:** `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\`
4. On Windows, create the required registry key per [Chrome native messaging docs](https://developer.chrome.com/docs/extensions/mv3/nativeMessaging/).
5. Restart Chrome/Chromium after placing the manifest.

## 6. Start the Companion Service

```bash
CDP_ENDPOINT=http://127.0.0.1:9222 npm run start -w companion
```

Keep this terminal open; it maintains the CDP connection and streams telemetry back to the extension.

## 7. Build and Load the Extension

1. Start Vite in watch mode:

   ```bash
   npm run dev
   ```

   The output appears in `extension/dist`.
2. Navigate to `chrome://extensions` and enable **Developer Mode**.
3. Click **Load unpacked** and select `extension/dist`.
4. Chrome will prompt you to confirm the debugger permission the first time the extension loads. Approve it (or reload the unpacked extension) for the fallback sampler to function.
5. Record the assigned extension ID and update the native messaging manifest if needed.

## 8. Verify Operation

- Open several tabs and let some go idle. Confirm the background dashboard (`side panel`) populates entries and memory metrics.
- Trigger the popup action on an active tab to sleep or reload it manually.
- Observe the reminder modal when a tab reaches the inactivity threshold; verify it auto-accepts after the configured countdown.
- If Chrome blocks the content reminder overlay (for example on `chrome://` or PDF pages) you will see a lightweight popup window instead. Only one reminder window opens per tab and it closes automatically once you decide or the countdown expires.
- Check the companion terminal for telemetry output and ensure no unhandled errors appear.
- Toggle the companion off to confirm the popup still reports memory usage via the hybrid fallback (you may briefly see Chrome's debugger infobar while it samples tabs).

### Optional: Enable Full-Page Sampling

Some teams want a richer memory snapshot sourced from `measureUserAgentSpecificMemory`. You can opt-in per profile:

1. Open the extension popup and click **Open settings** (or browse to `chrome-extension://<id>/src/pages/options/index.html`).
2. Enable **Full-page memory sampling**.
3. Ensure the target tabs run with both [Cross-Origin Opener Policy](https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy) and [Cross-Origin Embedder Policy](https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy) headers so the API is allowed.
4. Reload the tabs you care about; the popup/reminder UI will now show full-page totals when available.

### Optional: Control Reminder Focus Behavior

Reminders normally bring the impacted tab to the foreground so you can immediately decide whether to pause or reload it. If you prefer to stay on your current tab (for example, while presenting or taking notes), open the **Settings** page and toggle **Switch to the tab when showing reminders**. The setting is on by default to match the legacy behavior, but you can disable it at any time without reloading the extension.

> **Why a new window sometimes appears:** Chrome restricts extensions from injecting UI into privileged pages (e.g., `chrome://`, `chrome-extension://`, PDF viewer, Web Store). When that happens Sleepy Tabs launches a single reminder popup window so the prompt is still visible. The window is recycled per tab and closes gracefully when you act or when the timer finishes.

## 9. Telemetry Sources at a Glance

1. **Native companion (recommended):** Provides full CDP coverage, lifecycle control, and most accurate metrics.
2. **Chrome debugger fallback:** When the companion is offline, the background service worker sporadically attaches via `chrome.debugger` to gather `Performance.getMetrics` samples. Chrome displays an infobar during each quick attach/detach cycle.
3. **In-tab probes:** A lightweight content script calls `performance.memory` inside each tab when available, providing approximate JS heap totals and usage without any special permissions.
4. **Chrome processes fallback:** If enabled in Settings, Sleepy Tabs polls the `chrome.processes` API when all other sources are unavailable. These readings match Chrome's Task Manager and are only recorded after exceeding the **Process fallback threshold (MB)** slider on the Settings page. Each telemetry record notes which threshold fired so you can trace aggressive policies later. Chrome currently restricts this API to Dev/Beta/Canary builds, so the toggle stays disabled on stable releases to avoid misleading warnings.

## 10. Optional Quality Checks

- `npm run test` / `npm run test -w companion`: execute unit tests.
- `npm run build`: produce a production build and load that folder to replicate release behavior.
- Run `npm audit` to review dependency advisories; follow up with mitigations before publishing.

## 11. Next Steps

Proceed to `docs/usage.md` for deeper operational tips, profile management, and troubleshooting, and review `docs/contributing.md` prior to opening issues or pull requests.

