# Getting Started on Windows

This guide mirrors the standard setup but calls out every Windows-specific step so you can configure Sleepy Tabs Guardian without switching between platform instructions.

> Examples assume the repository lives at `C:\code\sleepy-tabs-ext`. Update paths if you work elsewhere.

## 1. Prerequisites

- Windows 10 or 11 with permission to install native messaging hosts (per-user rights are enough).
- Node.js 20+ and npm 9+ (`node -v`, `npm -v`).
- Google Chrome or Microsoft Edge (Manifest V3 capable). Chromium also works.
- Ability to launch Chrome with remote debugging enabled.
- Expect Chrome/Edge to display the standard "is debugging this browser" infobar when the fallback `chrome.debugger` sampler runs (only triggered while the companion is offline).

## 2. Clone and Install

```powershell
cd C:\code  # or your preferred workspace
# git clone <repo-url> sleepy-tabs-ext
cd sleepy-tabs-ext
npm install
npm install -w extension
npm install -w companion
```

## 3. Build the Companion

Transpile the Playwright companion:

```powershell
npm run build -w companion
```

(Optional) confirm linting and type checks:

```powershell
npm run lint
npm run typecheck
```

## 4. Launch Browser with Remote Debugging

Use a dedicated profile to keep personal browsing untouched. Pick the shell you prefer.

### Google Chrome (Command Prompt)

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Temp\sleepy-tabs-profile"
```

### Google Chrome (PowerShell)

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir "$env:LOCALAPPDATA\Temp\sleepy-tabs-profile"
```

### Microsoft Edge

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir "$env:LOCALAPPDATA\Temp\sleepy-tabs-profile"
```

Adjust the executable path if your browser is installed elsewhere. For Chromium, point at `chromium.exe` instead.

Verify remote debugging is live by visiting `http://localhost:9222` in another tab—you should see a list of open targets.

## 5. Register the Native Messaging Host

We have provided a PowerShell script to automate the registration process. This script will:

1. Create the Windows launcher (`run-companion.cmd`).
2. Generate the manifest file with the correct absolute paths.
3. Register the host in the Windows Registry for both Chrome and Edge.

Run the following command in PowerShell:

```powershell
cd native-messaging
.\setup-windows.ps1
```

You will be prompted to enter your **Extension ID**. You can find this by:

1. Opening `chrome://extensions` (or `edge://extensions`).
2. Finding "Sleepy Tabs Guardian".
3. Copying the ID (e.g., `cagnkfgoijplkkccilmkdmhccbbjdhcp`).

After the script completes, **reload the extension** in your browser.

## 6. Verification

1. Open the extension popup.
2. You should see "Estimated memory usage" instead of "Native companion offline".
3. If it still says "Offline", check the extension console for errors (`Extensions > Manage Extensions > Inspect views: background page`).
4. Stop the companion temporarily—the popup should continue surfacing approximate memory data. Chrome may briefly flash the debugger infobar while it gathers fallback samples.

## 7. Troubleshooting

- **"Access forbidden"**: Ensure the Extension ID in `native-messaging/sleepy-tabs-companion.json` matches your installed extension exactly.
- **"Communication error"**: Ensure `run-companion.cmd` exists and points to the correct `node.exe` and `index.js` paths.
- **"Native companion offline"**: The background script failed to connect. Check if the browser was launched with `--remote-debugging-port=9222`.


Leave the terminal running; it maintains the CDP connection and forwards telemetry.

## 7. Build the Extension

```powershell
npm run build -w extension
```

The unpacked assets land in `extension\dist`.

## 8. Load the Extension in the Browser

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge) and enable **Developer mode**.
2. Click **Load unpacked** and choose `C:\code\sleepy-tabs-ext\extension\dist`.
3. Approve the debugger permission prompt the first time you load the unpacked extension so fallback sampling can run.
4. Note the assigned extension ID and update the native messaging manifest’s `allowed_origins` if it changed.

## 9. Verify Everything Works

- Leave several tabs idle and confirm the dashboard (side panel) starts listing them with memory metrics.
- Trigger the popup on an active tab to sleep or reload it—watch the companion terminal for activity.
- When a tab crosses the inactivity threshold, confirm the reminder modal appears. If it auto-resolves due to timeout, the background should log the action and you should see telemetry saved.

## 10. Optional Quality Checks

- `npm run test` or `npm run test -w companion` to execute unit tests.
- `npm run build` from the repo root to build all packages for a release-style validation.
- `npm audit` to review dependency advisories before publishing.

## Troubleshooting

- **Service worker registration failed (status code 3):** ensure you copied a fresh `extension\dist` build (not a dev server output) and reloaded the unpacked extension.
- **Specified native messaging host not found:** double-check the manifest path, registry entry, and that `run-companion.cmd` plus Node are reachable from the browser.
- **Reminder modal never appears:** make sure `extension\dist\reminderModal.ts-loader.js` exists—`npm run build -w extension` runs a post-build script to materialize it.
- **Companion fails to start:** verify your browser is running with `--remote-debugging-port=9222` and that the `CDP_ENDPOINT` environment variable matches the port.
