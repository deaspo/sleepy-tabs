# LinkedIn Launch Post

Introducing Sleepy Tabs Guardian -- a Chrome/Chromium extension that keeps your browser lean by napping inactive tabs and taming memory hogs.

## Why it matters

- Remote work made our browsers the new operating system. Idle tabs still drain laptops and distract focus.
- Existing "tab snoozers" rarely expose telemetry or offer guardrails for mission-critical pages.
- We all forget about tabs buried in another window, and Chrome's built-in memory saver picks its own timeout with no way to tune it.

## What we built

- Auto-sleeps inactive tabs after 5 minutes (configurable) with a reminder modal and manual override.
- Reloads tabs exceeding 250 MB, powered by a Playwright companion that taps the Chrome DevTools Protocol.
- One-click "Sleep all tabs" control that clears the decks instantly without opening every tab.
- IndexedDB-backed dashboard that highlights critical tabs, recent actions, and resource trends.
- Consent-first onboarding plus per-tab ignore toggles for sensitive workloads.

## Under the hood

- Manifest V3 service worker orchestrating Chrome APIs (alarms, storage, side panel).
- Native messaging bridge to a Node.js/TypeScript companion using Playwright's `connectOverCDP`.
- Vite + React UI stack with modular TypeScript shared utilities.

## Get involved

- Repo: _(add URL)_
- Quick start: `docs/getting-started.md`
- Contribution guide: `docs/contributing.md`

If memory spikes or tab overload slow you down, Sleepy Tabs Guardian has your back. Feedback and collaborators are welcome -- let's make calmer browsers the default!

