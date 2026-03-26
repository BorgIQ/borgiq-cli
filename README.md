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

The CLI uses BorgIQ API tokens (Personal Access Tokens) for authentication. Create a token in the BorgIQ web app under **User Settings > API Tokens**, then configure the CLI:

### Interactive Login

```bash
borgiq auth login
```

You'll be prompted for your API URL and token.

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
| `borgiq canvases get <id>` | Get canvas details |
| `borgiq canvases create` | Create a new canvas |
| `borgiq canvases update <id>` | Update canvas metadata |
| `borgiq canvases delete <id>` | Delete a canvas |
| `borgiq canvases export <id>` | Export canvas data as JSON |

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
- **JSON** (default when piped): Machine-readable JSON, also forced with `--json`

```bash
# Table output (interactive terminal)
borgiq canvases list

# JSON output (piped or explicit)
borgiq canvases list --json
borgiq canvases list | jq '.data[].name'
```

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
  --scopes "org:access,workspace:access,canvas:read,Trigger:manual:create,flowrunJob:read"
```

### Export a Canvas

```bash
borgiq canvases export cnv_abc123 > canvas-backup.json
```

### List Flow Runs for a Specific Canvas

```bash
borgiq flowruns list --canvas-id cnv_abc123
```

## Configuration

The CLI stores configuration at `~/.config/borgiq/config.json` (XDG-compliant). The file is created with `0600` permissions (owner-only read/write).

You can override the config directory with the `BORGIQ_CONFIG_DIR` environment variable.

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
