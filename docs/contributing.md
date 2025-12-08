# Contributing

We welcome community feedback and enhancements. This document outlines expectations for filing issues, submitting pull requests, and maintaining code quality.

## Code of Conduct

Treat collaborators with respect. Anti-harassment policies and inclusive language apply in all project spaces.

## Issue Workflow

1. Search existing issues before filing duplicates.
2. Provide clear reproduction steps, expected behavior, and environment details.
3. Tag issues with relevant labels (`bug`, `enhancement`, `docs`, etc.).
4. For large proposals, open a discussion thread first to align on direction.

## Branching Strategy

- Default branch: `main` (create it after first push if using a different remote default).
- Use topic branches named `feat/<summary>`, `fix/<summary>`, or `docs/<summary>`.
- Rebase on the latest `main` before opening a pull request to minimize conflicts.

## Development Checklist

- Run `npm run lint`, `npm run test`, and `npm run typecheck` from the repo root.
- For companion changes, ensure `npm run build -w companion` succeeds.
- Provide end-to-end notes when modifying native messaging or CDP behavior.
- Update relevant documentation (README, docs/usage.md) when user-facing behavior changes.

## Commit Guidelines

- Write concise, present-tense commit messages (e.g., `feat: add per-tab ignore toggle`).
- Group related changes into logical commits to ease reviews.
- Avoid committing generated artifacts (`extension/dist`, `companion/dist`) or OS-specific files.

## Pull Request Template

Include:

- Summary of changes.
- Testing performed (commands + outcomes).
- Screenshots or recordings for UI updates.
- Deployment considerations (native host, browser flags, etc.).

## Testing

- Unit tests: `npm run test` for extension, `npm run test -w companion` for companion.
- Manual verification: load `extension/dist` into Chrome and confirm baseline flows (consent, dashboard, reminder modal) still function.
- Optional: integrate Playwright-based smoke tests when available.

## Documentation Contributions

- Follow Markdown linting rules (blank lines around headings/lists, trailing newline).
- Keep ASCII text unless the existing document already uses extended characters.
- Link newly added documents from the README or appropriate index file.

## Release Process (Draft)

1. Bump versions in workspace `package.json` files.
2. Update `CHANGELOG.md` (to be added) with highlights and migration notes.
3. Run full QA checklist (`lint`, `test`, `typecheck`, manual run).
4. Tag the release and attach production `extension/dist` zip plus companion binaries if distributed.

Thank you for contributing to Sleepy Tabs Guardian!
