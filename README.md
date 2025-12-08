# Sleepy Tabs Guardian

Sleepy Tabs Guardian is a Manifest V3 Chrome/Chromium extension that automatically freezes inactive tabs, reloads high-memory pages, and surfaces rich telemetry in a dashboard. A Node.js + Playwright companion service connects to the Chrome DevTools Protocol (CDP) to collect tab metrics and drive lifecycle actions such as `Page.setWebLifecycleState`.

## Features
- Auto-sleep inactive tabs after a configurable timeout (default 5 minutes) with per-tab override switches.
- Auto-reload tabs exceeding a configurable memory limit (default 500 MB) using CDP lifecycle commands.
- IndexedDB-powered telemetry log with dashboard highlighting critical pages and recent actions.
- Consent workflow plus in-page reminders with countdowns that auto-accept actions if the user is away.
- Options page for thresholds, reminder timers, and automation toggles.
- Native messaging bridge to a Playwright companion process for CDP access.

## Repository Layout
```
.
├── companion/              # Node.js native messaging companion (Playwright + CDP)
├── extension/              # MV3 extension source (Vite + React + TypeScript)
├── native-messaging/       # Example native messaging host manifest
├── tsconfig.base.json      # Shared TypeScript compiler defaults
└── README.md
```

## Prerequisites
- Node.js 20+
- npm 9+
- Chrome/Chromium launched with the remote debugging port open (default `localhost:9222`).
- For native messaging: ability to register host manifests on your OS.

## Getting Started
Install dependencies for all workspaces:
```bash
npm install
npm install -w extension
npm install -w companion
```

Then follow the detailed quick-start checklist in `docs/getting-started.md` for step-by-step setup, including browser flags, native host registration, and recommended sanity checks.

### Developer Tooling

Common scripts (run from repository root):

- `npm run dev`: build the extension in watch mode with Vite.
- `npm run build`: create a production bundle (see `extension/dist`).
- `npm run lint`: lint extension and companion workspaces.
- `npm run test`: execute Vitest suites.
- `npm run typecheck`: perform TypeScript checks across all packages.
- `npm run build -w companion`: transpile the Playwright companion service.

Refer to `docs/usage.md` for loading the extension, operating the dashboard, and controlling tabs from the popup. Companion operations and environment variables are documented there as well.

### Documentation & Guides

- `docs/getting-started.md`: full environment setup, installation, and verification steps.
- `docs/usage.md`: day-to-day usage, operational tips, troubleshooting.
- `docs/contributing.md`: contribution workflow, coding standards, issue templates.
- `docs/marketing/`: launch collateral, including LinkedIn and X drafts plus a presentation outline.
- `docs/publishing.md`: checklist for packaging and submitting to the Chrome Web Store.

### Native Messaging Host Registration

Follow the platform-specific instructions in `docs/getting-started.md` to register the companion host. The provided manifest template (`native-messaging/sleepy-tabs-companion.json`) must be updated with your deployment paths and extension ID.

## Logging and Telemetry

- **Live settings:** stored in `chrome.storage.local`/`chrome.storage.sync`.
- **Historical actions:** persisted in IndexedDB (`sleepyTabsTelemetry`) and displayed in the dashboard (Side Panel).
- **Companion telemetry:** streamed through native messaging and merged into tab state to drive reload decisions.

## Testing Notes

- Use `vitest` (`npm run test` / `npm run test -w companion`) for unit coverage.
- Run the companion against a remote-debugging-enabled browser while executing integration checks.
- Ensure consent is granted (installation flow opens `consent/index.html`).

## Project Roadmap

- Expand IndexedDB retention with pruning strategies or archive exports.
- Integrate Playwright-driven smoke tests for the extension UI using the companion for orchestration.
- Package the companion as a platform-specific binary for simplified deployment.
- Publish the marketing assets in `docs/marketing/` across selected channels.

## Contributing

We welcome pull requests and issue reports. Please review `docs/contributing.md` for branch strategy, commit conventions, and testing requirements before submitting changes.
