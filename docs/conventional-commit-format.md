# Conventional commit format

This document is the single source of truth for the conventional-commit format used in `borgiq-cli`. It is referenced by both `CONTRIBUTING.md` (human-facing) and the `release-please-commits` and `release-please-prs` skills (Claude-facing). Update this file and both skills automatically inherit the change.

The format matters because [release-please](https://github.com/googleapis/release-please) parses commits on `main` to decide the next version and generate the `CHANGELOG.md`. Because the repo squash-merges PRs (with "Pull request title and description" as the default commit message), **the squashed commit on `main` is what release-please sees** — its subject is the PR title and its body is the PR description. Intermediate feature-branch commits are discarded by the squash.

## Format

```
<type>(<optional scope>): <imperative subject>

<optional body explaining why>

<optional footers, e.g. BREAKING CHANGE: …, Refs: #123>
```

## Types and what they trigger

| Type | Bump (pre-1.0) | Bump (1.0+) | CHANGELOG section |
|---|---|---|---|
| `feat` | minor | minor | **Features** |
| `fix` | patch | patch | **Bug Fixes** |
| `perf` | patch | patch | **Performance Improvements** |
| `refactor` | none | none | **Refactors** |
| `feat!` / `fix!` / `BREAKING CHANGE:` footer | minor (pre-1.0 quirk) | major | **Breaking Changes** (highlighted) |
| `docs`, `chore`, `test`, `ci`, `build`, `style` | none | none | hidden |

> **Pre-1.0 quirk:** `bump-minor-pre-major: true` in `release-please-config.json` means breaking changes bump the minor while the package is still `0.x.y`. When `1.0.0` ships, drop that flag and `feat!:` starts bumping the major.

## Scopes

Use these consistently so the CHANGELOG groups well:

- **Command groups** (one per `src/commands/<group>/`): `auth`, `canvases`, `flowruns`, `flowrun-jobs`, `flowrun-results`, `flowrun-messages`, `canvas-actors`, `connections`, `secrets`, `assets`, `tokens`, `orgs`, `workspaces`, `actors`, `triggers`
- **Cross-cutting code**: `client`, `output`, `config`, `lib`, `program`
- **Repo plumbing**: `deps`, `ci`, `build`

Omit the scope only for truly repo-wide changes.

## Subject line rules

- Imperative mood: `add`, `fix`, `drop` — not `added`, `fixed`, `drops`.
- No trailing period.
- ≤ 72 chars total including `type(scope):`.
- Don't repeat the type in the subject (`feat: feat add X` is wrong).
- Don't prefix with `WIP:` or `Draft:` — those don't parse as conventional commits and release-please ignores them.

## Body and footers

Use the body to explain **why**, not what (the diff shows what). Footers go at the bottom:

- `BREAKING CHANGE: <description>` — forces a breaking-change bump and a highlighted CHANGELOG entry. Use when removing a flag, changing a default, or altering output users may parse. Put this in the body/footer, not the subject (or use `feat!:` in the subject if you want both).
- `Refs: #123` or `Fixes: #123` — issue link.
- `Reviewed-by: …`, `Co-authored-by: …` — standard.

## Good examples (drawn from this repo)

✅ `feat(auth): add 'auth handoff-url' command for headless browser auth`
- `feat` → minor bump; `auth` scope groups with other auth commits; subject describes the user-facing change.

✅ `fix(client): retry 429 responses with exponential backoff`
- `fix` → patch bump; reader of CHANGELOG immediately knows what was broken.

✅ `feat(auth)!: drop legacy --token-file flag` with body footer `BREAKING CHANGE: --token-file removed; use --token or BORGIQ_API_TOKEN`
- `!` + footer makes the breaking change unmissable.

## Anti-patterns

❌ `Fix login bug` — not a conventional commit. release-please won't bump or list it.
❌ `chore: bump version to 0.3.0` — release-please owns versioning. Don't hand-bump.
❌ `feat: Various improvements to auth` — vague subject. Future-you reading the CHANGELOG will hate this.
❌ `Merge branch 'feature/x' into main` — squash-merge is configured, you shouldn't see these. If you do, the repo settings drifted.
❌ `feat(auth): added 'auth select' command` — past tense; use imperative `add`.
❌ `WIP: feat(auth): add ...` — `WIP:` prefix breaks parsing. Mark the PR as draft via GitHub UI instead.

## When in doubt — which type?

- Bug or regression fix? → `fix:`
- New user-visible capability? → `feat:`
- Internal refactor with no behavior change? → `refactor:` (no bump)
- Doc-only change? → `docs:` (no bump, hidden from changelog)
- Touching only `.github/`, scripts, or workflow? → `ci:` or `build:`
- Removing or changing a flag/env var/exit code/output format? → add `!` and a `BREAKING CHANGE:` footer

## Working with the Release PR

release-please opens a PR titled `chore(main): release X.Y.Z`. Don't rewrite the title — it's load-bearing (release-please looks for it on subsequent runs). Review the generated `CHANGELOG.md` entry. If a commit landed with the wrong type and the CHANGELOG looks off, the cleanest fix is a follow-up PR with the corrected message; rewriting history on `main` is not allowed by branch protection.

## Related files

- `release-please-config.json` — type-to-section mapping and bump rules
- `.release-please-manifest.json` — current released version (do not edit by hand)
- `.github/workflows/release.yml` — the publish workflow
- `CONTRIBUTING.md` — release process overview for humans
- `.claude/skills/release-please-commits/SKILL.md` — Claude guidance when writing commits
- `.claude/skills/release-please-prs/SKILL.md` — Claude guidance when opening PRs
