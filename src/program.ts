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

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name('borgiq')
    .description('BorgIQ CLI - Command-line interface for the BorgIQ workflow automation platform')
    .version('0.1.2');

  // Global options
  program.option('--api-url <url>', 'BorgIQ API URL (overrides config and env)');
  program.option('--token <token>', 'API token (overrides config and env)');
  program.option('--web-url <url>', 'Web app URL used for OAuth2 handoff (overrides config and env)');
  program.option('--org <org>', 'Organization slug or ID');
  program.option('--workspace <workspace>', 'Workspace slug or ID');
  program.option('--json', 'Output in JSON format');

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

  return program;
};
