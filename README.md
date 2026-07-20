# BorgIQ CLI

Command-line interface for the [BorgIQ](https://borgiq.com) workflow automation platform.

## Installation

```bash
npm install -g @borgiq/cli
```

Requires Node.js 22 or later.

## Quick Start

```bash
# Authenticate with your API token
borgiq auth login

# List your organizations
borgiq orgs list

# List canvases in a workspace
borgiq canvases list --org my-org --workspace prod

# Trigger a flow manually (canvas ID / ULID, not slug)
borgiq triggers run --canvas <canvas> --actor-id <id>

# Check a flow run's status
borgiq flowruns status <id>
```

## Authentication

The CLI uses BorgIQ API tokens (Personal Access Tokens) for authentication. Create a token in the BorgIQ web app under **User Settings > API Tokens**, then configure the CLI.

### Interactive Login

```bash
borgiq auth login
```

You'll be prompted for your API URL and token. If only one organization and workspace are accessible, they are automatically set as defaults.

### Non-Interactive Login (CI/CD)

```bash
borgiq auth login --api-url https://api.borgiq.com/v1 --token biq_your_token_here
```

### Environment Variables

For CI/CD pipelines, you can skip `auth login` entirely and use environment variables:

```bash
export BORGIQ_API_URL=https://api.borgiq.com/v1
export BORGIQ_API_TOKEN=biq_your_token_here
export BORGIQ_ORG=my-org
export BORGIQ_WORKSPACE=prod
```

### Configuration Precedence

Values are resolved in this order (highest priority first):

1. CLI flags (`--api-url`, `--token`, `--org`, `--workspace`)
2. Environment variables (`BORGIQ_API_URL`, `BORGIQ_API_TOKEN`, `BORGIQ_ORG`, `BORGIQ_WORKSPACE`)
3. Config file (`~/.config/borgiq/config.json`)

## Commands

### Auth

| Command | Description |
|---------|-------------|
| `borgiq auth login` | Configure API key and base URL |
| `borgiq auth logout` | Remove stored credentials |
| `borgiq auth status` | Show current authentication status |

### Organizations

| Command | Description |
|---------|-------------|
| `borgiq orgs list` | List organizations and workspaces |

### Workspaces

| Command | Description |
|---------|-------------|
| `borgiq workspaces list` | List workspaces in an organization |

### Canvases

| Command | Description |
|---------|-------------|
| `borgiq canvases list` | List canvases in a workspace |
| `borgiq canvases get <canvas>` | Get canvas details by slug or ID (`--include-data` for full flow data) |
| `borgiq canvases create` | Create an empty canvas |
| `borgiq canvases create-with-data` | Create a canvas with full flow data |
| `borgiq canvases update <id>` | Update canvas metadata |
| `borgiq canvases update-data <canvas>` | Import canvas data by slug or ID (`--mode merge\|insert\|replace`) |
| `borgiq canvases delete <canvas>` | Delete a canvas by slug or ID |
| `borgiq canvases export <canvas>` | Export canvas data by slug or ID as JSON |
| `borgiq canvases validate <canvas>` | Validate canvas configuration by slug or ID |
| `borgiq canvases layout <canvas>` | Auto-layout actors by slug or ID |
| `borgiq canvases verify-import` | Verify import data before creating |

### Canvas Bundles

| Command | Description |
|---------|-------------|
| `borgiq bundle init <dir>` | Create an offline starter bundle folder |
| `borgiq bundle pull <canvas> [dir]` | Sync a canvas by slug or ID into a bundle folder |
| `borgiq bundle unpack <file> <dir>` | Expand a canvas export document into a bundle folder |
| `borgiq bundle validate <dir>` | Validate a bundle with file-scoped findings |
| `borgiq bundle pack <dir>` | Compile a bundle back to canvas export YAML |
| `borgiq bundle push <dir>` | Validate and sync a bundle into a canvas |

### Canvas Actors

| Command | Description |
|---------|-------------|
| `borgiq canvas-actors list <canvas>` | List actors in a canvas by slug or ID with filters |
| `borgiq canvas-actors get <canvas> <actorId>` | Get a single actor by ID from a canvas by slug or ID |
| `borgiq canvas-actors flow <canvas> <actorId>` | Get actor and downstream actors from a canvas by slug or ID |
| `borgiq canvas-actors verify <canvas>` | Verify actor options for a canvas by slug or ID |
| `borgiq canvas-actors create <canvas> <actorId>` | Create a single actor in a canvas by slug or ID |
| `borgiq canvas-actors update <canvas> <actorId>` | Update a single actor in a canvas by slug or ID |
| `borgiq canvas-actors delete <canvas> <actorId>` | Delete a single actor from a canvas by slug or ID |
| `borgiq canvas-actors batch <canvas>` | Apply batch actor operations to a canvas by slug or ID |

### Flow Runs

| Command | Description |
|---------|-------------|
| `borgiq flowruns list` | List flow runs |
| `borgiq flowruns get <id>` | Get flow run details |
| `borgiq flowruns status <id>` | Get flow run execution status |
| `borgiq flowruns summary <id>` | Get flow run summary |
| `borgiq flowruns interrupt <id>` | Interrupt a running flow |

### Triggers

| Command | Description |
|---------|-------------|
| `borgiq triggers run` | Manually trigger a flow |

### Connections

| Command | Description |
|---------|-------------|
| `borgiq connections list` | List connections |
| `borgiq connections delete <id>` | Delete a connection |

### Secrets

| Command | Description |
|---------|-------------|
| `borgiq secrets list` | List secrets |
| `borgiq secrets delete <id>` | Delete a secret |

### API Tokens

| Command | Description |
|---------|-------------|
| `borgiq tokens list` | List API tokens |
| `borgiq tokens create` | Create a new API token |
| `borgiq tokens revoke <id>` | Revoke an API token |

## Global Options

These options are available on all commands:

| Option | Description |
|--------|-------------|
| `--api-url <url>` | BorgIQ API URL (overrides config and env) |
| `--token <token>` | API token (overrides config and env) |
| `--org <org>` | Organization slug or ID |
| `--workspace <workspace>` | Workspace slug or ID |
| `--json` | Force JSON output |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

## Output Formats

- **Table** (default in terminals): Human-readable columnar output
- **JSON** (default when piped or with `--json`): Machine-readable structured data

```bash
# Table output (interactive terminal)
borgiq canvases list

# JSON output (piped or explicit)
borgiq canvases list --json
borgiq canvases list | jq '.data[].name'
```

Paginated list commands return `{ "total": <count>, "data": [...] }` in JSON mode.

## Input Handling

Commands that accept structured input (e.g., creating actors, batch operations) support two input methods:

```bash
# From a JSON file
borgiq canvas-actors create <canvas> <actorId> --file actor.json

# From a YAML file
borgiq canvas-actors create <canvas> <actorId> --file actor.yaml

# From stdin (pipe, parsed as YAML — JSON is valid YAML, so piped JSON works too)
cat actor.yaml | borgiq canvas-actors create <canvas> <actorId>
cat actor.json | borgiq canvas-actors create <canvas> <actorId>
```

File format is detected by extension: `.yaml` and `.yml` files are parsed as YAML, all other extensions are parsed as JSON. Piped stdin is parsed as YAML — since JSON is a subset of YAML, existing JSON pipelines continue to work unchanged.

If neither `--file` nor piped stdin is provided, the command exits with an error.

## Pagination

List commands support pagination options:

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number (1-based) |
| `--page-size <number>` | Items per page (max 100) |
| `--search <query>` | Filter results by search query |
| `--sort-by <field>` | Field to sort by |
| `--sort-order <asc\|desc>` | Sort direction |
| `--all` | Fetch every page and return the full result set (ignores `--page`) |

`--all` is the simplest option for scripts and agents that need the complete list:
it walks every page for you and returns one `{ "total": <count>, "data": [...] }`.

```bash
# All canvases as a single JSON array, no manual page loop
borgiq canvases list --all --json | jq '.data[].slug'
```

---

## Commands

### Auth

| Command | Description |
|---------|-------------|
| `borgiq auth login` | Configure API key and base URL |
| `borgiq auth logout` | Remove stored credentials |
| `borgiq auth status` | Show current authentication status |

**`borgiq auth login`**

| Option | Description |
|--------|-------------|
| `--api-url <url>` | API URL (default: prompted interactively) |
| `--token <token>` | API token starting with `biq_` (default: prompted interactively) |

---

### Organizations

| Command | Description |
|---------|-------------|
| `borgiq orgs list` | List organizations and workspaces accessible to the authenticated user |

---

### Workspaces

| Command | Description |
|---------|-------------|
| `borgiq workspaces list` | List workspaces in an organization |

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |

---

### Actors

| Command | Description |
|---------|-------------|
| `borgiq actors list` | List all available actor types |
| `borgiq actors schema <actorType>` | Get the configuration schema for an actor type |

**`borgiq actors schema`**

| Option | Description |
|--------|-------------|
| `--action <action>` | Get schema for a specific action (e.g., for DataStoreActor) |

---

### Canvases

| Command | Description |
|---------|-------------|
| `borgiq canvases list` | List canvases in a workspace |
| `borgiq canvases get <canvas>` | Get canvas details by slug or ID |
| `borgiq canvases create` | Create an empty canvas |
| `borgiq canvases create-with-data` | Create a canvas with full flow data from JSON/YAML input |
| `borgiq canvases update <id>` | Update canvas metadata |
| `borgiq canvases update-data <canvas>` | Import canvas data by slug or ID (actors and edges) |
| `borgiq canvases delete <canvas>` | Delete a canvas by slug or ID |
| `borgiq canvases export <canvas>` | Export canvas data by slug or ID as JSON |
| `borgiq canvases validate <canvas>` | Validate canvas configuration by slug or ID before execution |
| `borgiq canvases layout <canvas>` | Auto-layout actors by slug or ID using ELK algorithm |
| `borgiq canvases verify-import` | Verify import data before applying |

**`borgiq canvases list`**

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |
| `--search <query>` | Filter by name |

**`borgiq canvases get`**

| Option | Description |
|--------|-------------|
| `--include-data` | Include full flow data (actors, edges, positions) |

**`borgiq canvases create`**

| Option | Required | Description |
|--------|----------|-------------|
| `--name <name>` | Yes | Canvas name |
| `--slug <slug>` | Yes | Canvas slug (URL-friendly identifier) |
| `--description <desc>` | No | Canvas description |
| `--message-ttl <days>` | No | Message time-to-live in days (default: 7) |
| `--tags <tags>` | No | Canvas tags |
| `--runtime-slug <slug>` | No | Runtime slug |

**`borgiq canvases create-with-data`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file containing full canvas definition (or pipe YAML/JSON via stdin) |
| `--auto-layout` | Run canvas auto-layout after the canvas is created |
| `--layout-source-actor-id <id>` | Auto-layout only downstream of specified actors; implies `--auto-layout` |

**`borgiq canvases update`**

| Option | Description |
|--------|-------------|
| `--name <name>` | New canvas name |
| `--slug <slug>` | New canvas slug |
| `--description <desc>` | New description |
| `--tags <tags>` | New tags |
| `--message-ttl <days>` | New message TTL in days |
| `--runtime-slug <slug>` | New runtime slug |

**`borgiq canvases update-data`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file (or pipe YAML/JSON via stdin) |
| `--mode <mode>` | Update mode: `merge` (default), `insert`, or `replace` |
| `--auto-layout` | Run canvas auto-layout after a successful import |
| `--layout-source-actor-id <id>` | Auto-layout only downstream of specified actors; implies `--auto-layout` |

**`borgiq canvases layout`**

| Option | Description |
|--------|-------------|
| `--source-actor-id <id>` | Layout only downstream of specified actors (repeatable) |

**`borgiq canvases verify-import`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file (or pipe YAML/JSON via stdin) |

---

### Canvas Bundles

Canvas bundles expand the platform's canvas export document into a git-friendly
folder. `canvas.yaml` holds canvas metadata, graph nodes/edges, dependencies,
export errors, warnings, sync baselines, and the actor index. Each actor lives in
`actors/<category>/<type>/<ACTOR_ID>/actor.yaml`; Deno, Deno Test, Python,
Universal Trigger, and App actors use native files under `code/` for editable source.
React App actors expand to a whole Vite project under `code/` — see
[React App actors](#react-app-actors) below.

Pack/unpack is deterministic and lossless over managed bundle paths. Push/pull
refresh `canvas.yaml` `sync.actors` with each server actor's edit version and
canonical SHA-256 content hash. The hash is the common ancestor used to distinguish
server-only changes from concurrent edits.

```bash
borgiq bundle init ./my-flow.borgiq-canvas
borgiq bundle pull my-canvas
borgiq bundle validate ./my-flow.borgiq-canvas
borgiq bundle pack ./my-flow.borgiq-canvas -o export.yaml
borgiq bundle push ./my-flow.borgiq-canvas
borgiq bundle push ./my-flow.borgiq-canvas --dry-run
borgiq bundle push ./my-flow.borgiq-canvas --force-local
borgiq bundle push ./my-flow.borgiq-canvas --raw
borgiq bundle push ./my-flow.borgiq-canvas --auto-layout
borgiq bundle push ./my-flow.borgiq-canvas --mode replace
borgiq bundle push ./my-flow.borgiq-canvas --create
```

| Command | Description |
|---------|-------------|
| `borgiq bundle init <dir>` | Create an offline starter bundle folder. Refuses non-empty directories. |
| `borgiq bundle unpack <file\|-> <dir>` | Read raw export YAML or the `{ yaml, errors }` JSON envelope and write a bundle folder. Pass `--force` to replace an existing bundle's managed files. |
| `borgiq bundle pack <dir>` | Validate and emit platform export YAML to stdout or `-o, --output <file>`. |
| `borgiq bundle validate <dir>` | Report all bundle errors and warnings; `--strict` treats warnings as fatal. |
| `borgiq bundle pull <canvas> [dir]` | Sync by slug or ID from the API. Existing bundles fast-forward server-only changes, preserve local edits/deletions, and abort on genuine concurrent or unknown-baseline conflicts; `--replace` explicitly accepts the server state with a full managed-path rewrite. |
| `borgiq bundle push <dir>` | Validate and sync only changed actors by default. A server-side change blocks push until it is pulled, unless `--force-local` explicitly selects local wins. `--strict` also enables strict actor batch validation on the API. Structured output is compact; use `--raw` for generated operation payloads and raw API responses. Use `--mode merge\|insert\|replace` for the legacy whole-document import path. Use `--auto-layout` or `--layout-source-actor-id` to run layout after a successful push. |

`pull --replace` and `unpack` rewrite only managed paths: `canvas.yaml` and `actors/`.
Files such as `.git/`, `AGENTS.md`, `.gitignore`, and notes are preserved.
`AGENTS.md` and `.gitignore` are created only when missing.
Push refuses exports with actor errors, verifies that the batch API confirmed every requested actor operation, and skips local refresh after any incomplete response. Bundles without `sync.actors` fail closed when an existing local actor differs from the server. Run `bundle pull` to establish the visible sync baseline, or choose `--replace`/`--force-local` explicitly.

#### React App actors

A React App actor's `code/` is a real, runnable Vite project rather than a single
entrypoint file. Pull it and work in it with your normal tooling:

```bash
borgiq bundle pull my-canvas
cd my-canvas.borgiq-canvas/actors/triggers/react-app/<ACTOR_ID>/code
npm install                     # resolves @borgiq/actors from the CLI-written stub
npm run dev                     # local Vite dev server
npx shadcn@latest add button    # any generator; new text files become actor source
cp ~/hero.png src/assets/       # new asset, uploaded on the next push
cd -
borgiq bundle validate . && borgiq bundle push .
```

Then press **Build** in the web editor to publish and view the app. A push uploads
source only; the served app does not change until it is built, and build failures are
reported in the editor rather than by the CLI.

**Dependencies.** Add packages the normal way, with two caveats. Pin exact versions: the
lockfile is never synced, so the platform resolves `package.json` on its own. And the
build must produce a single JS file and at most one CSS file — avoid route-level
`React.lazy` splitting and keep `build.cssCodeSplit: false` and
`build.rollupOptions.output.inlineDynamicImports: true` in `vite.config.ts`. Packages
needing a postinstall step are not supported, and a version published in the last few
days may be rejected by the minimum dependency age in `deno.json`. Build-time CSS
(Tailwind, CSS Modules, shadcn/ui) works as-is; CSS-in-JS libraries need the actor's
`allowInlineStyling` option. The generated `AGENTS.md` carries the full contract.

**Assets.** `code/src/assets/` is the only auto-synced asset directory. Its files are
workspace assets, not actor source: `pull` downloads each one, and `push` uploads new
and changed ones and maintains the matching `options.files` entry
(`{ path: src/assets/hero.png, content: ${{ assets["hero.png"] }} }`). A new file is
keyed by its file name, exactly as uploading it in the editor would be; if that key is
taken by an identical file the CLI adopts it, and if it is taken by different content
the push stops and asks you to rename. Deleting a file locally drops the entry on the
next push but **keeps** the workspace asset — remove it with `borgiq assets delete`.
Asset conflicts behave like actor conflicts: they fail closed, and `--force-local`
(push) or `--replace` (pull) resolves them. Entries you write yourself with inline
text, or outside `src/assets/`, are left strictly alone.

Reference an asset from source with a normal import — `import hero from
'./assets/hero.png'` — so the bundler rewrites it; a hardcoded `/src/assets/…` path or a
`public/` file breaks, because the app is served under a per-app base path. Assets are
workspace-wide, so two actors referencing `hero.png` share one asset.

Binary files anywhere else under `code/` are ignored with a warning; move them under
`src/assets/` to sync them.

**Never touched.** `node_modules/`, `dist/`, `.git/`, `.vite/`,
`__borgiq_sdk_placeholder__/`, lockfiles (`deno.lock`, `package-lock.json`,
`yarn.lock`, `pnpm-lock.yaml`, `bun.lock*`), `.DS_Store`, and `Thumbs.db` survive every
pull, push, and `--replace`. `.env` and `.env.*` are ignored with a warning: actor
source is readable by anyone who can open the canvas, and a Vite build inlines `VITE_*`
values into the served app — use platform variables or secrets instead.

`bundle init`'s `.gitignore` covers the generated directories, but companion files are
only written when missing, so a bundle created before this release keeps its old
`.gitignore` — add the React App entries by hand or delete the file and re-pull.

`unpack` stays offline and does not materialize asset files; run `bundle pull` for those.
Content is compared byte for byte, so a git `core.autocrlf`/`.gitattributes` setting that
rewrites line endings will make every file look locally edited.

---

### Canvas Actors

| Command | Description |
|---------|-------------|
| `borgiq canvas-actors list <canvas>` | List actors in a canvas by slug or ID |
| `borgiq canvas-actors get <canvas> <actorId>` | Get a single actor by ID from a canvas by slug or ID |
| `borgiq canvas-actors flow <canvas> <actorId>` | Get actor and all downstream actors from a canvas by slug or ID |
| `borgiq canvas-actors verify <canvas>` | Verify actor options for a canvas by slug or ID |
| `borgiq canvas-actors create <canvas> <actorId>` | Create a single actor in a canvas by slug or ID |
| `borgiq canvas-actors update <canvas> <actorId>` | Update a single actor in a canvas by slug or ID |
| `borgiq canvas-actors delete <canvas> <actorId>` | Delete a single actor from a canvas by slug or ID |
| `borgiq canvas-actors batch <canvas>` | Apply batch actor operations to a canvas by slug or ID |

**`borgiq canvas-actors list`**

| Option | Description |
|--------|-------------|
| `--actor-type <type>` | Filter by actor type |
| `--is-active <bool>` | Filter by active status |
| `--search <query>` | Filter by name |
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |

**`borgiq canvas-actors create`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file with actor configuration (or pipe YAML/JSON via stdin) |

**`borgiq canvas-actors update`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file with actor updates (or pipe YAML/JSON via stdin) |
| `--edit-version <version>` | Edit version for conflict detection |

**`borgiq canvas-actors delete`**

| Option | Description |
|--------|-------------|
| `--edit-version <version>` | Edit version for conflict detection |

**`borgiq canvas-actors verify`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file with actor options to validate (or pipe YAML/JSON via stdin) |

**`borgiq canvas-actors batch`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON/YAML file with batch operations (or pipe YAML/JSON via stdin) |

---

### Flow Runs

| Command | Description |
|---------|-------------|
| `borgiq flowruns list` | List flow runs for a canvas |
| `borgiq flowruns get <id>` | Get flow run details |
| `borgiq flowruns status <id>` | Get flow run execution status |
| `borgiq flowruns summary <id>` | Get flow run summary with per-actor job details |
| `borgiq flowruns interrupt <id>` | Interrupt a running flow |

**`borgiq flowruns list`**

| Option | Required | Description |
|--------|----------|-------------|
| `--canvas <canvas>` | Yes | Canvas slug or ID to list flow runs for (deprecated alias: `--canvas-id`) |
| `--page <number>` | No | Page number |
| `--page-size <number>` | No | Items per page |

---

### Flow Run Jobs

| Command | Description |
|---------|-------------|
| `borgiq flowrun-jobs list` | List jobs for a flow run |
| `borgiq flowrun-jobs test-run` | Test run a single actor |
| `borgiq flowrun-jobs re-run` | Re-run a previous job |
| `borgiq flowrun-jobs runtime-data <jobId>` | Get runtime data for a job |
| `borgiq flowrun-jobs ai-timeline <jobId>` | Get AI agent tool-use timeline |
| `borgiq flowrun-jobs source-message <jobId>` | Get the source message that triggered a job |

**`borgiq flowrun-jobs list`**

| Option | Required | Description |
|--------|----------|-------------|
| `--canvas <canvas>` | Yes | Canvas slug or ID (deprecated alias: `--canvas-id`) |
| `--actor-id <id>` | Yes | Actor ID |
| `--flowrun-id <id>` | No | Filter by flow run ID |
| `--page <number>` | No | Page number |
| `--page-size <number>` | No | Items per page |

**`borgiq flowrun-jobs test-run`**

| Option | Required | Description |
|--------|----------|-------------|
| `--canvas <canvas>` | Yes | Canvas ID / ULID; a slug is not accepted here (deprecated alias: `--canvas-id`) |
| `--actor-id <id>` | Yes | Actor ID to test |
| `--publish` | No | Publish emitted messages to downstream actors (default: false) |

**`borgiq flowrun-jobs re-run`**

| Option | Required | Description |
|--------|----------|-------------|
| `--job-id <id>` | Yes | Flow run job ID to re-run |
| `--no-publish` | No | Do not publish messages downstream (default: publish) |

**`borgiq flowrun-jobs runtime-data`**

| Option | Required | Description |
|--------|----------|-------------|
| `--root-path <path>` | Yes | Data root path: `ctx`, `request`, `inputs`, or `user` |

---

### Flow Run Results

| Command | Description |
|---------|-------------|
| `borgiq flowrun-results summaries` | Get result summaries for a job |
| `borgiq flowrun-results data <resultId>` | Get full result data |

**`borgiq flowrun-results summaries`**

| Option | Required | Description |
|--------|----------|-------------|
| `--job-id <id>` | Yes | Flow run job ID |

---

### Flow Run Messages

| Command | Description |
|---------|-------------|
| `borgiq flowrun-messages list` | List emitted messages |
| `borgiq flowrun-messages data <messageId>` | Get full emitted data for a message |

**`borgiq flowrun-messages list`**

| Option | Required | Description |
|--------|----------|-------------|
| `--canvas <canvas>` | Yes | Canvas slug or ID (deprecated alias: `--canvas-id`) |
| `--actor-id <id>` | Yes | Actor ID |
| `--flowrun-id <id>` | No | Filter by flow run ID |
| `--page <number>` | No | Page number |
| `--page-size <number>` | No | Items per page |

---

### Triggers

| Command | Description |
|---------|-------------|
| `borgiq triggers run` | Manually trigger a flow |

**`borgiq triggers run`**

| Option | Required | Description |
|--------|----------|-------------|
| `--canvas <canvas>` | Yes | Canvas ID / ULID; a slug is not accepted here (deprecated alias: `--canvas-id`) |
| `--actor-id <id>` | Yes | Trigger actor ID |

---

### Connections

| Command | Description |
|---------|-------------|
| `borgiq connections list` | List connections in a workspace |
| `borgiq connections types` | List available connection types |
| `borgiq connections delete <id>` | Delete a connection |

**`borgiq connections list`** / **`borgiq connections types`**

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |

---

### Secrets

| Command | Description |
|---------|-------------|
| `borgiq secrets list` | List secrets in a workspace |
| `borgiq secrets delete <id>` | Delete a secret |

**`borgiq secrets list`**

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |

---

### Assets

| Command | Description |
|---------|-------------|
| `borgiq assets list` | List assets in a workspace |
| `borgiq assets delete <id>` | Delete an asset |

**`borgiq assets list`**

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |

---

### API Tokens

| Command | Description |
|---------|-------------|
| `borgiq tokens list` | List API tokens |
| `borgiq tokens create` | Create a new API token |
| `borgiq tokens revoke <id>` | Revoke an API token |

**`borgiq tokens list`**

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number |
| `--page-size <number>` | Items per page |

**`borgiq tokens create`**

| Option | Required | Description |
|--------|----------|-------------|
| `--name <name>` | Yes | Token name |
| `--scopes <scopes>` | Yes | Comma-separated list of scopes |
| `--expires-at <date>` | No | Expiration date (ISO 8601) |

Available scopes:

| Scope | Description |
|-------|-------------|
| `org:access` | Access Organization |
| `org:read` | Read Organization |
| `org:write` | Write Organization |
| `org:delete` | Delete Organization |
| `workspace:access` | Access Workspace |
| `workspace:read` | Read Workspace |
| `workspace:write` | Write Workspace |
| `workspace:delete` | Delete Workspace |
| `canvas:read` | Read Canvas |
| `canvas:write` | Write Canvas |
| `canvas:delete` | Delete Canvas |
| `flowrunJob:read` | Read Flow Run Jobs |
| `flowrunJob:reRun` | Re-run Flow Run Jobs |
| `flowrunJob:delete` | Delete Flow Run Jobs |
| `flowrunJobLog:read` | Read Flow Run Logs |
| `flowrunJobResult:read` | Read Flow Run Results |
| `flowrunMessage:read` | Read Flow Run Messages |
| `Trigger:manual:create` | Create Manual Triggers |
| `secret:read` | Read Secrets |
| `secret:write` | Write Secrets |
| `secret:delete` | Delete Secrets |
| `connection:read` | Read Connections |
| `connection:write` | Write Connections |
| `connection:delete` | Delete Connections |
| `asset:read` | Read Assets |
| `asset:write` | Write Assets |
| `asset:delete` | Delete Assets |
| `template:read` | Read Templates |
| `template:write` | Write Templates |
| `collection:read` | Read Collections |
| `collection:write` | Write Collections |
| `collection:delete` | Delete Collections |
| `borgiqActor:read` | Read Actors |
| `runtime:read` | Read Runtimes |
| `runtime:write` | Write Runtimes |
| `runtime:delete` | Delete Runtimes |
| `user.info:read` | Read User Info |
| `user.workspaces:read` | Read User Workspaces |

---

## Offline commands

These commands run locally and need no API token — they generate IDs and validate
workflow JSON/YAML for the `borgiq-actor-builder` skill.

### generate
- `borgiq generate id <type>` — mint an ID. Types: `actor`, `edge`, `sourceport`, `template`, `app`, `category`, `webhooktriggerkey`.
- `borgiq generate msgvar "<name>"` — convert an actor name to a `msgVar`.

### validate
- `borgiq validate <file.yaml>` — validate a workflow YAML (structure + per-actor rules). Exit 2 when invalid.
- `borgiq validate <file.yaml> --skip-typecheck` — skip Deno/Python code typechecking.
- `borgiq validate <file.yaml> --post-process [--in-place]` — clean up redundant fields.

Code typechecking (DenoActor/PythonActor) runs only when `deno` / `python3` are installed; otherwise it is skipped with a warning.

---

## Examples

### CI/CD: Trigger a Flow and Wait for Completion

```bash
export BORGIQ_API_URL=https://api.borgiq.com/v1
export BORGIQ_API_TOKEN=biq_your_token
export BORGIQ_ORG=my-org
export BORGIQ_WORKSPACE=prod

# Trigger the flow
borgiq triggers run --canvas cnv_abc123 --actor-id act_def456 --json

# Check status
borgiq flowruns status <flowrun-id> --json
```

### Create a Scoped API Token

```bash
borgiq tokens create \
  --name "CI Pipeline" \
  --scopes "org:access,workspace:access,canvas:read,Trigger:manual:create,flowrunJob:read" \
  --expires-at "2025-12-31T23:59:59Z"
```

### Export and Import a Canvas

```bash
# Export
borgiq canvases export cnv_abc123 > canvas-backup.json

# Import into a new canvas
borgiq canvases create-with-data --file canvas-backup.json

# Or import into an existing canvas (merge mode)
borgiq canvases update-data cnv_xyz789 --file canvas-backup.json --mode merge
```

### Edit a Canvas as a Bundle

```bash
# Export and unpack to ./invoice-router.borgiq-canvas
borgiq bundle pull invoice-router

# Validate local edits
borgiq bundle validate ./invoice-router.borgiq-canvas --strict

# Pack without applying
borgiq bundle pack ./invoice-router.borgiq-canvas -o invoice-router.yaml

# Sync local bundle changes back to the canvas and auto-layout it
borgiq bundle push ./invoice-router.borgiq-canvas --auto-layout
```

### Inspect a Flow Run

```bash
# List recent flow runs for a canvas
borgiq flowruns list --canvas cnv_abc123

# Get detailed summary with per-actor job information
borgiq flowruns summary <flowrun-id>

# Inspect a specific job's runtime data
borgiq flowrun-jobs runtime-data <job-id> --root-path request

# View AI agent tool-use timeline
borgiq flowrun-jobs ai-timeline <job-id>
```

### Test an Actor in Isolation

```bash
# Test run without publishing messages downstream
borgiq flowrun-jobs test-run --canvas cnv_abc123 --actor-id act_def456

# Test run and publish to downstream actors
borgiq flowrun-jobs test-run --canvas cnv_abc123 --actor-id act_def456 --publish
```

### Manage Canvas Actors via CLI

```bash
# List all actors in a canvas
borgiq canvas-actors list cnv_abc123

# Get an actor's configuration
borgiq canvas-actors get cnv_abc123 act_def456 --json

# Create an actor from a JSON file
borgiq canvas-actors create cnv_abc123 act_new001 --file actor-config.json

# Update an actor with conflict detection
borgiq canvas-actors update cnv_abc123 act_def456 --file updates.json --edit-version 3

# Batch operations (add, update, remove multiple actors)
borgiq canvas-actors batch cnv_abc123 --file batch-ops.json

# Verify actor configuration against its type schema
borgiq canvas-actors verify cnv_abc123 --file actor-options.json

# View downstream flow from an actor
borgiq canvas-actors flow cnv_abc123 act_def456
```

### Browse Actor Types

```bash
# List all available actor types
borgiq actors list

# Get the configuration schema for an actor type
borgiq actors schema HttpRequestActor

# Get schema for a specific action
borgiq actors schema DataStoreActor --action get
```

### Pipe JSON Between Commands

```bash
# Export an actor and pipe to create in another canvas
borgiq canvas-actors get cnv_source act_001 --json | \
  borgiq canvas-actors create cnv_target act_001

# Validate import data before applying
borgiq canvases verify-import --file canvas-data.json
borgiq canvases update-data cnv_abc123 --file canvas-data.json
```

## Error Handling

The CLI provides descriptive error messages for common issues:

| Error | Suggestion |
|-------|------------|
| 401 Unauthorized | Run `borgiq auth login` to re-authenticate |
| 403 Forbidden | Check your API token scopes |
| 429 Rate Limited | Retry after the specified delay |
| Connection Error | Verify API URL and network connectivity |

All error output is written to **stderr** (stdout stays clean for piping results).
In human mode, validation errors from the API include field-level details:

```
Error: Input validation error! (HTTP 400)
  params.id: must follow the pattern for id
```

### Structured errors (JSON mode)

Whenever output is JSON (the `--json` flag, or any non-TTY/piped invocation),
errors are emitted as JSON too — so scripts and agents can parse them:

```json
{
  "error": {
    "code": "unauthorized",
    "status": 401,
    "exitCode": 3,
    "message": "Invalid or expired API token!",
    "hint": "Run 'borgiq auth login' to reconfigure your credentials."
  }
}
```

`details` (an array of `{ "path": [...], "message": "..." }`) is included for
validation failures.

### Exit codes

The process exits with a category-specific code so scripts can branch on the
failure type without parsing text:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Other / unexpected error |
| `2` | Usage error (bad flags, missing input, `400`/`422`) |
| `3` | Authentication required or invalid (`401`) |
| `4` | Forbidden (`403`) |
| `5` | Not found (`404`) |
| `6` | Conflict (`409`) |
| `7` | Rate limited (`429`) |
| `8` | Server error (`5xx`) |
| `9` | Network error (could not reach the API) |

### Destructive commands

`delete`, `revoke`, and `interrupt` prompt for confirmation on an interactive
terminal. Pass `--yes` (or `--force`) to skip the prompt. When stdin is not a
TTY (piped or run by an agent), they proceed without prompting so scripts never
hang — use `--yes` to make that intent explicit.

## Configuration

The CLI stores configuration at `~/.config/borgiq/config.json` (XDG-compliant). The file is created with `0600` permissions (owner-only read/write).

You can override the config directory with the `BORGIQ_CONFIG_DIR` environment variable.

**Config file structure:**

```json
{
  "apiUrl": "https://api.borgiq.com/v1",
  "apiToken": "biq_...",
  "defaultOrg": "my-org",
  "defaultWorkspace": "prod"
}
```

## Development

```bash
# Clone the repository
git clone <repo-url> borgiq-cli
cd borgiq-cli

# Install dependencies
npm install

# Run in development mode
npm run dev -- auth status

# Build
npm run build

# Run the built CLI
node dist/index.js --help
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
