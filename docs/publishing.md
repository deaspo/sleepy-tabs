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
5. Set visibility to **Private** or **Unlisted**:
   - **Private** allows access only to users (or domains) you specify.
   - **Unlisted** is discoverable only via direct link.
6. Declare data usage; indicate that telemetry stays on-device unless you add cloud logging.

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

