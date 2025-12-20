# Chrome Web Store Publishing Guide

This document outlines how to package and submit Sleepy Tabs Guardian to the Chrome Web Store. It focuses on private or unlisted distribution suitable for internal teams.

## 1. Prerequisites
- Google account with access to the Chrome Web Store Developer Dashboard.
- One-time developer registration fee paid (currently USD $5).
- Built extension artifacts (`extension/dist`) generated via `npm run build`.
- Icons at 128x128, 48x48, and 16x16 (already present in `extension/public`).
- Privacy policy and terms of use (referenced from consent flow).

## 2. Build the Production Package
```bash
npm run build
```
The Vite build outputs to `extension/dist`. Inspect the folder to ensure only runtime assets are present.

## 3. Prepare the Upload Zip
Chrome Web Store requires a zipped bundle of the unpacked extension:
```bash
cd extension/dist
zip -r ../sleepy-tabs-extension.zip .
cd ../..
```
Verify the zip size is under the store limits (usually < 50 MB for standard extensions).

## 4. Update Manifest Metadata
Edit `extension/src/manifest.ts` and confirm:
- `name`, `description`, and `version` fields reflect the release.
- All permissions are justified; remove unused ones before shipping.
- Consent URLs reference your hosted privacy policy if applicable.

Rebuild after manifest updates to propagate changes:
```bash
npm run build
```

## 5. Create the Store Listing
1. Navigate to <https://chrome.google.com/webstore/devconsole>.
2. Click **Add new item** and upload `sleepy-tabs-extension.zip`.
3. Fill in listing details:
   - Title, short description, and full description (reuse README highlights).
   - Screenshots (1280x800 recommended) and promotional images.
   - Category and language.
4. Provide a link to your privacy policy and contact email.
5. In the **Additional fields** panel supply the hosted URLs:
   - **Official URL / Homepage URL**: <https://deaspo.github.io/sleepy-tabs/>
   - **Support URL**: <https://deaspo.github.io/sleepy-tabs/support/>
   These pages live in `docs/index.md` and `docs/support.md` and are published automatically via GitHub Pages. Update the markdown if you need to customize messaging before each release.
6. Set visibility to **Private** or **Unlisted**:
   - **Private** allows access only to users (or domains) you specify.
   - **Unlisted** is discoverable only via direct link.
7. Declare data usage; indicate that telemetry stays on-device unless you add cloud logging.
8. For existing updates, locate the listing with ID `bfgeeiahcekoeafnbjdacfdgbhehgneb` (public URL: https://chromewebstore.google.com/detail/bfgeeiahcekoeafnbjdacfdgbhehgneb) and upload the new package under **Package**.

### Listing Copy (v0.1.3)

- **Short description (132 chars max):**
   `Sleep idle tabs, tame memory hogs, and review rich telemetry—Edge-friendly reminders keep you in control.`
- **Full description:**
   ```
   Sleepy Tabs Guardian keeps Chrome lean without losing your place. Automatically pause idle tabs, act on runaway memory, and review every decision in a searchable dashboard. In-page reminders give you the final say—snooze, ignore, sleep, or reload—while an optional native helper deepens telemetry.

   What's new in 0.1.3:
   - Smarter idle reminders that respect Chrome/Edge privileged pages yet still capture tab state at startup.
   - One-click "Restore defaults" on the Options page for fast recovery after experiments.
   - Refined documentation and onboarding guidance for administrators rolling out the extension at scale.

   Key capabilities:
   - Configurable inactivity timeout with per-tab ignore toggles.
   - Memory thresholds with separate actions for active vs. inactive tabs.
   - Rich telemetry stored locally in IndexedDB and surfaced in a side-panel dashboard.
   - Optional native companion (via Chrome Native Messaging) to stream Chrome DevTools Protocol metrics when deeper insight is required.
   ```
- **Screenshots to highlight:**
   1. Popup showing memory stats and manual actions.
   2. Side panel dashboard with critical tabs and recent actions.
   3. Reminder popup illustrating snooze/ignore choices.
   4. Options page with Restore defaults button visible.

## 6. Configure Access (Private Listing)

- For private availability, specify Google accounts or an entire Google Workspace domain.
- Confirm your team members use those accounts to sign into Chrome.

## 7. Submit for Review

- Click **Publish**. Even private listings undergo automated review and may take several hours.
- Monitor the dashboard for approval status or required fixes.

## 8. Post-Publish Checklist

- Share the Web Store link with approved users.
- Tag the Git repository release (optional) and update documentation references.
- Maintain version parity: bump `manifest.version` and the workspace package versions on subsequent releases.
- Retest installation from the Chrome Web Store package to ensure production behavior matches local builds.

## 9. Handling Updates

- Increment the `version` in `manifest.ts` (major.minor.patch).
- Rebuild and upload a new zip via the developer console.
- Submit the update; Chrome Web Store pushes updates automatically to enrolled users.

## 10. Distribution Outside the Store

For environments that forbid Web Store usage, provide the zipped package alongside manual installation instructions via `chrome://extensions`. Ensure you follow organizational policies before opting for this path.

## Permission Justifications

When completing the Chrome Web Store submission, copy the following explanations into the **Permission justification** fields. Each entry is under the 1,000 character limit and maps directly to `manifest.ts` permissions.

| Permission | Justification |
| --- | --- |
| `alarms` | Schedules lightweight timers that re-evaluate tab memory state, trigger reminder countdowns, and run watchdog health checks. No network access or content inspection is performed in these callbacks. |
| `storage` | Stores the user's configuration (thresholds, automation choices) and the per-tab state cache so reminders and ignores persist across browser sessions. Data stays in `chrome.storage` on the user's device. |
| `tabs` | Reads basic tab metadata (title, URL, discarded status) and issues sleep/activate commands initiated by the user or reminder flows. It never inspects page content. |
| `scripting` | Injects the in-tab `memoryProbe` script that reads `performance.memory` metrics so users see approximate heap usage inside the popup and dashboard. The script never captures DOM content. |
| `sidePanel` | Hosts the dashboard UI inside the Chrome side panel, allowing users to review telemetry without opening a new tab. |
| `nativeMessaging` | Connects to the optional Sleepy Tabs companion app that users install locally to provide richer Chrome DevTools Protocol (CDP) telemetry. The channel is only opened when the user has installed the helper. |
| `debugger` | Offers a fallback when native messaging is unavailable by briefly attaching to a tab's CDP target to fetch memory metrics or apply lifecycle sleep commands, matching the extension's core purpose. |
| `processes` | Checks whether Chrome's processes API can supply per-process memory details; if available, it augments telemetry with aggregate usage to improve automation accuracy. |
| Host (`<all_urls>`) | Needed so the memory probe and reminder content scripts can run on any site the user opens. The scripts only access runtime performance data and display UI; they never read or transmit page content. |

