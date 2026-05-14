---
name: release-please-prs
description: Use when opening, editing, or retitling pull requests in borgiq-cli (including `gh pr create`, `gh pr edit --title`, PR title suggestions, and PR description drafts). This repo squash-merges PRs, so the PR title becomes the commit subject release-please parses on `main` — a non-conventional title silently breaks the next release's version bump and CHANGELOG.
---

# Opening PRs in borgiq-cli

> **The format itself lives in [docs/conventional-commit-format.md](../../../docs/conventional-commit-format.md).** Read that first for the type table, scope list, subject rules, examples, and anti-patterns. This skill only covers PR-specific guidance on top of the shared spec.

## Why PR titles matter so much in this repo

The repo squash-merges with "Pull request title and description" as the default commit message format. So when a PR merges:

- **PR title → squashed commit subject on `main`** (this is what release-please parses for `<type>(<scope>): <subject>`)
- **PR description → squashed commit body on `main`** (this is what release-please scans for `BREAKING CHANGE:` and `Refs:` footers)
- **Feature-branch commits → discarded** (release-please never sees them)

There is no fallback. If the PR title isn't a conventional commit, release-please ignores the change entirely — no version bump, no CHANGELOG entry.

## PR title

**The PR title must be a conventional commit by itself.** See [docs/conventional-commit-format.md](../../../docs/conventional-commit-format.md) for the full format. Quick reminders specific to PRs:

- Don't append `(#42)` — GitHub adds the PR number automatically to the squash commit subject in some configurations; never bake it into the title yourself.
- Don't prefix with `Draft:` or `WIP:` — use GitHub's "Mark as draft" button instead. A `WIP:` prefix breaks conventional-commit parsing.
- If your PR genuinely contains two unrelated changes that need different types (e.g. one `feat:` and one `fix:`), **split it into two PRs**. The squash collapses them into a single commit with a single type — you lose the granularity in the CHANGELOG.

## PR description (body)

The PR description ends up as the body of the squashed commit, which means release-please reads it for footers. Structure it like this:

```
## Summary
<1–3 bullets on what changed and why>

## Test plan
- [ ] <how you validated it>

<optional footers at the bottom>
BREAKING CHANGE: <description if applicable>
Refs: #123
```

Footers must be at the very end of the body, on their own lines, in the standard `Token: value` format. Don't bury them inside prose.

## `gh pr create` recipe

```bash
gh pr create \
  --title "feat(auth): add 'auth select' to set default org and workspace" \
  --body "$(cat <<'EOF'
## Summary
- Adds new `borgiq auth select` subcommand …
- Persists choice to `~/.config/borgiq/config.json`

## Test plan
- [ ] `borgiq auth select` interactive flow with multiple orgs
- [ ] Verifies `--org`/`--workspace` flags still override

Refs: #42
EOF
)"
```

Use a heredoc for the body so newlines and bullet points are preserved.

## Retitling an existing PR

If you realize the title is wrong before merge:

```bash
gh pr edit <PR#> --title "fix(client): retry 429s with exponential backoff"
```

Do this *before* the squash-merge. After merge, the squashed commit on `main` is what release-please reads — fixing the PR title retroactively does nothing.

## Edge cases

- **The release-please PR itself** is titled `chore(main): release X.Y.Z`. Never rewrite it — release-please uses this title to find its own PR on subsequent runs.
- **PRs that introduce *and* fix something in one go** (e.g. add a feature with a typo fixed in the same PR): use the higher-priority type. `feat:` outranks `fix:`. The fix-line goes in the body bullets.
- **Reverts**: GitHub auto-generates revert PR titles as `Revert "feat(auth): …"`. Edit the title to `revert(auth): drop 'auth select' command` (use a real conventional-commit `revert:` type if you want it in the changelog; otherwise leave it as `chore:` for silent reverts).
- **Dependabot / Renovate PRs**: configure those tools to emit conventional-commit titles (e.g. `chore(deps): bump …`). The default Dependabot format already uses `build(deps):` which is parseable.

## Don't

- Don't merge a PR with a non-conventional title — the change won't appear in the next release.
- Don't squash-merge by hand at the terminal (`gh pr merge --squash` is fine; doing it via `git merge --squash` locally and force-pushing main is not).
- Don't put `BREAKING CHANGE:` in the PR title body alone hoping it gets picked up — put it as a footer in the description.

## See also

- [docs/conventional-commit-format.md](../../../docs/conventional-commit-format.md) — the format spec (types, scopes, examples)
- `.claude/skills/release-please-commits/SKILL.md` — sibling skill for commits
- `CONTRIBUTING.md` — release process for humans
