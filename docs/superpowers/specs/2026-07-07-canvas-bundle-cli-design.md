# Canvas Bundle CLI — Design Spec

- **Date:** 2026-07-07
- **Updated:** 2026-07-08 — incremental sync is now the **default** `push`/`pull` behavior; whole-document import/rewrite moved behind flags (see [Incremental sync](#incremental-sync-default-push-pull-behavior))
- **Status:** Approved design, pre-implementation
- **Ticket:** [BORG-565 — Add Canvas Bundle zip export format for large workflows](https://linear.app/borgiq/issue/BORG-565/add-canvas-bundle-zip-export-format-for-large-workflows)
- **Repo:** `borgiq-cli` only — **zero platform changes**

## Summary

Implement the BORG-565 Canvas Bundle v1 format entirely in the CLI as a deterministic, bidirectional compiler between the platform's existing single-document canvas export (`{metadata, data}` YAML) and an expanded filesystem bundle designed for git and coding agents. The platform is untouched: the CLI uses the existing `exportData`, `createCanvasWithData`, and `importCanvasData` endpoints as transport, and does all disassembly/assembly locally. Incremental sync (the default `push`/`pull` behavior) additionally uses the existing per-actor endpoints — `batchActorOperations` and `updateCanvas` — to apply only what changed.

```
platform export YAML  ──unpack──►  <slug>.borgiq-canvas/   (git, AI editing)
platform export YAML  ◄──pack───   <slug>.borgiq-canvas/
```

Both directions are pure functions of their input: same input bytes → same output bytes, 100% of the time.

## Goals

1. `canvas.yaml` export document → filesystem bundle (**unpack**), and bundle → export document (**pack**), lossless and deterministic.
2. Bundle folder layout byte-compatible with the BORG-565 v1 spec, so a future platform-side implementation reads/writes the same format.
3. `init` command producing an offline starter bundle suitable for checking into git.
4. Strict, file-path-scoped validation so hand/AI edits fail loudly and precisely.
5. Round-trip and determinism guarantees enforced by tests (first test suite in this repo).

## Non-goals (v1)

- Zip pack/unpack (git is the transport; the folder is the canonical artifact).
- Per-actor checksums in the root index (see Deviations).
- Dev-config emission (`code/deno.json`, type stubs) and `bundle dev-setup` bootstrap materialization.
- Multi-file actor code.
- ~~Two-way sync/merge, partial actor import~~ — *promoted into scope 2026-07-08 as [Incremental sync](#incremental-sync-default-push-pull-behavior)*. Still out: three-way content merge *within* a single actor (sync resolves at whole-actor granularity).
- Externalizing AI prompts, interface `options.page` trees, or `schemas.*` into sidecar files.
- Any change to `borgiq-platform`.

## Background: the platform contract the compiler targets

- `GET .../canvases/:id/exportData` returns `{ yaml, errors }` where `yaml` is one document: `metadata:` (id, slug, name, description, tags, imagePath, messageTTLInDays, runtimeSlug) + `data:` (`ExportedCanvasData` = `{ schemaVersion, actors: Record<actorId, ExportedCanvasActor> }`).
- Exported actors carry parsed-object forms of the 8 internally-YAML-string fields (`configuration.credentials|inputs|vars|options|outputs|error`, `schemas.inputs|outputs`). `configuration.code` stays a raw string. Export spreads `...actor`, so unrecognized fields pass through.
- Edges are a `Record<edgeId, edge>` on the **source actor**; `position` is per-actor. There is no global graph object — the bundle's root `graph` is a projection the compiler owns.
- Import endpoints: `POST .../canvases/data` (create, body `{name, slug, description?, tags?, messageTTLInDays, runtimeSlug?, data}`) and `POST .../canvases/:id/import` (body `{canvas: ExportedCanvasData, mode: merge|insert|replace}`). Both already exist in the CLI client.
- Credentials entries are `Record<name, { type?, workspaceKey, source?: 'secret' | 'connection' }>`; `configuration.connection` is `{ type?, key? }` (verified against `packages/types/src/schemas/canvas.ts` and the orchestrator dependency walk).
- **Per-actor mutation API (used by sync; already in the CLI client):** `PATCH .../canvases/:id/actors` (`batchActorOperations`) takes `{ operations: BatchActorOperation[] }` where each op is `{ type: 'add' | 'update' | 'remove', actorId, timestamp, editVersion?, data? }` and returns `{ appliedOperations, conflicts, updatedAt }`. Operation `data` is CanvasActor mutation shape, so selected configuration/schema fields (`configuration.credentials|inputs|vars|options|outputs|error`, `schemas.inputs|outputs`) are YAML strings, even though bundles store exported parsed-object shape. Single-actor `createCanvasActor` / `updateCanvasActor` / `deleteCanvasActor` also exist (client-minted `ACTR…` ids are accepted on create). `PUT .../canvases/:id` (`updateCanvas`) updates canvas metadata.
- **Optimistic concurrency:** the platform stores a separate per-actor `editVersion`, exposed by `GET .../canvases/:id?includeData=true` as `actorVersions`. This is not the exported actor's `version` field. Update/remove operations accept `editVersion`; a stale `editVersion` lands the op in the response's `conflicts[]` instead of applying. Pull/refresh writes those edit versions into `canvas.yaml` under `sync.actorVersions`.

## Bundle format

### Naming

- Expanded folder: `<canvas-slug>.borgiq-canvas/` (the git artifact).
- No zip in v1.

### Root `canvas.yaml` (authoritative)

```yaml
format: borgiq.canvas.bundle
formatVersion: 1
canvas:
  id: CNVS…            # informational; ignored by platform import
  slug: invoice-router
  name: Invoice Router
  description: Routes invoices to approval systems.
  tags: ''
  imagePath: null       # informational; ignored by platform import
  messageTTLInDays: 30
  runtimeSlug: ''
  schemaVersion: '1'    # maps to data.schemaVersion on pack
graph:
  nodes:                # sorted by actorId
    - actorId: ACTR…
      position: { x: 120, y: 240 }
  edges:                # sorted by edge id
    - id: EDGE…
      sourceActorId: ACTR…
      sourcePortId: SPRT…
      targetActorId: ACTR…
      targetPortId: TPRT…
      label: approved   # optional; omitted when absent
      type: borgiqEdge
dependencies:           # informational projection; regenerated on pack
  runtimes: []          # distinct non-empty runtimeSlug values (canvas + actors)
  connections:          # from configuration.connection.key + credentials with source: connection
    - workspaceKey: slack-prod
      referencedBy: [ACTR…]
  secrets:              # credentials entries with source != 'connection'
    - workspaceKey: openai-api-key
      referencedBy: [ACTR…]
exportErrors: []        # per-actor errors from the export envelope (pull); informational
warnings: []            # generated notes, e.g. webhook/scheduled triggers need target env setup
sync:                   # CLI-owned sync metadata; omitted from packed canvas exports
  actorVersions:
    ACTR…: 12           # platform canvasActor.editVersion from getCanvas(...includeData)
actors:                 # authoritative index, sorted by path
  - id: ACTR…
    type: HttpRequestActor
    name: Send Slack message
    path: actors/tasks/http-request/ACTR…
```

Rules (per BORG-565):

- `canvas.yaml` is authoritative: pack reads actor paths from `actors[]`, never by scanning the tree.
- `graph` is authoritative for edges and positions — actor folders contain neither.
- `dependencies`, `exportErrors`, `warnings`, and `sync` are informational for pack; pack ignores their content when emitting `{metadata, data}`. Pull/push refresh regenerates `sync.actorVersions` from the platform.
- Adding an actor by hand requires three edits: the actor folder, an `actors[]` entry, and a `graph.nodes` entry. Validation reports each miss precisely.

### Actor path registry (exhaustive, compile-time)

`Record<BIQActorType, BundlePathSpec>` over all 30 types — adding a type without a bundle path is a TypeScript error. Categories verified against `borgiq-platform/actors/{trigger,task,other}/`:

| Category (9/19/2) | Type → folder | Code entrypoints |
|---|---|---|
| triggers | AppTriggerActor → `app` | `index.html`, `styles.css`, `script.js` (from `options.html/css/script`) |
| triggers | ButtonTriggerActor → `button` | — |
| triggers | CallableTriggerActor → `callable` | — |
| triggers | EmailTriggerActor → `email` | — |
| triggers | InterfaceTriggerActor → `interface` | — |
| triggers | McpServerActor → `mcp-server` | — |
| triggers | ScheduledTriggerActor → `scheduled` | — |
| triggers | UniversalTriggerActor → `universal` | `mod.ts` (from `configuration.code`) |
| triggers | WebhookTriggerActor → `webhook` | — |
| tasks | AgentHarnessActor → `agent-harness` | — |
| tasks | AiActor → `ai` | — |
| tasks | AiAgentActor → `ai-agent` | — |
| tasks | AiRouterActor → `ai-router` | — |
| tasks | CallFlowActor → `call-flow` | — |
| tasks | CallableResponseActor → `callable-response` | — |
| tasks | CollectionActor → `collection` | — |
| tasks | DataStoreActor → `data-store` | — |
| tasks | DenoActor → `deno` | `mod.ts` |
| tasks | DenoTestActor → `deno-test` | `mod.ts` |
| tasks | DeprecatedAiAgent → `deprecated-ai-agent` (+ warning) | — |
| tasks | HttpRequestActor → `http-request` | — |
| tasks | InterfaceActor → `interface` | — |
| tasks | InterfaceStatusActor → `interface-status` | — |
| tasks | MessageProcessorActor → `message-processor` | — |
| tasks | PythonActor → `python` | `mod.py` (from `configuration.code`) |
| tasks | RouterActor → `router` | — |
| tasks | SendEmailActor → `send-email` | — |
| tasks | WebhookResponseActor → `webhook-response` | — |
| other | CommentActor → `comment` | — |
| other | EchoActor → `echo` | — |

Actor folder path: `actors/<category>/<folder>/<ACTOR_ID>/`. `triggers/interface` and `tasks/interface` do not collide (different categories).

### `actor.yaml`

Everything about the actor except edges, position, and externalized code. Canonical top-level key order: `id, version, type, name, msgVar, description, isActive, sourcePorts, template, icon, continueOnError, enableLTM, enableSTM, showInWorkspaceApps, runtimeSlug, webhookTriggerKey, configuration, schemas`, then any unknown fields alphabetically. `configuration` key order: `connection, webhook, schedule, aiAgentToolActorIds, credentials, codeDir, code, inputs, vars, options, outputs, error`, then unknown alphabetically. Absent optional fields are omitted (not emitted as `null`).

**Preservation rule:** the compiler transforms only what it must — lift `edges`/`position`, externalize code fields — and passes every other field through verbatim, including fields it does not recognize (e.g. `webhookTriggerKey`, future platform additions). This is what makes the round trip lossless against a platform that spreads `...actor` on export.

### codeDir contract (per BORG-565, unchanged)

- Code-heavy actors get `configuration.codeDir: code` in `actor.yaml`; the inline field (`configuration.code`, or app `options.html|css|script` when they are inline strings) is removed and written to `code/<entrypoint>` byte-verbatim (no newline normalization — content is user data).
- App actor fields that are BIQFile references (objects, not strings) stay inline in `actor.yaml`; no `code/` file is emitted for that field. If no app field is an inline string, there is no `code/` dir and no `codeDir`.
- `codeDir` must equal `code`; any other value is a validation error.
- `code/` may contain exactly the canonical entrypoint(s) for the type — anything else is an error stating multi-file actor code is not yet supported. Reserved names (`server.ts`, `handler.ts`, `actor.ts`, `deno.jsonc`, `deno.lock`, `mod_test.ts`, `shared/`) are called out specifically.
- Dual source (`codeDir` present *and* inline code field present) hard-fails.
- On pack, entrypoint contents are read back into `configuration.code` / `options.html|css|script`; `codeDir` never appears in pack output.
- An actor whose type supports code but has no code field (undefined) gets no `code/` dir; an empty-string code field gets an empty entrypoint file (distinct cases, both round-trip).

### Unknown actor types

Both directions fail with a clear, actionable error (`Unknown actor type 'X' — this CLI version does not support it; upgrade @borgiq/cli`). No path guessing, no partial output. This keeps the "predictable 100% of the time" contract; the registry is expected to track platform releases.

## Determinism

Guarantees, enforced by tests:

1. **Pack is deterministic:** packing an unchanged bundle twice yields byte-identical output.
2. **Unpack∘pack is identity on bundles:** `unpack(pack(dir)) == dir` byte-for-byte over managed paths, for a bundle the CLI wrote whose `exportErrors` is empty. Exception, by construction: the packed `{metadata, data}` document has no channel for `exportErrors`, so re-unpacking a bundle with export errors resets that one field to `[]` (pack warns when this happens). Everything else — including regenerated `dependencies` and `warnings` — reproduces exactly.
3. **Pack∘unpack is semantically lossless:** `pack(unpack(yaml))` parses to a deeply-equal `{metadata, data}` value as the input document (byte equality with platform output is *not* claimed — the platform uses js-yaml with different formatting).

Mechanics:

- Serializer: the already-pinned `yaml@2.9.0`, wrapped in one helper (`src/lib/bundle/yaml.ts`) with fixed options: `lineWidth: 0` (never fold long lines — prompts and URLs stay on one line), literal block scalars for multiline strings (git-diffable), default quoting (the library already quotes strings that would parse as other scalar types).
- Canonical key ordering applied by rebuilding objects in spec order before stringify (known fields in fixed order, unknown fields alphabetical). Inside user payloads (`options`, `inputs`, `vars`, `outputs`, `error`, `schemas.*`, `credentials` values), document/insertion order is preserved — the author's order is intent, and preserving it is still deterministic.
- Projection ordering: `actors[]` by `path`, `graph.nodes` by `actorId`, `graph.edges` by `id`, `dependencies.*` by `workspaceKey` with sorted `referencedBy`.
- Every generated text file ends with exactly one newline; `code/` files are byte-verbatim (exempt).
- No timestamps or other volatile fields anywhere in generated output.

## Commands

New group `borgiq bundle`, registered in `src/program.ts` following the existing command pattern.

| Command | Behavior |
|---|---|
| `bundle init <dir> [--name] [--slug]` | Offline. Creates a starter bundle (see Init template). Name/slug default from the directory basename (`.borgiq-canvas` suffix stripped). Refuses a non-empty directory. |
| `bundle unpack <file\|-> <dir> [--force]` | Reads a raw `{metadata, data}` YAML doc **or** the `{yaml, errors}` JSON envelope from `canvases export --json` (auto-detected; stdin with `-`). Disassembles into `<dir>`. |
| `bundle pack <dir> [-o <file>] [--strict]` | Validates (errors fatal; warnings to stderr, fatal only with `--strict`), assembles, emits the `{metadata, data}` YAML document to stdout or `-o`. Output is directly consumable by `canvases create-with-data` / `update-data` / `verify-import`. |
| `bundle validate <dir> [--strict]` | Assembles without writing; reports all errors and warnings with bundle-relative file paths. Warnings are non-fatal by default; `--strict` makes them fatal. Exit code reflects the result. |
| `bundle pull <canvas> [dir] [--replace] [--force] [--dry-run]` | **Default: incremental sync** — fetch the export, diff per actor against the local bundle, rewrite only the actor folders the server actually changed, preserve local-only edits and new local actors (see [Incremental sync](#incremental-sync-default-push-pull-behavior)). `--replace` restores the whole-canvas managed-path rewrite (the pre-sync behavior). Default dir `./<slug>.borgiq-canvas`. Envelope `errors` land in `exportErrors`. |
| `bundle push <dir> [--canvas <slugOrId>] [--mode merge\|insert\|replace] [--create] [--force-local] [--dry-run] [--no-refresh] [--strict] [--auto-layout] [--layout-source-actor-id <actorId...>]` | **Default: incremental sync** — validate → assemble → fetch the server export and actorVersions → per-actor diff → apply only adds/updates/deletes via `batchActorOperations` (+ `updateCanvas` for metadata), aborting with a report if any actor changed on the server since it was pulled; `--force-local` overrides (local wins). Ends with an implicit incremental pull to refresh `sync.actorVersions` (`--no-refresh` skips). **Passing `--mode` opts into the legacy whole-document path:** pack → `importCanvasData` with that mode. `--create` calls `createCanvasWithData` from the bundle's metadata and conflicts with `--canvas`/`--mode` (error if combined). Validation errors abort before any API call. `--auto-layout` runs the canvas layout API after a successful sync/create/import; `--layout-source-actor-id` limits layout downstream of those actors and implies layout. |

**Git-safe overwrite semantics (unpack/pull):** writing into an existing directory rewrites only *managed paths* — `canvas.yaml` and the `actors/` subtree are deleted and rewritten; everything else (`.git/`, `AGENTS.md`, `.gitignore`, user files) is untouched. `AGENTS.md` and `.gitignore` are created only if missing, never overwritten. A target that already contains `canvas.yaml` is a bundle and is rewritten without `--force` (the normal pull workflow — git is the safety net); a non-empty target *without* `canvas.yaml` requires `--force`.

Output follows repo conventions: human summaries to stderr on TTY, structured results via the existing `output()` dispatcher, all failures through `handleError()`.

## Incremental sync (default push/pull behavior)

*Added 2026-07-08. Supersedes the original always-whole-document `push` and always-full-rewrite `pull`.*

Whole-document import replaces every actor on every push — noisy in the canvas edit history, needless load, and it stomps concurrent server-side edits wholesale. Sync makes `push` and `pull` converge the two sides by touching **only the actors that actually differ**, using the per-actor API (`batchActorOperations`, `updateCanvas`). The legacy behavior remains available: `push --mode <merge|insert|replace>` (presence of `--mode` selects the whole-document `importCanvasData` path) and `pull --replace` (full managed-path rewrite).

### Change detection: canonical diff + `sync.actorVersions`

Sync keeps no hidden state (no `.borgiq/` baseline, no checksums). The visible root `sync.actorVersions` map records the server `canvasActor.editVersion` observed at the last pull/refresh. Every sync fetches the server export plus `getCanvas(...includeData).actorVersions`, disassembles the export in memory, and compares per actor against the local bundle:

- **Content comparison** is on canonical form: both sides are parsed and re-serialized through the deterministic YAML seam, with the exported actor's `version` field excluded, then byte-compared (actor.yaml + its `code/` files + its `graph` slice — edges owned by the actor, and its position). Formatting-only local edits are therefore *not* changes.
- **Freshness** comes from `sync.actorVersions`: it records which server edit version the local copy was taken from. `serverVersion != bundleVersion` means the server has moved since the last pull. For bundles written before this metadata existed, the first sync assumes the current server edit versions, then refresh writes the real map.

Per-actor classification, given `contentEqual` (canonical compare) and the edit-version fields:

| Case | Local | Server | Verdict | push does | pull does |
|---|---|---|---|---|---|
| unchanged | present | present, `contentEqual` | in sync | skip | skip (file mtimes untouched) |
| local edit | present, differs, `bundleVersion == serverVersion` | present | only you changed it | `update` op (with `editVersion`) | **keep local** (report: "local changes kept — push to publish") |
| server edit | present, differs, `bundleVersion != serverVersion` | present | server changed it (local may have too — indistinguishable without a baseline) | **conflict** → abort (see below) | rewrite local from server |
| new local | present, **no `sync.actorVersions` entry** | absent | created locally (init / hand-added) | `add` op (client-minted `ACTR…` id) | keep local, merge into graph |
| deleted on server | present, **has `sync.actorVersions` entry** | absent | was pulled once, server since deleted it | — (nothing to push; reported) | delete local actor folder |
| new on server / deleted locally | absent | present | ambiguous statelessly; push direction rules | `remove` op (**delete by default** — push makes the server match the bundle) | write new actor folder |

The `sync.actorVersions` entry is what lets `pull` tell "I created this locally" (keep it) apart from "the server deleted this" (remove it) without a hidden baseline file.

### Conflict policy (push): abort with report

If any actor classifies as **server edit** (content differs *and* the server's `editVersion` is not the one the bundle was pulled at), `push` applies **nothing** — all-or-nothing — and exits non-zero listing every conflicted actor (id, name, bundle path, bundle vs server editVersion), with the resolution hint: *re-pull (server wins on those actors), or re-run with `--force-local` (local wins)*. An actor with a missing local edit-version entry that *does* exist on the server is treated the same way (freshness unknowable → conservative), except legacy bundles with no sync map at all get one compatibility sync that assumes the current server map.

Two further layers keep races out:

1. Every `update`/`remove` op carries `editVersion` (the server edit version observed during the diff). An edit landing between diff and apply surfaces in the response's `conflicts[]`; the CLI reports it and exits non-zero.
2. `push` ends with an **implicit incremental pull** (skippable with `--no-refresh`): it re-fetches the export and actorVersions, refreshes managed paths, and advances `sync.actorVersions`. Without this, the next push would misread its own writes as conflicts.

`pull` needs no abort: its only lossy case is **server edit** where the local copy was *also* hand-edited — indistinguishable without a baseline snapshot, so the server wins, and git (the bundle is a git artifact) is the recovery path. Pure local edits (`bundleVersion == serverVersion`) are always preserved.

### Order of operations (push sync)

1. Validate + assemble the bundle (same policy as `pack`; errors abort before any API call).
2. `exportCanvas` → disassemble in memory → diff.
3. Conflicts? Report and abort (unless `--force-local`).
4. `--dry-run`: print the plan — per-actor adds/updates/deletes/conflicts/unchanged counts and ids, metadata delta — apply nothing, exit 0.
5. One `batchActorOperations` call, ops ordered adds → updates → removes (edge targets must exist before edges referencing them are written).
6. Canvas metadata delta (`name`, `description`, `tags`, `messageTTLInDays`, `runtimeSlug` — never `slug`/`id`/`imagePath`, which stay informational) → `updateCanvas` if changed.
7. `--auto-layout` if requested.
8. Implicit incremental pull (refresh), then summary: `applied: N added, M updated, K deleted, metadata updated; skipped: U unchanged`.

### Pull sync mechanics

Fetch + disassemble the server export, then compute the merged target: server actors, plus locally-kept actors (local edits at same version; version-less new local actors with their graph nodes/edges). Regenerate `canvas.yaml` from the merged set (graph/index/dependencies are projections, so this is the existing disassembler over merged records), then write **file-by-file**: only files whose canonical content differs are rewritten, and only actor folders that vanished from the merged set are deleted. Unmanaged paths keep the existing git-safe semantics. Result: minimal mtime churn, minimal git diff, local work never silently lost except the documented server-edit-wins case.

### Sync invariants

- Sync never partially applies a conflicted push (pre-check aborts before the batch call; in-flight `conflicts[]` are reported loudly).
- A no-op sync (nothing differs) makes zero mutation calls and rewrites zero files, in both directions.
- `push --dry-run` and `pull --dry-run` are read-only end to end.
- Sync composes with `--strict` (validation policy unchanged) and never bypasses validation.
- Determinism guarantees are unaffected: diffing reuses the same canonical serialization seam; `sync.actorVersions` is sorted and contains only platform edit-version numbers.

## Architecture

Pure compiler core, no fs/network (approved Approach A):

```
src/lib/bundle/
├─ types.ts        # BundleFileMap = Record<relPath, string>; root/actor doc types
├─ registry.ts     # Record<BIQActorType, BundlePathSpec> — 30 entries
├─ yaml.ts         # deterministic parse/stringify helpers
├─ disassemble.ts  # {metadata, data} → BundleFileMap
├─ assemble.ts     # BundleFileMap → {metadata, data} + warnings
├─ validate.ts     # BundleFileMap → { errors, warnings } (path-scoped)
├─ diff.ts         # pure per-actor diff for sync: (local doc, server doc) → CanvasDiff (no fs/network)
└─ template.ts     # starter bundle for init (uses lib/ids.ts for ACTR/EDGE/SPRT ids)
src/lib/bundleFs.ts      # readBundleDir / writeBundleDir (managed-path semantics)
src/commands/bundle/     # init, unpack, pack, validate, pull, push + index.ts
```

The CLI stays standalone: the registry and document types are defined locally (mirroring platform names), consistent with the existing `src/client/types.ts` convention. `BIQActorType` values are duplicated here deliberately — the CLI already hardcodes platform contracts (see `workflowValidation.ts`).

## Validation (all errors collected, not fail-fast)

Path-scoped errors (`actors/tasks/deno/ACTR…/code/mod.ts: <message>`):

1. Root: `canvas.yaml` parses; `format`/`formatVersion` supported; required sections present.
2. Path safety: every `actors[].path` matches the registry pattern for its `type`, resolves inside the bundle, and contains no `..`/absolute segments — checked before any file access.
3. Index ↔ tree: every indexed path has `actor.yaml` (missing → error). Unreferenced-file policy is three-tier: files *outside* `actors/` (docs, `.gitignore`, editor files, `.git/`) are ignored entirely; files *inside* `actors/` not referenced by the index → warning (error under `--strict`); unexpected files inside a `code/` dir → always error (codeDir contract).
4. Duplicate actor IDs at the file-map level (duplicate `actors[]` entries or two paths → one ID) — before assembly collapses records.
5. Actor: `actor.yaml` parses; `id` and `type` match the index entry.
6. codeDir contract (fixed value, canonical entrypoints only, reserved names, dual source, missing entrypoint file when `codeDir` present).
7. Graph: every indexed actor has exactly one `graph.nodes` entry and vice versa; edge endpoints exist; `sourcePortId` exists in the source actor's `sourcePorts`; `configuration.aiAgentToolActorIds` entries resolve to indexed actors.
8. Unknown actor type → error (both directions).

`validate` prints all findings; `pack`/`push` run the same checks and refuse on any error (warnings fatal only with `--strict`).

## Init template

`bundle init` creates, offline:

- `canvas.yaml` — metadata from flags/dir name; graph wiring the webhook trigger to the Deno processor and carrying the unconnected test sender actor.
- `actors/triggers/webhook/ACTR…/actor.yaml` — webhook trigger with minted `configuration.webhook.triggerKey`, public GET/POST methods, and immediate `200 OK` response defaults matching the UI starter.
- `actors/tasks/http-request/ACTR…/actor.yaml` — manual test sender that posts `{"message":"Hello, world!"}` to `${{ ctx.canvas.webhookTriggers.incoming_webhook.url }}`.
- `actors/tasks/deno/ACTR…/actor.yaml` + `code/mod.ts` — Deno task using a TypeScript starter that returns `Deno.version`, `Deno.build`, and `req.ctx`, `codeDir: code`.
- One `graph.edges` entry (`EDGE` + ULID id) connecting trigger → task via the trigger's default source port.
- `AGENTS.md` — the bundle contract for coding agents: layout, the three-edit rule for adding an actor, codeDir contract, determinism expectations, and the `bundle validate`/`pack`/`push` loop.
- `.gitignore` — reserved for future local artifacts (e.g. `.borgiq/`).

The starter bundle passes `bundle validate --strict` and packs immediately. IDs are minted per-invocation (init is generative, not deterministic — determinism applies to unpack/pack).

## Testing (Vitest — first test infrastructure in this repo)

- `vitest` as devDependency; `npm test` → `vitest run`. No config beyond defaults needed (native TS).
- Pure-core tests on in-memory file maps (no fs/network):
  - The three determinism/round-trip guarantees, on fixtures covering: simple trigger→task canvas; HTTP task; Deno actor with code; Python actor; app actor with inline HTML/CSS/JS; app actor with BIQFile references (not split); canvas with schemas + credentials + connection.
  - Validation matrix: helper file in `code/` rejected; reserved filenames rejected; dual source rejected; duplicate IDs; missing `actor.yaml`; unreferenced-file warning; bad graph refs (actor, port, `aiAgentToolActorIds`); path escape (`..`, absolute); unknown type; wrong `codeDir` value.
  - Registry: compile-time exhaustiveness (the `Record` type) plus a runtime test asserting 30 entries and kebab-case folder names.
  - Sync diff matrix (pure, on in-memory documents plus edit-version maps): unchanged / local edit / server edit (conflict on push, rewrite on pull) / formatting-only local edit (not a change) / new local actor without `sync.actorVersions` entry (add on push, kept on pull) / actor with sync entry absent from server (reported on push, folder deleted on pull) / server-only actor (remove op on push, written on pull) / missing local sync entry for a server actor (conservative conflict, except legacy no-map compatibility) / metadata-only delta / no-op sync produces zero operations. Pull-merge cases: kept local actors' graph nodes/edges survive `canvas.yaml` regeneration; only changed files rewritten.
  - Snapshot tests: disassembled file map of a representative canvas. The init template is covered structurally instead (its ids are minted per invocation, and it flows through the already-snapshotted disassembler).
- `bundleFs` tests in a temp dir: managed-path overwrite preserves unmanaged files; `AGENTS.md`/`.gitignore` not clobbered; `--force` requirement.
- `npm run build` (tsc) stays the compile gate; tests run inside the devcontainer.

## Deviations from BORG-565 (deliberate, CLI v1)

| Ticket item | CLI v1 decision | Rationale |
|---|---|---|
| Zip transport | Folder only | Git is the transport; zip belongs with the future platform endpoint. |
| Per-actor checksums | Omitted | In git, content tracking is git's job; checksums either go stale, get ignored, or force root-file churn on every actor edit — defeating localized diffs. Sync (2026-07-08) resolved the "revisit for sync tooling" note without them: `sync.actorVersions` is the freshness marker and canonical content comparison detects changes, so checksums stay out. |
| `runtimeContractVersion` | Omitted | The CLI doesn't know the runtime SDK surface; platform-side concern. |
| Dev config (`code/deno.json`, type stubs) | Omitted | Deferred alongside `bundle dev-setup`. Note v1 validation rejects a hand-added `code/deno.json` (codeDir contract); when dev-config lands, it joins the canonical-entrypoint allowlist. |
| Dependency walk promoted into `@borgiq/utils` | Local reimplementation of the same walk (`connection.key` + credentials `source` split) | No platform changes; the walk is ~15 lines against the exported (object) shapes. |
| `exportErrors` channel | Populated only by `pull`/envelope input | A bare `{metadata, data}` document has no error channel. |
| Extra-file strictness | Warn by default, `--strict` to fail; `code/` extras always fail | Matches the ticket's recommendation for CLI validation. |
| `dependencies.assets` | Omitted | No asset references exist in the exported actor shape the CLI can reliably walk in v1. |

## Out of scope

Everything in the ticket's "Out of MVP" list, plus all platform-side milestones (M1–M5). If the platform later implements bundles natively, this compiler's format compatibility is the migration path — and its test fixtures become the platform's conformance fixtures.
