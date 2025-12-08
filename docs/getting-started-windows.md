# Getting Started on Windows

This guide mirrors the standard setup but calls out every Windows-specific step so you can configure Sleepy Tabs Guardian without switching between platform instructions.

> Examples assume the repository lives at `C:\code\sleepy-tabs-ext`. Update paths if you work elsewhere.

## 1. Prerequisites

- Windows 10 or 11 with permission to install native messaging hosts (per-user rights are enough).
- Node.js 20+ and npm 9+ (`node -v`, `npm -v`).
- Google Chrome (Manifest V3 capable) or Chromium.
- Ability to launch Chrome with remote debugging enabled.

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

## 4. Launch Chrome with Remote Debugging

Use a dedicated profile to keep personal browsing untouched. Pick the shell you prefer.

### Command Prompt

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Temp\sleepy-tabs-profile"
```

### PowerShell

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir "$env:LOCALAPPDATA\Temp\sleepy-tabs-profile"
```

Adjust the executable path if Chrome is installed elsewhere. For Chromium, point at `chromium.exe` instead.

Verify remote debugging is live by visiting `http://localhost:9222` in another tab—you should see a list of open targets.

## 5. Register the Native Messaging Host

Chrome needs two things: a manifest that describes the host and a registry entry that tells Chrome where to find that manifest.

1. **Create a Windows launcher for the companion.**

   ```powershell
   cd C:\code\sleepy-tabs-ext\native-messaging
   @'
   @echo off
   setlocal
   set "NODE_EXE=C:\Program Files\nodejs\node.exe"
   "%NODE_EXE%" "C:\code\sleepy-tabs-ext\companion\dist\index.js" %*
   endlocal
   '@ | Out-File -FilePath run-companion.cmd -Encoding ASCII
   ```

   - Update `NODE_EXE` if Node lives in a different directory.
   - Keep the script in the repo so the manifest can reference a stable path.

2. **Edit `native-messaging\sleepy-tabs-companion.json`.** Replace the `path` with the script above and set the extension ID after you load the extension:

   ```json
   {
     "name": "com.sleepytabs.companion",
     "description": "Sleepy Tabs Guardian Native Messaging Host",
     "path": "C:\\code\\sleepy-tabs-ext\\native-messaging\\run-companion.cmd",
     "type": "stdio",
     "allowed_origins": [
       "chrome-extension://REPLACE_WITH_EXTENSION_ID/"
     ]
   }
   ```

3. **Copy the manifest to Chrome’s host directory.**

   ```powershell
   $hostDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\NativeMessagingHosts"
   New-Item -Path $hostDir -ItemType Directory -Force | Out-Null
   Copy-Item -Path C:\code\sleepy-tabs-ext\native-messaging\sleepy-tabs-companion.json -Destination "$hostDir\com.sleepytabs.companion.json" -Force
   ```

4. **Register the manifest in the Windows registry.** Save the snippet below as `register-sleepy-tabs-host.reg`, update the path if needed, then double-click it (or import via `regedit`).

   ```reg
   Windows Registry Editor Version 5.00

   [HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.sleepytabs.companion]
   @="C:\\Users\\<YourUser>\\AppData\\Local\\Google\\Chrome\\User Data\\NativeMessagingHosts\\com.sleepytabs.companion.json"
   ```

   Replace `<YourUser>` with your Windows username. Chrome reads the entry on launch.

5. Restart Chrome after updating manifests or registry entries.

## 6. Start the Companion Service

```powershell
cd C:\code\sleepy-tabs-ext
$env:CDP_ENDPOINT = "http://127.0.0.1:9222"
npm run start -w companion
```

Leave the terminal running; it maintains the CDP connection and forwards telemetry.

## 7. Build the Extension

```powershell
npm run build -w extension
```

The unpacked assets land in `extension\dist`.

## 8. Load the Extension in Chrome

1. Visit `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and choose `C:\code\sleepy-tabs-ext\extension\dist`.
3. Note the assigned extension ID and update the native messaging manifest’s `allowed_origins` if it changed.

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
- **Specified native messaging host not found:** double-check the manifest path, registry entry, and that `run-companion.cmd` plus Node are reachable from Chrome.
- **Reminder modal never appears:** make sure `extension\dist\reminderModal.ts-loader.js` exists—`npm run build -w extension` runs a post-build script to materialize it.
- **Companion fails to start:** verify Chrome is running with `--remote-debugging-port=9222` and that the `CDP_ENDPOINT` environment variable matches the port.
