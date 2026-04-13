import type { Command } from 'commander';

import { connectionsList } from './list.js';
import { connectionsDelete } from './delete.js';
import { connectionsTypes } from './types.js';
import { connectionsCreate } from './create.js';

export const registerConnectionsCommands = (program: Command): void => {
  const connections = program.command('connections').description('Manage connections');

  connections
    .command('list')
    .description('List connections')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(connectionsList);

  connections
    .command('types')
    .description('List available connection types')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(connectionsTypes);

  connections
    .command('create')
    .description('Create a connection. Non-OAuth2 types run fully in CLI; OAuth2 types open the web app for completion.')
    .option('--key <key>', 'Connection key (unique within workspace)')
    .option('--type <type>', 'Connection type name (e.g. generic-api-key, github-oauth2)')
    .option('--description <desc>', 'Connection description')
    .option('--exposure-mode <mode>', 'Exposure mode: httpOnly or exposed', 'httpOnly')
    .option('--inputs-file <path>', 'Path to JSON/YAML file with non-sensitive inputs')
    .option('--secret-inputs-file <path>', 'Path to JSON/YAML file with sensitive inputs')
    .option('--user-managed-options-file <path>', 'Path to JSON/YAML file with user-managed options (for user-managed OAuth2 apps)')
    .option('--web-url <url>', 'Override the web app URL used for OAuth2 handoff')
    .option('--timeout <seconds>', 'How long to wait for OAuth2 completion', '300')
    .action(connectionsCreate);

  connections
    .command('delete <id>')
    .description('Delete a connection')
    .action(connectionsDelete);
};
