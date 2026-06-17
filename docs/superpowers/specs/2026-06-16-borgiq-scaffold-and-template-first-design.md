# Design: `borgiq scaffold` + template-first actor building

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — pending spec review
**Repos touched:** `borgiq-cli` (Part A), `borgiq-skills` (Part B)

## Problem

AI agents driving BorgIQ build integration actors (especially `HttpRequestActor`) by hand from the raw actor schema, and get them wrong — malformed `options`, missing/incorrect `sourcePorts`, wrong config-field encoding (YAML-string-in-JSON vs native object).

Two compounding gaps:

1. **No reliable scaffolding primitive.** The only scaffolding today is three shell scripts shipped inside the skill (`scaffold-actor.sh`, `scaffold-canvas.sh`, `scaffold-batch.sh`). `scaffold-actor.sh` hardcodes per-type `sourcePorts` and default `options` in bash — it drifts from the platform, covers only a hardcoded subset of types, and is brittle. The skill docs *also* reference a built-in `borgiq scaffold canvas` / `borgiq scaffold actor-from-template` subcommand that **does not exist** in the CLI (0.6.0) — so agents following the docs hit `error: unknown command 'scaffold'`.
2. **No template-first discipline.** The platform ships a catalog of vetted templates (e.g. Gmail, Slack, GitHub actions). The skill mentions searching it but buries the guidance and never makes it a *gate* before hand-building. Reusing a template is the highest-leverage way to avoid hand-building errors.

## Goal

- **Part A:** Ship a real `borgiq scaffold` command group that produces correct, platform-canonical actor/canvas/batch artifacts — schema-driven, no hardcoded per-type tables.
- **Part B:** Teach the `borgiq-builder` skill to **search the template catalog first** before building an `HttpRequestActor` (or any integration actor), and to convert a chosen template into a usable actor via `borgiq scaffold actor-from-template`. Fix the existing doc drift (`scaffold`, `credentials`) in the same pass.

Build order: **A then B** — the skill must point at commands that actually exist (do not re-introduce the drift we just found).

## Non-goals

- No test harness (repo has none; verification is `tsc` build + manual `--help`/output checks, matching repo convention).
- No changes to the platform API or actor schemas — the data already round-trips.
- No new offline per-type templates; canonical defaults come from the platform schema.

---

## Part A — `borgiq scaffold` CLI

New command group `src/commands/scaffold/` registered in `src/program.ts`, plus a pure helper lib `src/lib/scaffold.ts`. Four subcommands.

### Shared building blocks

- **ID/msgVar minting** reuses existing internals directly (no shelling out): `Id.create('ACTR')`, `Id.createShortId('SPRT')`, `Id.createRandomId('')` for webhook keys, and `convertActorNameToMsgVar(name)` from `src/lib/ids.ts`.
- **Config-field encoding** mirrors the platform's `importActor` (`borgiq-platform/packages/utils/src/canvas.ts`): a CanvasActor's `configuration.{credentials,inputs,vars,options,outputs,error}` and `schemas.{inputs,outputs}` are **YAML strings**, produced by `yaml.stringify(...)` of the corresponding native object (only when present).
- **Pure helpers** in `src/lib/scaffold.ts` so logic is testable without the API:
  - `buildCanvasActor(schema: BIQActorSchema, opts: { name: string; routes?: string[] }): CanvasActor`
  - `actorFromTemplate(templatePayload, opts): CanvasActor` (the `importActor` reshape + fresh ids + provenance)
  - `wrapCanvasEnvelope(actors, meta): ExportedCanvasData`
  - `wrapBatch(actors): { operations: [...] }`

### `scaffold actor --type <T> --name <n> [--routes a,b] [--output f] [--print-id]`

**Online** (needs auth/context, like other API commands). Flow:

1. `client.getActorSchema(type)` → `BIQActorSchema`.
2. `buildCanvasActor(schema, { name, routes })` produces a CanvasActor:
   - `id` = `Id.create('ACTR')`; `msgVar` = `convertActorNameToMsgVar(name)`.
   - `type`, `version: 1`, `name`, `description: ''`, `isActive: true`, `continueOnError: false`.
   - `enableLTM`/`enableSTM` ← `schema.enableLTM`/`schema.enableSTM`.
   - `sourcePorts` ← derived from `schema.sourcePorts`:
     - `none` → `[]`
     - `singleDefault` → `[{ id: 'SPRTdefault' }]`
     - `fixedMulti` → `schema.sourcePorts.fixedPorts` verbatim
     - `dynamic` → `fixedPorts` + one `Id.createShortId('SPRT')` port per `--routes` entry (e.g. RouterActor); error with guidance if `--routes` given but `canAddPorts` is false.
   - `configuration.options` ← `yaml.stringify(schema.defaultOptions ?? {})` (canonical defaults straight from the platform).
   - `configuration.code` ← language-appropriate stub **only when** `schema.code.supported` (TS vs Python from `schema.code.language`).
   - `webhookTriggerKey` ← `Id.createRandomId('')` when the type is a webhook trigger (detected via schema/type).
   - `schemas: {}`, `position: { x: 0, y: 0 }`, `edges: {}`.
3. Emit JSON to stdout or `--output <file>`. With `--print-id`, write the actor id to stdout and the JSON to the file (so `ID=$(borgiq scaffold actor … --output a.json --print-id)` composes), otherwise echo the id to stderr.

**Replaces** `scaffold-actor.sh` — for *every* actor type, with no hardcoded tables.

### `scaffold actor-from-template [--file <path>|stdin] [--name <n>] [--output f] [--print-id]`

**Offline transform.** Consumes a **`borgiq templates get <id> --json` payload** — a `BIQActorTemplateMetadata` envelope whose top level carries `id`, `version`, `appName` (and `appIcon`), and whose nested `actor` is in `ExportedCanvasActor` shape. Applies `actorFromTemplate`, which does **two** jobs (the platform splits these across `importActor` and the web layer; the CLI must do both):

1. **Config reshape** (mirrors `importActor`): `yaml.stringify` each present `configuration.*` field (`credentials`, `inputs`, `vars`, `options`, `outputs`, `error`) and `schemas.{inputs,outputs}` → YAML strings (CanvasActor shape).
2. **Identity**: mint a fresh `id` (`Id.create('ACTR')`); regenerate `webhookTriggerKey` if the template actor has one; set `msgVar` from `--name` (else the template/actor name).
3. **Template provenance** (see below): stamp the `template` block so the result is recognized as template-derived and the UI shows the app-type badge — exactly what the web canvas does.

Emit CanvasActor JSON (stdout/`--output`), id behavior same as `scaffold actor`.

**Makes real** the command the skill already documents.

#### Template provenance (the canonical form)

A canvas actor records its template origin in a single optional field on `BIQCanvasActor` (`borgiq-platform/packages/types/src/schemas/canvas.ts`):

```ts
template?: {
  id: string;       // the template id (BIQActorTemplateMetadata.id)
  version: number;  // template version in use (drives the "update available" check)
  appName: string;  // app the template belongs to — rendered as the node badge
}
```

The web layer sets this when a template is dropped on the canvas (`apps/web/src/lib/canvas.ts` `createReactFlowNodesAndEdgesFromActorTemplate`, ~line 610) by copying `{ id, version, appName }` straight off the `templates get` metadata. The node renders `template.appName` as an uppercase badge (`apps/web/src/features/editor/reactFlow/nodes/actorNode.tsx`, ~line 259), and `useCheckTemplate` uses `id`+`version` to flag out-of-date instances.

**`scaffold actor-from-template` therefore sets exactly:**

```jsonc
"template": { "id": <metadata.id>, "version": <metadata.version>, "appName": <metadata.appName> }
```

read from the **metadata envelope** (not the nested `actor`). This makes a CLI-created template actor byte-for-byte equivalent in provenance to a UI-dragged one — so the app-type badge, the version/update check, and "this came from app X" all light up. The reshape must **not** invent provenance for `scaffold actor` (the schema-driven, non-template command) — that actor has no `template` field.

#### Forward-looking: the logo (platform follow-up, not this CLI PR)

The user's end goal is for the **app logo** (and richer app-type treatment) to show on the placed node, not just the app name. Today that is **not possible from the CLI alone**: `BIQCanvasActor.template` has no `appIcon`, the zod object strips unknown keys on save, and `actorNode.tsx` shows only `appName` — the logo is rendered only in the template *palette*, pulled live from `BIQActorTemplateMetadata.appIcon` (`logos:slack`-style slug → `BIQIcon`). Enabling the logo on placed nodes is a **platform change** (add `appIcon` to the `template` schema → copy it in `canvas.ts` on create/update → render it on the node via `parseTemplateIcon` + `BIQIcon`), tracked separately.

This spec keeps the CLI **forward-compatible**: `scaffold actor-from-template` already has `metadata.appIcon` in hand, so once the platform schema accepts `appIcon`, populating it is a one-line addition to `actorFromTemplate`. Until then the CLI writes only the three fields the platform persists.

### `scaffold canvas --name <n> --slug <s> [--message-ttl <days>] [--file <actors.json>] [--output f]`

**Offline structural.** Wraps one or more CanvasActors (from `--file`, or empty) into the **ExportedCanvasData envelope** for `canvases create-with-data`:

```yaml
name: <n>
slug: <s>
messageTTLInDays: <days, default 7>
data:
  schemaVersion: "1"
  actors: { <id>: <actor>, ... }
```

Accepts a single actor object, an array of actors, or an `{ actors: {...} }` map in `--file`. Emits JSON (or YAML with `--yaml`, matching how the CLI accepts both). **Replaces** `scaffold-canvas.sh`.

### `scaffold batch [--file <actors.json>] [--output f]`

**Offline structural.** Wraps actor(s) into the operations envelope for `canvas-actors batch`:

```json
{ "operations": [ { "type": "add", "actorId": "<id>", "timestamp": <ms>, "data": <actor> } ] }
```

`timestamp` = `Date.now()` per op. **Replaces** `scaffold-batch.sh`.

### Error handling

- Unknown `--type` → `CliUsageError` listing valid types (hint to run `borgiq actors list`), exit code 2.
- Malformed template/actor input (bad JSON, missing `actor`/`configuration`) → clear message via existing `handleError` + exit-code map.
- `--routes` on a non-dynamic actor → usage error explaining the type doesn't support added ports.
- Online `scaffold actor` 401 → existing auth handling ("run `borgiq auth login`").

### CLI help

Each subcommand gets an `addHelpText('after', …)` `Examples:` block (consistent with PR #31), e.g. the end-to-end `templates get … | scaffold actor-from-template … | canvas-actors create …` chain.

---

## Part B — skill: template-first actor building

In `borgiq-skills/plugins/borgiq-builder/skills/borgiq-builder`:

### Behavior change

Add a **gate before building an `HttpRequestActor`** (and, by extension, any third-party integration actor): the agent must first search the template catalog and prefer adapting a template over hand-building.

Workflow the skill prescribes:

1. **Search apps** — run a few vendor queries (the user's example): `borgiq templates apps --search "google"`, `… --search "gmail"`. Collect candidate app ids (`TAPP…`).
2. **List templates** for a chosen app: `borgiq templates list --app-id TAPP… --json` (paginates/sorts per PR #31).
3. **Get the template**: `borgiq templates get ATMP… --json`.
4. **Convert to a usable actor**: pipe into `borgiq scaffold actor-from-template` → CanvasActor.
5. **Add it**: `borgiq canvas-actors create … --file actor.json` (or `batch`).
6. **Fallback**: only hand-build (`scaffold actor --type HttpRequestActor`, then edit) if no template fits.

### Doc edits

- **`SKILL.md`**: elevate the buried "Check the template catalog first" block into an explicit gate at the point where HTTP/integration actors are introduced (the actor-selection guidance, not only the CLI-deploy section). Cross-link from the HTTP/integration sections.
- **`references/http-request-actor.md`**: add a top-of-file "Before you build: check the catalog" note with the workflow, so the rule is found wherever an agent starts.
- **`references/borgiq-cli.md` + `references/cli/cli-setup-scripts.md` + `references/cli/cli-command-reference.md`**: repoint `borgiq scaffold *` references at the now-real commands; remove/soften the "shell helpers are a fallback" framing (the built-ins are now canonical). The `scaffold-*.sh` scripts can remain as a no-API fallback but are no longer the primary path.
- **Drift fix (same pass):** replace `borgiq credentials list` with `borgiq connections list` + `borgiq secrets list` wherever it appears.

### Sync note

`scripts/sync_platform_refs.py` does not sync from `borgiq-cli`, so these CLI-facing docs are hand-maintained — this spec is the source of truth for the edits.

---

## Data shapes (reference)

- **`BIQActorSchema`** (`src/client/types.ts`): `optionsSchema`, `defaultOptions`, `sourcePorts: { type: 'none'|'singleDefault'|'fixedMulti'|'dynamic'; fixedPorts: {id,name?}[]; canAddPorts }`, `code: { supported; language: 'typescript'|'python'|null }`, `enableLTM`, `enableSTM`, `supportsConnection`, `canReceiveMessage`, `canEmitMessage`.
- **CanvasActor** (target): `{ type, version, name, msgVar, description, isActive, continueOnError, enableLTM, enableSTM, sourcePorts, configuration: { options: <yaml str>, code?, inputs?, … }, schemas: {}, position, edges, webhookTriggerKey?, template? }`.
- **`BIQCanvasActor.template`** (`borgiq-platform/packages/types/src/schemas/canvas.ts`): `{ id: string; version: number; appName: string }`, optional — the only persisted template-provenance field. Set by the web layer from `templates get` metadata; read by `actorNode.tsx` (badge) and `useCheckTemplate` (version check).
- **`BIQActorTemplateMetadata`** (`templates get` envelope): top-level `id`, `version`, `appName`, `appIcon?`, plus nested `actor: ExportedCanvasActor`. Provenance is read from the envelope; config reshape operates on `actor`.
- **`importActor`** (`borgiq-platform/packages/utils/src/canvas.ts`): YAML-stringifies each present `configuration.*` and `schemas.*` field — the canonical Exported→Canvas conversion `actor-from-template` mirrors (it does **not** set `template`; the web layer does — the CLI does both).

## Verification

- `npm run build` (tsc strict) green.
- `borgiq scaffold --help` and each subcommand `--help` render; `Examples:` blocks present.
- `borgiq scaffold actor --type HttpRequestActor --name X` against a live API yields a CanvasActor whose `options` matches the platform `defaultOptions` and whose `sourcePorts` match the schema.
- `borgiq templates get … --json | borgiq scaffold actor-from-template --name Y` yields a CanvasActor with YAML-string config fields, a fresh id, and a `template: { id, version, appName }` block matching the source metadata — and, after `canvas-actors create`, the node shows the app-type badge in the UI exactly like a dragged-in template actor.
- `scaffold canvas`/`batch` outputs deploy cleanly via `canvases create-with-data` / `canvas-actors batch`.
- Skill: an agent reading `SKILL.md`/`http-request-actor.md` is gated to the catalog search first; every referenced `borgiq …` command exists.
