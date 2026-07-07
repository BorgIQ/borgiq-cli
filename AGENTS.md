# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, OpenAI Codex, etc.) when working with code in this repository.

## Overview

`borgiq-cli` is the official command-line interface for the BorgIQ workflow automation platform. It talks to the BorgIQ API over HTTPS to manage canvases, actors, flow runs, connections, secrets, and more.

This repo is fully standalone: it has no npm dependencies on other BorgIQ packages, defines its own API request/response types in `src/client/types.ts`, and needs no other services running locally to build (only for runtime API calls against a live BorgIQ instance).

## Development Environment Setup

**Prerequisites:**
- Node.js >=22.0.0
- npm (used for all dependency management)

**Initial Setup:**
```bash
npm install
npm run build
```

**Development mode (uses tsx for live TypeScript execution):**
```bash
npm run dev -- <command> [options]
# Example: npm run dev -- canvases list
```

**Production build:**
```bash
npm run build    # Compiles TypeScript to dist/
npm run clean    # Removes dist/
```

## Core Development Commands

```bash
npm run build         # TypeScript compilation (tsc) to dist/
npm run dev           # Run CLI via tsx (no build step needed)
npm test              # Run Vitest tests
npm run clean         # Remove dist/ directory
```

There is **no linter or formatter** configured in this repo currently. Tests run with Vitest.

## Architecture Overview

### Project Structure

```
src/
├── index.ts              # Entry point (#!/usr/bin/env node shebang)
├── program.ts            # Commander.js program setup, global options, command registration
├── client/
│   ├── index.ts          # BorgIQClient class — all API methods (~370 lines)
│   ├── types.ts          # TypeScript interfaces for API requests/responses
│   └── errors.ts         # ApiError class (status, message, field details)
├── commands/             # One directory per command group
│   ├── auth/             # login, logout, status
│   ├── orgs/             # list
│   ├── workspaces/       # list
│   ├── actors/           # list, schema
│   ├── canvases/         # list, get, create, update, delete, export, validate, layout, etc.
│   ├── bundle/           # init, unpack, pack, validate, pull, push - canvas bundle folders (BORG-565)
│   ├── canvas-actors/    # list, get, flow, verify, create, update, delete, batch
│   ├── flowruns/         # list, get, status, summary, interrupt
│   ├── flowrun-jobs/     # list, test-run, re-run, runtime-data, ai-timeline, source-message
│   ├── flowrun-results/  # summaries, data
│   ├── flowrun-messages/ # list, data
│   ├── triggers/         # run
│   ├── connections/      # list, types, delete
│   ├── secrets/          # list, delete
│   ├── assets/           # list, delete
│   └── tokens/           # list, create, revoke
├── config/
│   └── index.ts          # Config file management (~/.config/borgiq/config.json)
├── lib/
│   ├── context.ts        # Auth & context resolution (CLI flags → env vars → config file)
│   ├── bundle/           # Pure canvas bundle compiler core (no fs/network)
│   ├── bundleFs.ts       # Canvas bundle filesystem read/write helpers
│   ├── errors.ts         # Global error handler (handleError)
│   └── input.ts          # JSON/YAML input from --file or stdin
└── output/
    ├── index.ts          # Smart output dispatcher (table for TTY, JSON for pipes)
    ├── table.ts          # ASCII table formatter with dynamic column widths
    └── json.ts           # Pretty-printed JSON output
```

### CLI Framework

- **Commander.js** (`commander@^12`) — command parsing, options, help generation
- Root command: `borgiq`
- Global options available on all commands:
  - `--api-url <url>` — Override API URL
  - `--token <token>` — Override API token
  - `--org <org>` — Organization slug or ID
  - `--workspace <workspace>` — Workspace slug or ID
  - `--json` — Force JSON output (default for non-TTY)

### Command Pattern

Each command group follows this pattern:

1. **`commands/<group>/index.ts`** — Exports `register*Commands(program: Command)` that defines the command group and its subcommands
2. **`commands/<group>/<action>.ts`** — Each subcommand handler is an async function receiving parsed options + Commander `this` context
3. Handlers call `createClientWithContext()` to get an authenticated API client
4. Results are passed to `outputResult()` or `outputPaginatedResult()` for smart formatting

When adding a new command:
1. Create a new directory under `src/commands/`
2. Add an `index.ts` with a `register*Commands` export
3. Register it in `src/program.ts` alongside existing command groups
4. Add corresponding API methods to `src/client/index.ts` if needed
5. Add types to `src/client/types.ts`

### API Client

- **`src/client/index.ts`** — `BorgIQClient` class with methods for every API endpoint
- Uses **native `fetch()`** (Node.js 22+ built-in) — no third-party HTTP libraries
- Authentication: `Authorization: Bearer <token>` header
- All methods are async, return typed responses
- Error responses throw `ApiError` with status code, message, and field-level details

### Authentication & Configuration

**Resolution priority** (highest to lowest):
1. CLI flags (`--token`, `--api-url`, `--org`, `--workspace`)
2. Environment variables (`BORGIQ_API_TOKEN`, `BORGIQ_API_URL`, `BORGIQ_ORG`, `BORGIQ_WORKSPACE`)
3. Config file (`~/.config/borgiq/config.json`)

**Environment variables:**
- `BORGIQ_API_URL` — API base URL
- `BORGIQ_API_TOKEN` — Authentication token
- `BORGIQ_ORG` — Default organization
- `BORGIQ_WORKSPACE` — Default workspace
- `BORGIQ_CONFIG_DIR` — Override config directory path

**Config file:**
- Default location: `~/.config/borgiq/config.json` (XDG-compliant)
- Stored with `0600` permissions (owner-only read/write)
- Managed by `borgiq auth login` / `borgiq auth logout`

### Output System

- **TTY detection:** Tables for interactive terminals, JSON for piped/non-interactive output
- `--json` flag forces JSON output regardless of TTY
- Table formatter: ASCII tables with dynamic column widths and Unicode separators
- Paginated API responses are automatically handled

### Input Handling

- JSON and YAML input accepted via `--file <path>` (format detected by file extension: `.yaml`/`.yml` for YAML, all others as JSON)
- Piped stdin is always parsed as JSON
- `src/lib/input.ts` handles reading, format detection, and parsing with clear error messages

## Packaging & Distribution

- **npm package:** `@borgiq/cli` (scoped under `@borgiq`)
- **Binary name:** `borgiq` (defined in `package.json` `bin` field)
- **Entry point:** `./dist/index.js` (compiled from TypeScript)
- **Published files:** `dist/**` and `README.md` only (via `files` field)
- **Node.js requirement:** >=22.0.0 (for native `fetch()` support)
- **Runtime dependencies:** `commander@^12`, `yaml` (YAML parser)

**Releases are automated with a human approval gate.** See `CONTRIBUTING.md` for the release-please + staged-publishing flow. Do not run `npm publish` locally — after the release-please PR is merged, the `release.yml` GitHub Action runs `npm stage publish` (staging only; CI's OIDC token can't publish live) and pings a BorgIQ webhook → Slack. A maintainer then approves with `npm stage approve <id>` (2FA) to make the version live. PR titles must be valid conventional commits (see the `release-please-commits` skill).

## Key Conventions

- **ES Modules:** `"type": "module"` — all imports use `.js` extensions (even for `.ts` source files)
- **No bundler:** Plain `tsc` compilation to `dist/` — no webpack, esbuild, or rollup
- **Minimal dependencies:** Only `commander` and `yaml` as runtime dependencies; everything else uses Node.js built-ins
- **Async/await:** All command handlers and API methods are async
- **Error handling:** All errors funnel through `handleError()` in `src/lib/errors.ts` with special handling for 401, 403, 429
- **TypeScript strict mode:** Enabled in `tsconfig.json`
