import { createRequire } from 'node:module';

import { Command } from 'commander';

import { registerAuthCommands } from './commands/auth/index.js';
import { registerOrgsCommands } from './commands/orgs/index.js';
import { registerWorkspacesCommands } from './commands/workspaces/index.js';
import { registerActorsCommands } from './commands/actors/index.js';
import { registerCanvasesCommands } from './commands/canvases/index.js';
import { registerCanvasActorsCommands } from './commands/canvas-actors/index.js';
import { registerFlowrunsCommands } from './commands/flowruns/index.js';
import { registerFlowrunJobsCommands } from './commands/flowrun-jobs/index.js';
import { registerFlowrunResultsCommands } from './commands/flowrun-results/index.js';
import { registerFlowrunMessagesCommands } from './commands/flowrun-messages/index.js';
import { registerTriggersCommands } from './commands/triggers/index.js';
import { registerConnectionsCommands } from './commands/connections/index.js';
import { registerSecretsCommands } from './commands/secrets/index.js';
import { registerAssetsCommands } from './commands/assets/index.js';
import { registerTokensCommands } from './commands/tokens/index.js';
import { registerTemplatesCommands } from './commands/templates/index.js';
import { registerScaffoldCommands } from './commands/scaffold/index.js';
import { registerGenerateCommands } from './commands/generate/index.js';
import { registerValidateCommands } from './commands/validate/index.js';

// Read the version from package.json at runtime so `borgiq --version` always
// matches the published package and never drifts on release.
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name('borgiq')
    .description('BorgIQ CLI - Command-line interface for the BorgIQ workflow automation platform')
    .version(version)
    .configureHelp({ showGlobalOptions: true })
    .showHelpAfterError();

  // Global options (inherited by every subcommand thanks to showGlobalOptions)
  program.option('--api-url <url>', 'BorgIQ API URL (overrides config and env)');
  program.option('--token <token>', 'API token (overrides config and env)');
  program.option('--web-url <url>', 'Web app URL used for OAuth2 handoff (overrides config and env)');
  program.option('--org <org>', 'Organization slug or ID');
  program.option('--workspace <workspace>', 'Workspace slug or ID');
  program.option('--json', 'Output in JSON format');

  program.addHelpText(
    'after',
    `
Examples:
  $ borgiq auth login                         Configure credentials interactively
  $ borgiq canvases list                      Table in a terminal, JSON when piped
  $ borgiq canvases list --json --all         Every canvas as JSON (auto-paginated)
  $ borgiq secrets delete <id> --yes          Delete without the confirmation prompt
  $ cat flow.json | borgiq canvases create-with-data --file -

Configuration (highest precedence first):
  flags  ->  env vars  ->  ~/.config/borgiq/config.json
  Env: BORGIQ_API_URL, BORGIQ_API_TOKEN, BORGIQ_ORG, BORGIQ_WORKSPACE, BORGIQ_CONFIG_DIR

Output:
  Tables on an interactive terminal; JSON when piped or with --json.
  In JSON mode, errors are emitted as JSON too: { "error": { code, status, details } }.

Exit codes:
  0 success    2 usage         3 auth (401)      4 forbidden (403)   5 not found (404)
  6 conflict   7 rate limit    8 server (5xx)    9 network           1 other`,
  );

  registerAuthCommands(program);
  registerOrgsCommands(program);
  registerWorkspacesCommands(program);
  registerActorsCommands(program);
  registerCanvasesCommands(program);
  registerCanvasActorsCommands(program);
  registerFlowrunsCommands(program);
  registerFlowrunJobsCommands(program);
  registerFlowrunResultsCommands(program);
  registerFlowrunMessagesCommands(program);
  registerTriggersCommands(program);
  registerConnectionsCommands(program);
  registerSecretsCommands(program);
  registerAssetsCommands(program);
  registerTokensCommands(program);
  registerTemplatesCommands(program);
  registerScaffoldCommands(program);
  registerGenerateCommands(program);
  registerValidateCommands(program);

  return program;
};
