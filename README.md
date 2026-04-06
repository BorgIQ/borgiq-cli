# BorgIQ CLI

Command-line interface for the [BorgIQ](https://borgiq.com) workflow automation platform.

## Installation

```bash
npm install -g borgiq
```

Requires Node.js 20 or later.

## Quick Start

```bash
# Authenticate with your API token
borgiq auth login

# List your organizations
borgiq orgs list

# List canvases in a workspace
borgiq canvases list --org my-org --workspace prod

# Trigger a flow manually
borgiq triggers run --canvas-id <id> --actor-id <id>

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
# From a file
borgiq canvas-actors create <canvasId> <actorId> --file actor.json

# From stdin (pipe)
cat actor.json | borgiq canvas-actors create <canvasId> <actorId>
```

If neither `--file` nor piped stdin is provided, the command exits with an error.

## Pagination

List commands support pagination options:

| Option | Description |
|--------|-------------|
| `--page <number>` | Page number (1-based) |
| `--page-size <number>` | Items per page |
| `--search <query>` | Filter results by search query |

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
| `borgiq canvases get <id>` | Get canvas details |
| `borgiq canvases create` | Create an empty canvas |
| `borgiq canvases create-with-data` | Create a canvas with full flow data from JSON input |
| `borgiq canvases update <id>` | Update canvas metadata |
| `borgiq canvases update-data <id>` | Import canvas data (actors and edges) |
| `borgiq canvases delete <id>` | Delete a canvas |
| `borgiq canvases export <id>` | Export canvas data as JSON |
| `borgiq canvases validate <id>` | Validate canvas configuration before execution |
| `borgiq canvases layout <id>` | Auto-layout actors using ELK algorithm |
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
| `--file <path>` | Path to JSON file containing full canvas definition (or pipe via stdin) |

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
| `--file <path>` | Path to JSON file (or pipe via stdin) |
| `--mode <mode>` | Update mode: `merge` (default), `insert`, or `replace` |

**`borgiq canvases layout`**

| Option | Description |
|--------|-------------|
| `--source-actor-id <id>` | Layout only downstream of specified actors (repeatable) |

**`borgiq canvases verify-import`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON file (or pipe via stdin) |

---

### Canvas Actors

| Command | Description |
|---------|-------------|
| `borgiq canvas-actors list <canvasId>` | List actors in a canvas |
| `borgiq canvas-actors get <canvasId> <actorId>` | Get a single actor by ID |
| `borgiq canvas-actors flow <canvasId> <actorId>` | Get actor and all downstream actors |
| `borgiq canvas-actors verify <canvasId>` | Verify actor options against type schema |
| `borgiq canvas-actors create <canvasId> <actorId>` | Create a single actor |
| `borgiq canvas-actors update <canvasId> <actorId>` | Update a single actor (partial update) |
| `borgiq canvas-actors delete <canvasId> <actorId>` | Delete a single actor |
| `borgiq canvas-actors batch <canvasId>` | Apply batch actor operations (add, update, remove) |

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
| `--file <path>` | Path to JSON file with actor configuration (or pipe via stdin) |

**`borgiq canvas-actors update`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON file with actor updates (or pipe via stdin) |
| `--edit-version <version>` | Edit version for conflict detection |

**`borgiq canvas-actors delete`**

| Option | Description |
|--------|-------------|
| `--edit-version <version>` | Edit version for conflict detection |

**`borgiq canvas-actors verify`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON file with actor options to validate (or pipe via stdin) |

**`borgiq canvas-actors batch`**

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to JSON file with batch operations (or pipe via stdin) |

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
| `--canvas-id <id>` | Yes | Canvas ID to list flow runs for |
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
| `--canvas-id <id>` | Yes | Canvas ID |
| `--actor-id <id>` | Yes | Actor ID |
| `--flowrun-id <id>` | No | Filter by flow run ID |
| `--page <number>` | No | Page number |
| `--page-size <number>` | No | Items per page |

**`borgiq flowrun-jobs test-run`**

| Option | Required | Description |
|--------|----------|-------------|
| `--canvas-id <id>` | Yes | Canvas ID |
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
| `--canvas-id <id>` | Yes | Canvas ID |
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
| `--canvas-id <id>` | Yes | Canvas ID |
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

## Examples

### CI/CD: Trigger a Flow and Wait for Completion

```bash
export BORGIQ_API_URL=https://api.borgiq.com/v1
export BORGIQ_API_TOKEN=biq_your_token
export BORGIQ_ORG=my-org
export BORGIQ_WORKSPACE=prod

# Trigger the flow
borgiq triggers run --canvas-id cnv_abc123 --actor-id act_def456 --json

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

### Inspect a Flow Run

```bash
# List recent flow runs for a canvas
borgiq flowruns list --canvas-id cnv_abc123

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
borgiq flowrun-jobs test-run --canvas-id cnv_abc123 --actor-id act_def456

# Test run and publish to downstream actors
borgiq flowrun-jobs test-run --canvas-id cnv_abc123 --actor-id act_def456 --publish
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

Validation errors from the API include field-level details:

```
Error: Validation failed (400)
  - name: Canvas name is required
  - slug: Slug must be URL-safe
```

All error output is written to stderr. The process exits with code 1 on failure.

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

Proprietary. All rights reserved.
