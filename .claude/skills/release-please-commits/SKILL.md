---
name: release-please-commits
description: Use when writing commits or commit messages inside borgiq-cli. This repo publishes `@borgiq/cli` to npm via release-please, which parses conventional commits on `main` to decide version bumps and CHANGELOG entries. A wrongly-typed or vague commit silently produces a wrong version or omits the change from the changelog.
---

# Writing commits in borgiq-cli

> **The format itself lives in [docs/conventional-commit-format.md](../../../docs/conventional-commit-format.md).** Read that first for the type table, scope list, subject rules, examples, and anti-patterns. This skill only covers commit-specific guidance on top of the shared spec.

## What actually ends up on `main`

The repo is configured to **squash-merge** PRs with "Pull request title and description" as the default commit message. That means:

- The **only commit release-please sees** is the squashed commit on `main`.
- Its **subject = the PR title**.
- Its **body = the PR description**.
- Every intermediate commit you make on the feature branch is **discarded** by the squash.

Practical implication: **feature-branch commits don't need to be perfect.** Use them as save points. `wip`, `fix typo`, `address review`, `try again` — all fine. Don't waste effort polishing them.

What you *do* need to get right is **the PR title** (and the PR description, if it carries `BREAKING CHANGE:` or `Refs:` footers). For PR-creation guidance see the sibling `release-please-prs` skill.

## When to use a conventional commit message anyway

Two situations where the commit message *does* end up parsed:

1. **You're committing directly to `main`** (only release-please's own PRs do this — humans should never). Don't do this.
2. **You're amending or rewriting a PR's intermediate commit history** and your repo settings have drifted to allow merge commits or rebase-merge. If that happens, fix the repo settings rather than the commit message.

Otherwise, the *only* commit message that matters for release-please is the one GitHub generates from your PR title + description at squash time.

## Helping the PR title later

If you're committing on a feature branch, a useful habit:

- Make the **first commit's subject** read like the PR title you intend (e.g. `feat(auth): add 'auth select' command`). When you later open the PR, `gh pr create` will pre-fill the title from that commit subject — saving you from re-typing it.
- Put the *why* in that commit's body — same content you'd want in the PR description.

This is purely ergonomic; release-please doesn't care.

## Don't

- Don't write `chore: bump version` commits — release-please owns the version field in `package.json` and `.release-please-manifest.json`.
- Don't include `BREAKING CHANGE:` footers in feature-branch commits expecting them to survive — they get flattened into the squash body, which *can* be parsed, but it's fragile. Put the footer in the **PR description** instead, where it's authoritative.
- Don't run `git commit --amend` on commits already pushed to a shared branch.

## See also

- [docs/conventional-commit-format.md](../../../docs/conventional-commit-format.md) — the format spec (types, scopes, examples)
- `.claude/skills/release-please-prs/SKILL.md` — sibling skill for PR creation
- `CONTRIBUTING.md` — release process for humans
