# Contributing

## Release process

This repo uses [release-please](https://github.com/googleapis/release-please) to automate npm releases. You don't run `npm publish` — the workflow does.

### How it works

1. You merge a PR into `main` with a **conventional commit** PR title (squash-merge — the PR title becomes the commit on `main`).
2. release-please notices the new commits and opens (or updates) a single **Release PR** titled `chore(main): release X.Y.Z`. It bumps `package.json`, regenerates `CHANGELOG.md`, and waits.
3. When that Release PR is merged, release-please tags the commit (`vX.Y.Z`) and the `publish` job runs `npm publish --provenance --access public`. The package appears on npm with a verified provenance badge.

### Commit / PR title format

PR titles **are** the commits (because of squash-merge), so they must follow conventional-commit format. **The full spec lives in [docs/conventional-commit-format.md](docs/conventional-commit-format.md)** — types, scopes, subject rules, examples, anti-patterns, breaking-change syntax. Read that doc; this section won't duplicate it.

Quick reminders:
- Bug fix → `fix:` (patch bump). New feature → `feat:` (minor bump). Breaking change → `BREAKING CHANGE:` footer in PR description.
- Scope from `src/commands/<group>/` (`auth`, `canvases`, …) or cross-cutting (`client`, `output`, `lib`).
- Imperative mood, no trailing period, ≤ 72 chars.

### Don't

- Don't run `npm publish` locally.
- Don't merge the Release PR with a custom commit message — keep `chore(main): release X.Y.Z` so release-please can find it next time.
- Don't merge-commit into `main` — squash-merge only (configured in repo settings).

## Branch model

- `main` is the only long-lived branch.
- Feature branches PR directly into `main`. No `development` branch.
- Squash-merge only. Merge commits and rebase-merges are disabled in repo settings.
- `main` is protected: required review, required status checks, no force-pushes.
