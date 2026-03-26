import type { Command } from 'commander';

import { tokensList } from './list.js';
import { tokensCreate } from './create.js';
import { tokensRevoke } from './revoke.js';

export const registerTokensCommands = (program: Command): void => {
  const tokens = program.command('tokens').description('Manage API tokens');

  tokens
    .command('list')
    .description('List API tokens')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(tokensList);

  tokens
    .command('create')
    .description('Create a new API token')
    .requiredOption('--name <name>', 'Token name')
    .requiredOption('--scopes <scopes>', 'Comma-separated list of scopes')
    .option('--expires-at <date>', 'Expiration date (ISO 8601)')
    .action(tokensCreate);

  tokens
    .command('revoke <id>')
    .description('Revoke an API token')
    .action(tokensRevoke);
};
