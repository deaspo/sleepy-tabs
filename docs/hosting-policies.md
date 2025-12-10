# Hosting Privacy and Terms on GitHub Pages

This guide explains how to serve the policy documents in `docs/policies/` via GitHub Pages so they can be referenced in the Chrome Web Store listing and within the extension UI.

## 1. Prerequisites

- Maintainer access to the `deaspo/sleepy-tabs` repository on GitHub.
- The policy markdown files checked into `docs/policies/privacy-policy.md` and `docs/policies/terms-of-use.md`.

## 2. Enable GitHub Pages

1. Push the latest `devel` branch so GitHub has the `docs/` folder.
2. Open **Settings → Pages** in the repository.
3. Under **Build and deployment**, choose:
   - **Source**: `Deploy from a branch`
   - **Branch**: `devel`
   - **Folder**: `/docs`
4. Click **Save**. GitHub will start building the site at `https://deaspo.github.io/sleepy-tabs/`.
5. Wait for the green check mark in the Pages or Actions tab confirming the site published.

## 3. Verify URLs

- Privacy Policy: `https://deaspo.github.io/sleepy-tabs/policies/privacy-policy`
- Terms of Use: `https://deaspo.github.io/sleepy-tabs/policies/terms-of-use`

GitHub Pages converts `*.md` files into HTML automatically. Visit the URLs above and confirm they render as expected.

## 4. Optional Custom Domain

If you purchase a custom domain (e.g., `sleepytabs.app`), point its DNS `CNAME` record to `deaspo.github.io` and add a `docs/CNAME` file containing the custom hostname. This step is optional; the default GitHub Pages URLs already satisfy Chrome Web Store policy requirements.

## 5. Wire Up References

- **Chrome Web Store listing:** Paste the privacy URL into the Privacy Policy field and optionally use the Terms URL in the support/contact section.
- **Extension UI:** Add footer links in `src/pages/options/index.html` and any onboarding flows referencing the same URLs so users can access the policies from inside the product.
- **Documentation:** Update `docs/publishing-public.md` to remind future releases of the canonical URLs.

## 6. Ongoing Maintenance

- When policy text changes, open a PR modifying the markdown files. Once merged into `devel`, GitHub Pages redeploys automatically.
- Mention policy revisions in release notes to maintain transparency.
- If ownership of policy content shifts, document the required reviewers in `docs/contributing.md` or the PR template.
