# Contributing

## Release process

This repo uses [release-please](https://github.com/googleapis/release-please) to automate npm releases, with **[staged publishing](https://docs.npmjs.com/staged-publishing)** so every release waits for a human 2FA approval before it goes live. You never run `npm publish` — CI stages, a maintainer approves.

### How it works

1. You merge a PR into `main` with a **conventional commit** PR title (squash-merge — the PR title becomes the commit on `main`).
2. release-please notices the new commits and opens (or updates) a single **Release PR** titled `chore(main): release X.Y.Z`. It bumps `package.json`, regenerates `CHANGELOG.md`, and waits.
3. When that Release PR is merged, release-please tags the commit (`vX.Y.Z`) and the `publish` job runs `npm stage publish --provenance --access public`. This uploads the build (with provenance) to npm's **staging area** — **the version is not yet public** — and pings a BorgIQ webhook that posts a "staged, awaiting approval" message to Slack.
4. A maintainer reviews and **approves the staged release with 2FA** (see below). Only then does the version appear on npm's `latest` tag with the verified provenance badge.

> The GitHub OIDC token is scoped to staging only (`--allow-stage-publish`, not `--allow-publish`), so CI **cannot** publish a live version even if the workflow were changed — the approval gate is enforced by npm, not just convention.

### Approving a staged release

Once Slack says a release is staged, a maintainer with publish access + 2FA runs:

```bash
npm stage list "@borgiq/cli"   # find the pending stage id
npm stage view <stage-id>      # inspect metadata
npm stage download <stage-id>  # (optional) download and inspect the tarball
npm stage approve <stage-id>   # 2FA prompt -> goes live on `latest`
npm stage reject <stage-id>    # discard without publishing
```

### Release infrastructure prerequisites

These are one-time setup, not per-release. Documented here so they aren't lost:

- **npm trusted publisher** for `@borgiq/cli` configured with `--allow-stage-publish` **only** (not `--allow-publish`):
  `npm trust github "@borgiq/cli" --repo BorgIQ/borgiq-cli --file release.yml --allow-stage-publish`
- **Approver** account needs publish access + 2FA enabled (`npm stage approve` requires 2FA; staging does not).
- **BorgIQ notify canvas** deployed (webhook → HMAC verify → Slack `chat.postMessage`), with a workspace credential `release-webhook-signing-secret` and a Slack connection.
- **GitHub repo secrets:** `BORGIQ_RELEASE_WEBHOOK_URL` and `BORGIQ_RELEASE_WEBHOOK_SECRET` (the latter must equal the canvas's `release-webhook-signing-secret`).
- **Tooling floors:** npm ≥ 11.15.0 and Node ≥ 22.14.0 (CI forces `npm@latest` and uses `node-version: lts/*`, which satisfy both).

### Commit / PR title format

PR titles **are** the commits (because of squash-merge), so they must follow conventional-commit format. **The full spec lives in [docs/conventional-commit-format.md](docs/conventional-commit-format.md)** — types, scopes, subject rules, examples, anti-patterns, breaking-change syntax. Read that doc; this section won't duplicate it.

Quick reminders:
- Bug fix → `fix:` (patch bump). New feature → `feat:` (minor bump). Breaking change → `BREAKING CHANGE:` footer in PR description.
- Scope from `src/commands/<group>/` (`auth`, `canvases`, …) or cross-cutting (`client`, `output`, `lib`).
- Imperative mood, no trailing period, ≤ 72 chars.

### Don't

- Don't run `npm publish` locally. The only sanctioned manual release step is `npm stage approve <id>` (2FA) after CI has staged a release.
- Don't merge the Release PR with a custom commit message — keep `chore(main): release X.Y.Z` so release-please can find it next time.
- Don't merge-commit into `main` — squash-merge only (configured in repo settings).

## Branch model

- `main` is the only long-lived branch.
- Feature branches PR directly into `main`. No `development` branch.
- Squash-merge only. Merge commits and rebase-merges are disabled in repo settings.
- `main` is protected: required review, required status checks, no force-pushes.
