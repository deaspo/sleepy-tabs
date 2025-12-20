# Chrome Web Store Public Release Guide

Use this checklist when preparing Sleepy Tabs Guardian for a public (discoverable) Chrome Web Store release. It expands on the internal/unlisted guide and adds the marketing, compliance, and asset polish needed for a consumer-facing listing.

## 1. Prerequisites

- Chrome Web Store developer account with the one-time $5 registration fee paid.
- Production build artifacts in `extension/dist` generated via `npm run build -w extension`.
- Hosted privacy policy and terms of use (linked from consent flow and store listing).
- Support email address monitored by the team.
- Screenshots, promo images, and icons that follow Chrome Web Store branding rules.

## 2. Build and Freeze the Release

1. Verify `extension/package.json` and `extension/src/manifest.ts` share the same semantic version.
2. Run `npm run build -w extension` to produce `extension/dist`.
3. Smoke test the build in Chrome by loading the unpacked `extension/dist` folder.
4. Tag the commit or note the git SHA you intend to publish.

## 3. Compliance Review

- **Permissions:** Audit `extension/src/manifest.ts` and remove unused permissions. Chrome flags `tabs`, `scripting`, or `debugger` overreach if not documented.
- **Privacy policy:** Host it on a public URL (GitHub Pages, company site). Explicitly mention that telemetry stays local unless the user exports it.
- **Policy hosting:** Follow `docs/hosting-policies.md` so the Chrome Web Store links point to `https://deaspo.github.io/sleepy-tabs/policies/privacy-policy` and `https://deaspo.github.io/sleepy-tabs/policies/terms-of-use`.
- **Data safety form:** In the Developer Dashboard, declare how you handle user data. Sleepy Tabs Guardian stores data locally, so mark "No collection" for remote data unless that changes.
- **Consent copy:** Ensure the consent page, onboarding, and documentation describe why debugger and processes fallbacks may show infobars.

## 4. Package the Build

```bash
cd extension/dist
zip -r ../sleepy-tabs-guardian-public.zip .
cd ../..
```

Keep the zip under 50 MB and avoid bundling source maps or tests.

## 5. Prepare Listing Content

- **Title:** "Sleepy Tabs Guardian" (use the same casing everywhere).
- **Short description:** ≤132 characters, e.g., "Automatically pause or reload heavy Chrome tabs before they drain your laptop."
- **Full description:** 2–3 paragraphs highlighting reminders, memory sources, privacy stance, and companion integration.
- **Screenshots:** Minimum three at 1280×800 (PNG or JPG). Capture the popup, dashboard, and reminder overlay.
- **Promotional tile:** 440×280 (optional but recommended).
- **Video (optional):** Host on YouTube and paste the link in the listing.

## 6. Icon and Branding Guidance

Chrome requires square icons in 128×128, 48×48, and 16×16 at `extension/public/icon-*.png`. Follow one of these themes:

1. **Wordmark style:**
   - Canvas: 1024×1024 px.
   - Background: soft blue or gradient (#0d47a1 → #42a5f5) with rounded 160 px corners.
   - Foreground: bold sans-serif "STG" centered, white text with drop shadow. Place "Sleepy Tabs Guardian" in smaller caps beneath the acronym.
   - Export to PNG at 1024 px, then downscale to 128, 48, 16 px (use nearest-neighbor for 16 px to keep text legible). Drop the files into `extension/public/icon-128.png`, etc.

2. **Sleeping mascot:**
   - Draw a minimal sleeping cat/dog/baby silhouette in black & white inside a white-bordered circle.
   - Keep line weight ≥8 px so it survives downscaling.
   - Outer circle: white stroke (12 px) with slight drop shadow; fill the circle with navy or charcoal for contrast.
   - Export the same 1024→128/48/16 PNG set.

**Workflow tips:**

- Use Figma, Sketch, or Canva. Maintain a master frame with separate slices for each size.
- Test icons against Chrome's dark toolbar by dropping them into `chrome://extensions` developer mode.
- Commit the source design file (`docs/assets/icons.fig` or similar) so future releases can tweak the artwork.

## 7. Create the Store Listing (Public)

1. In the Developer Dashboard, open the existing listing (ID `bfgeeiahcekoeafnbjdacfdgbhehgneb`, public URL https://chromewebstore.google.com/detail/bfgeeiahcekoeafnbjdacfdgbhehgneb) or click **Add new item** if you are creating a fresh variant, then upload the zipped package.
2. Fill the listing form with the content prepared above.
3. Set visibility to **Public**.
4. Provide privacy policy URL, support email, and (optional) website.
5. Complete the Data Safety questionnaire.
6. Opt into "Enhanced review" only if Google requests additional info.

## 8. Quality Gates Before Publishing

- Install from the uploaded draft listing using the "Preview" link to confirm assets and text render correctly.
- Run Chrome's built-in Lighthouse (Application → Manifest) to verify manifest completeness.
- Test on Windows, macOS, and Linux profiles to ensure the reminder popup + overlays behave consistently.
- Validate that disabling auto focus and process fallback toggles updates the UI as documented.

## 9. Submit and Monitor

- Click **Publish**. Public listings often take 2–5 business days for manual review.
- Monitor email for policy feedback; respond promptly if Chrome requests clarifications.
- Once approved, announce the release (blog post, social, README badge) and link to the store URL.

## 10. Post-Launch Maintenance

- Track crash/error rates via Chrome Web Store stats dashboard.
- Plan a cadence for updates (monthly or per feature). Each update requires bumping `manifest.version`, rebuilding, and re-uploading.
- Keep screenshots and copy fresh whenever major UI changes ship.
- Archive previous zips or create GitHub Releases for traceability.

## 11. Asset Generation Checklist

1. Clone the design template in your preferred tool.
2. Update colors or mascot variant as needed.
3. Export `icon-512.png` and `icon-256.png` for marketing (even though Chrome only requires 128/48/16).
4. Downscale to 128/48/16 (and optionally 32) using a high-quality resampler.
5. Replace the files in `extension/public/` and commit them.
6. Rebuild (`npm run build -w extension`) so Vite copies the new assets to `dist/`.
7. Update documentation/screenshot overlays to reflect the new branding.

Following this guide ensures the public listing meets Chrome's UX and policy expectations while presenting Sleepy Tabs Guardian with polished visuals.
